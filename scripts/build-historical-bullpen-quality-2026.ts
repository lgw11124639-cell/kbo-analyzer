import fs from "node:fs";
import path from "node:path";

type PersonRef = {
  id: number;
  name: string;
} | null;

type TodayGame = {
  gameId: string;
  date: string;
  homeTeamName: string;
  awayTeamName: string;

  status?: {
    stateCode?: string;
    cancelCode?: string;
    cancelName?: string;
  };

  startingPitchers?: {
    away?: PersonRef;
    home?: PersonRef;
  };
};

type RawGame = {
  G_ID?: string;

  HOME_NM?: string;
  AWAY_NM?: string;

  SR_ID?: string | number;
  SEASON_ID?: string | number;

  CANCEL_SC_ID?: string;
};

type PitcherRow = {
  name: string;
  entry: string;
  result: string;

  innings: string;

  pitches: number;
  hits: number;
  homeRuns: number;
  walks: number;
  strikeouts: number;
  runs: number;
  earnedRuns: number;
};

type StarterAppearance = {
  date: string;
  gameId: string;

  playerId: number;
  name: string;
  team: string;
  opponent: string;
  side: "AWAY" | "HOME";

  innings: string;
  outs: number;

  pitches: number;
  hits: number;
  homeRuns: number;
  walks: number;
  strikeouts: number;
  runs: number;
  earnedRuns: number;

  qs: boolean;
};

type RecentSummary = {
  games: number;
  innings: number;
  era: number | null;
  whip: number | null;
  strikeouts: number;
  walks: number;
  kbb: number | null;
};

type HistoricalPitcherStats = {
  playerId: number;

  era: number | null;
  games: number;

  wins: number | null;
  losses: number | null;

  innings: string | null;

  strikeouts: number;
  walks: number;

  whip: number | null;
  avg: number | null;

  qs: number;

  recent5: RecentSummary | null;
  recent10: RecentSummary | null;
};

type HistoricalStarterSnapshot = {
  date: string;
  gameId: string;

  awayTeam: string;
  homeTeam: string;

  awayStarter: {
    id: number;
    name: string;
    stats: HistoricalPitcherStats;
  } | null;

  homeStarter: {
    id: number;
    name: string;
    stats: HistoricalPitcherStats;
  } | null;
};

const BASE_URL =
  process.env.KBO_BACKTEST_BASE_URL ??
  "http://127.0.0.1:3200";

const OUTPUT =
  path.join(
    process.cwd(),
    "data",
    "kbo-historical-starter-stats-2026.json"
  );

const START_DATE =
  process.env.START_DATE ??
  "2026-03-28";

const END_DATE =
  process.env.END_DATE ??
  "2026-09-14";


function normalizeTeamName(
  value: string | null | undefined
) {
  return (value ?? "")
    .replace(/\s+/g, "")
    .replace("두산베어스", "두산")
    .replace("LG트윈스", "LG")
    .replace("삼성라이온즈", "삼성")
    .replace("KIA타이거즈", "KIA")
    .replace("한화이글스", "한화")
    .replace("롯데자이언츠", "롯데")
    .replace("KT위즈", "KT")
    .replace("NC다이노스", "NC")
    .replace("SSG랜더스", "SSG")
    .replace("키움히어로즈", "키움");
}


function isoDate(
  date: Date
) {
  return [
    date.getUTCFullYear(),
    String(
      date.getUTCMonth() + 1
    ).padStart(2, "0"),
    String(
      date.getUTCDate()
    ).padStart(2, "0"),
  ].join("-");
}


function ymd(
  date: Date
) {
  return isoDate(date)
    .replaceAll("-", "");
}


function dateRange(
  start: string,
  end: string
) {
  const result: Date[] = [];

  const cursor =
    new Date(`${start}T00:00:00Z`);

  const last =
    new Date(`${end}T00:00:00Z`);

  while (
    cursor.getTime() <=
    last.getTime()
  ) {
    result.push(
      new Date(cursor)
    );

    cursor.setUTCDate(
      cursor.getUTCDate() + 1
    );
  }

  return result;
}


function num(
  value: string | undefined
) {
  if (!value) {
    return 0;
  }

  const n =
    Number(
      value
        .replace(/,/g, "")
        .trim()
    );

  return Number.isFinite(n)
    ? n
    : 0;
}


/*
  이닝 문자열을 아웃카운트로 변환.

  6       -> 18 outs
  5 1/3   -> 16 outs
  3 2/3   -> 11 outs

  ERA/WHIP 누적 시 0.333333 부동소수 오차를
  줄이기 위해 아웃카운트 단위로 저장한다.
*/
function inningsToOuts(
  value: string
) {
  const text =
    (value ?? "").trim();

  if (!text) {
    return 0;
  }

  const parts =
    text.split(/\s+/);

  const whole =
    Number(parts[0]) || 0;

  let outs =
    whole * 3;

  if (
    parts.length >= 2
  ) {
    if (
      parts[1] === "1/3"
    ) {
      outs += 1;
    } else if (
      parts[1] === "2/3"
    ) {
      outs += 2;
    }
  }

  return outs;
}


function outsToInningsNumber(
  outs: number
) {
  return outs / 3;
}


function outsToBaseballString(
  outs: number
) {
  const whole =
    Math.floor(
      outs / 3
    );

  const remain =
    outs % 3;

  if (
    remain === 1
  ) {
    return `${whole} 1/3`;
  }

  if (
    remain === 2
  ) {
    return `${whole} 2/3`;
  }

  return String(
    whole
  );
}


function parseTableRows(
  value: unknown
): string[][] {
  if (
    !value ||
    typeof value !== "string"
  ) {
    return [];
  }

  try {
    const parsed =
      JSON.parse(value);

    if (
      !Array.isArray(
        parsed?.rows
      )
    ) {
      return [];
    }

    return parsed.rows.map(
      (
        rowObject: {
          row?: Array<{
            Text?: string;
          }>;
        }
      ) =>
        Array.isArray(
          rowObject.row
        )
          ? rowObject.row.map(
              (cell) =>
                (
                  cell.Text ??
                  ""
                )
                  .replace(
                    /&nbsp;/g,
                    ""
                  )
                  .trim()
            )
          : []
    );
  } catch {
    return [];
  }
}


function parsePitchers(
  pitcherObject: unknown
): PitcherRow[] {
  if (
    !pitcherObject ||
    typeof pitcherObject !==
      "object"
  ) {
    return [];
  }

  const table =
    (
      pitcherObject as {
        table?: string;
      }
    ).table;

  const rows =
    parseTableRows(
      table
    );

  return rows
    .filter(
      (row) =>
        row.length >= 16
    )
    .map(
      (row) => ({
        name:
          row[0] ?? "",

        entry:
          row[1] ?? "",

        result:
          row[2] ?? "",

        innings:
          row[6] ?? "",

        pitches:
          num(row[8]),

        hits:
          num(row[10]),

        homeRuns:
          num(row[11]),

        walks:
          num(row[12]),

        strikeouts:
          num(row[13]),

        runs:
          num(row[14]),

        earnedRuns:
          num(row[15]),
      })
    );
}


async function fetchTodayGames(
  date: string
): Promise<TodayGame[]> {
  const response =
    await fetch(
      `${BASE_URL}/api/kbo/today?date=${date}`,
      {
        cache:
          "no-store",
      }
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `today ${date}: HTTP ${response.status}`
    );
  }

  const json =
    await response.json();

  return Array.isArray(
    json?.games
  )
    ? json.games
    : [];
}


async function fetchRawGames(
  date: Date
): Promise<RawGame[]> {
  const response =
    await fetch(
      "https://www.koreabaseball.com/ws/Main.asmx/GetKboGameList",
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json; charset=UTF-8",

          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",

          Referer:
            "https://www.koreabaseball.com/",
        },

        body:
          JSON.stringify({
            leId:
              "1",
            srId:
              "0,9,6",
            date:
              ymd(date),
          }),

        cache:
          "no-store",
      }
    );

  if (
    !response.ok
  ) {
    return [];
  }

  let text =
    await response.text();

  const indexes = [
    text.indexOf(
      "<!DOCTYPE"
    ),
    text.indexOf(
      "<html"
    ),
  ].filter(
    (index) =>
      index >= 0
  );

  if (
    indexes.length
  ) {
    text =
      text.slice(
        0,
        Math.min(
          ...indexes
        )
      );
  }

  try {
    const json =
      JSON.parse(text);

    return Array.isArray(
      json?.game
    )
      ? json.game
      : [];
  } catch {
    return [];
  }
}


async function fetchBoxScore(
  gameId: string,
  seasonId: number,
  srId: number
) {
  const body =
    new URLSearchParams();

  body.set(
    "leId",
    "1"
  );

  body.set(
    "srId",
    String(srId)
  );

  body.set(
    "seasonId",
    String(seasonId)
  );

  body.set(
    "gameId",
    gameId
  );

  const response =
    await fetch(
      "https://www.koreabaseball.com/ws/Schedule.asmx/GetBoxScoreScroll",
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded; charset=UTF-8",

          "X-Requested-With":
            "XMLHttpRequest",

          Referer:
            "https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx",

          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        },

        body:
          body.toString(),

        cache:
          "no-store",
      }
    );

  if (
    !response.ok
  ) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}


function summarizeRecent(
  games: StarterAppearance[]
): RecentSummary | null {
  if (
    !games.length
  ) {
    return null;
  }

  const outs =
    games.reduce(
      (
        sum,
        game
      ) =>
        sum +
        game.outs,
      0
    );

  const innings =
    outsToInningsNumber(
      outs
    );

  const earnedRuns =
    games.reduce(
      (
        sum,
        game
      ) =>
        sum +
        game.earnedRuns,
      0
    );

  const hits =
    games.reduce(
      (
        sum,
        game
      ) =>
        sum +
        game.hits,
      0
    );

  const walks =
    games.reduce(
      (
        sum,
        game
      ) =>
        sum +
        game.walks,
      0
    );

  const strikeouts =
    games.reduce(
      (
        sum,
        game
      ) =>
        sum +
        game.strikeouts,
      0
    );

  return {
    games:
      games.length,

    innings:
      Number(
        innings.toFixed(2)
      ),

    era:
      innings > 0
        ? Number(
            (
              earnedRuns *
              9 /
              innings
            ).toFixed(2)
          )
        : null,

    whip:
      innings > 0
        ? Number(
            (
              (
                hits +
                walks
              ) /
              innings
            ).toFixed(2)
          )
        : null,

    strikeouts,

    walks,

    kbb:
      walks > 0
        ? Number(
            (
              strikeouts /
              walks
            ).toFixed(2)
          )
        : strikeouts > 0
          ? strikeouts
          : null,
  };
}


function buildStats(
  playerId: number,
  history:
    StarterAppearance[]
): HistoricalPitcherStats {
  const games =
    history.length;

  const outs =
    history.reduce(
      (
        sum,
        game
      ) =>
        sum +
        game.outs,
      0
    );

  const innings =
    outsToInningsNumber(
      outs
    );

  const hits =
    history.reduce(
      (
        sum,
        game
      ) =>
        sum +
        game.hits,
      0
    );

  const walks =
    history.reduce(
      (
        sum,
        game
      ) =>
        sum +
        game.walks,
      0
    );

  const strikeouts =
    history.reduce(
      (
        sum,
        game
      ) =>
        sum +
        game.strikeouts,
      0
    );

  const earnedRuns =
    history.reduce(
      (
        sum,
        game
      ) =>
        sum +
        game.earnedRuns,
      0
    );

  const qs =
    history.filter(
      (game) =>
        game.qs
    ).length;

  return {
    playerId,

    era:
      innings > 0
        ? Number(
            (
              earnedRuns *
              9 /
              innings
            ).toFixed(2)
          )
        : null,

    games,

    /*
      현재 starterRating은
      wins/losses를 사용하지 않는다.
    */
    wins:
      null,

    losses:
      null,

    innings:
      outs > 0
        ? outsToBaseballString(
            outs
          )
        : null,

    strikeouts,

    walks,

    whip:
      innings > 0
        ? Number(
            (
              (
                hits +
                walks
              ) /
              innings
            ).toFixed(2)
          )
        : null,

    /*
      starterRating에서 AVG는 사용하지 않음.
    */
    avg:
      null,

    qs,

    recent5:
      summarizeRecent(
        history.slice(-5)
      ),

    recent10:
      summarizeRecent(
        history.slice(-10)
      ),
  };
}


function findRawGame(
  raws: RawGame[],
  gameId: string,
  date: Date
) {
  const dateKey =
    ymd(date);

  return raws.find(
    (raw) => {
      const id =
        String(
          raw.G_ID ??
          ""
        );

      if (
        !id
      ) {
        return false;
      }

      const full =
        id.startsWith(
          dateKey
        )
          ? id
          : dateKey +
            id;

      return (
        full ===
        gameId
      );
    }
  );
}


async function main() {
  console.log(
    "===== HISTORICAL STARTER BUILD ====="
  );

  console.log(
    "기간:",
    START_DATE,
    "~",
    END_DATE
  );

  const history =
    new Map<
      number,
      StarterAppearance[]
    >();

  const snapshots:
    HistoricalStarterSnapshot[] =
    [];

  let processedGames =
    0;

  let missingRaw =
    0;

  let missingBox =
    0;

  let missingStarter =
    0;

  for (
    const date of dateRange(
      START_DATE,
      END_DATE
    )
  ) {
    const dateIso =
      isoDate(date);

    const [
      todayGames,
      rawGames,
    ] =
      await Promise.all([
        fetchTodayGames(
          dateIso
        ),
        fetchRawGames(
          date
        ),
      ]);

    const games =
      todayGames.filter(
        (game) =>
          game.status
            ?.stateCode ===
            "3" &&
          game.status
            ?.cancelCode !==
            "1"
      );

    if (
      !games.length
    ) {
      continue;
    }

    console.log(
      dateIso,
      "games",
      games.length
    );

    for (
      const game of games
    ) {
      const raw =
        findRawGame(
          rawGames,
          game.gameId,
          date
        );

      if (
        !raw
      ) {
        missingRaw += 1;

        console.warn(
          "RAW 없음:",
          game.gameId
        );

        continue;
      }

      const seasonId =
        Number(
          raw.SEASON_ID ??
          2026
        );

      const srId =
        Number(
          raw.SR_ID ??
          0
        );

      /*
        중요:
        여기서 snapshot을 먼저 만든다.

        즉 현재 경기 결과를 누적하기 전에
        경기 직전까지의 선발 성적만 사용한다.
      */
      const awayRef =
        game
          .startingPitchers
          ?.away ??
        null;

      const homeRef =
        game
          .startingPitchers
          ?.home ??
        null;

      const awayHistory =
        awayRef
          ? (
              history.get(
                awayRef.id
              ) ??
              []
            )
          : [];

      const homeHistory =
        homeRef
          ? (
              history.get(
                homeRef.id
              ) ??
              []
            )
          : [];

      snapshots.push({
        date:
          dateIso,

        gameId:
          game.gameId,

        awayTeam:
          game.awayTeamName,

        homeTeam:
          game.homeTeamName,

        awayStarter:
          awayRef
            ? {
                id:
                  awayRef.id,

                name:
                  awayRef.name,

                stats:
                  buildStats(
                    awayRef.id,
                    awayHistory
                  ),
              }
            : null,

        homeStarter:
          homeRef
            ? {
                id:
                  homeRef.id,

                name:
                  homeRef.name,

                stats:
                  buildStats(
                    homeRef.id,
                    homeHistory
                  ),
              }
            : null,
      });

      const box =
        await fetchBoxScore(
          game.gameId,
          seasonId,
          srId
        );

      if (
        !box
      ) {
        missingBox += 1;

        console.warn(
          "BOX 없음:",
          game.gameId
        );

        continue;
      }

      const arrPitcher =
        Array.isArray(
          box.arrPitcher
        )
          ? box.arrPitcher
          : [];

      const awayPitchers =
        parsePitchers(
          arrPitcher[0]
        );

      const homePitchers =
        parsePitchers(
          arrPitcher[1]
        );

      const awayActual =
        awayPitchers[0] ??
        null;

      const homeActual =
        homePitchers[0] ??
        null;


      const applyStarter = (
        ref: PersonRef,
        actual:
          PitcherRow | null,
        team: string,
        opponent: string,
        side:
          "AWAY" |
          "HOME"
      ) => {
        if (
          !ref ||
          !actual
        ) {
          missingStarter += 1;
          return;
        }

        /*
          today API의 실제 선발과
          BoxScore 첫 투수 이름이 다르면
          로그로 남긴다.
        */
        if (
          ref.name &&
          actual.name &&
          ref.name !==
            actual.name
        ) {
          console.warn(
            "선발 이름 불일치:",
            game.gameId,
            ref.name,
            "!=",
            actual.name
          );
        }

        const outs =
          inningsToOuts(
            actual.innings
          );

        const appearance:
          StarterAppearance = {
            date:
              dateIso,

            gameId:
              game.gameId,

            playerId:
              ref.id,

            name:
              ref.name,

            team,

            opponent,

            side,

            innings:
              actual.innings,

            outs,

            pitches:
              actual.pitches,

            hits:
              actual.hits,

            homeRuns:
              actual.homeRuns,

            walks:
              actual.walks,

            strikeouts:
              actual.strikeouts,

            runs:
              actual.runs,

            earnedRuns:
              actual.earnedRuns,

            /*
              QS:
              선발 6이닝 이상 + 3자책 이하
            */
            qs:
              outs >= 18 &&
              actual.earnedRuns <=
                3,
          };

        const existing =
          history.get(
            ref.id
          ) ??
          [];

        existing.push(
          appearance
        );

        history.set(
          ref.id,
          existing
        );
      };


      applyStarter(
        awayRef,
        awayActual,
        game.awayTeamName,
        game.homeTeamName,
        "AWAY"
      );

      applyStarter(
        homeRef,
        homeActual,
        game.homeTeamName,
        game.awayTeamName,
        "HOME"
      );

      processedGames += 1;
    }
  }


  const pitcherHistories =
    Object.fromEntries(
      [...history.entries()]
        .map(
          ([
            playerId,
            games,
          ]) => [
            String(
              playerId
            ),
            games,
          ]
        )
    );


  const output = {
    generatedAt:
      new Date()
        .toISOString(),

    startDate:
      START_DATE,

    endDate:
      END_DATE,

    processedGames,

    snapshotCount:
      snapshots.length,

    pitcherCount:
      history.size,

    diagnostics: {
      missingRaw,
      missingBox,
      missingStarter,
    },

    snapshots,

    pitcherHistories,
  };


  fs.mkdirSync(
    path.dirname(
      OUTPUT
    ),
    {
      recursive:
        true,
    }
  );

  fs.writeFileSync(
    OUTPUT,
    JSON.stringify(
      output,
      null,
      2
    ),
    "utf8"
  );


  console.log();
  console.log(
    "===== COMPLETE ====="
  );

  console.log(
    "processedGames:",
    processedGames
  );

  console.log(
    "snapshots:",
    snapshots.length
  );

  console.log(
    "pitchers:",
    history.size
  );

  console.log(
    "missingRaw:",
    missingRaw
  );

  console.log(
    "missingBox:",
    missingBox
  );

  console.log(
    "missingStarter:",
    missingStarter
  );

  console.log(
    "FILE:",
    OUTPUT
  );
}


main().catch(
  (error) => {
    console.error(
      error
    );

    process.exit(1);
  }
);

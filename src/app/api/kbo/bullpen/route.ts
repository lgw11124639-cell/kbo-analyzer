import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type RawGame = {
  G_ID?: string;

  HOME_NM?: string;
  AWAY_NM?: string;

  B_SCORE_CN?: string | number | null;
  T_SCORE_CN?: string | number | null;

  CANCEL_SC_ID?: string;

  SR_ID?: string | number;
  SEASON_ID?: string | number;
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

type BullpenAppearance = {
  date: string;
  dayOffset: number;

  opponent: string;
  homeAway: "HOME" | "AWAY";

  pitcher: string;

  innings: string;
  inningsNumber: number;

  pitches: number;

  hits: number;
  homeRuns: number;
  walks: number;
  strikeouts: number;

  runs: number;
  earnedRuns: number;
};

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

function ymd(date: Date) {
  const yyyy =
    date.getFullYear();

  const mm =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const dd =
    String(
      date.getDate()
    ).padStart(2, "0");

  return `${yyyy}${mm}${dd}`;
}

function isoDate(date: Date) {
  const yyyy =
    date.getFullYear();

  const mm =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const dd =
    String(
      date.getDate()
    ).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

function num(
  value: unknown
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }

  const n =
    Number(
      String(value)
        .replace(/,/g, "")
        .trim()
    );

  return Number.isFinite(n)
    ? n
    : 0;
}

function inningsToNumber(
  value: string
) {
  if (!value) return 0;

  const fractionOnly =
    value.trim().match(
      /^([12])\/3$/
    );

  if (fractionOnly) {
    return Number(fractionOnly[1]) / 3;
  }

  const parts =
    value
      .trim()
      .split(/\s+/);

  const whole =
    Number(parts[0]) || 0;

  if (
    parts.length < 2
  ) {
    return whole;
  }

  const fraction =
    parts[1]
      .split("/");

  if (
    fraction.length !== 2
  ) {
    return whole;
  }

  const numerator =
    Number(fraction[0]);

  const denominator =
    Number(fraction[1]);

  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return whole;
  }

  return (
    whole +
    numerator / denominator
  );
}


/*
  KBO table JSON 구조:

  {
    rows: [
      {
        row: [
          { Text: "선수명" },
          ...
        ]
      }
    ]
  }
*/

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
                  cell.Text ?? ""
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
    typeof pitcherObject !== "object"
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
    parseTableRows(table);

  /*
    KBO 현재 투수 박스스코어 컬럼:

    0 이름
    1 등판
    2 결과
    3 W
    4 L
    5 SV
    6 IP
    7 TBF
    8 NP
    9 AB
    10 H
    11 HR
    12 BB
    13 SO
    14 R
    15 ER
    16 ERA
  */

  return rows
    .filter(
      (row) =>
        row.length >= 9
    )
    .map((row) => ({
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
    }));
}

async function fetchGames(
  date: Date
): Promise<RawGame[]> {
  try {
    const response =
      await fetch(
        "https://www.koreabaseball.com/ws/Main.asmx/GetKboGameList",
        {
          method: "POST",

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
              leId: "1",
              srId: "0,9,6",
              date: ymd(date),
            }),

          cache: "no-store",
        }
      );

    if (!response.ok) {
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

    if (indexes.length) {
      text =
        text.slice(
          0,
          Math.min(
            ...indexes
          )
        );
    }

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

async function fetchPitchers(
  fullGameId: string,
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
    fullGameId
  );

  const response =
    await fetch(
      "https://www.koreabaseball.com/ws/Schedule.asmx/GetBoxScoreScroll",
      {
        method: "POST",

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

  if (!response.ok) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}


export async function GET(
  request: Request
) {
  const url =
    new URL(request.url);

  const teamParam =
    url.searchParams.get(
      "team"
    );

  const dateParam =
    url.searchParams.get(
      "date"
    );

  if (!teamParam) {
    return NextResponse.json(
      {
        error:
          "team 파라미터가 필요합니다.",
      },
      {
        status: 400,
      }
    );
  }

  const team =
    normalizeTeamName(
      teamParam
    );

  const baseDate =
    dateParam
      ? new Date(
          `${dateParam}T12:00:00`
        )
      : new Date();

  if (
    Number.isNaN(
      baseDate.getTime()
    )
  ) {
    return NextResponse.json(
      {
        error:
          "date 형식이 잘못되었습니다.",
      },
      {
        status: 400,
      }
    );
  }


  const appearances:
    BullpenAppearance[] = [];

  const daily = [
    {
      dayOffset: 1,
      date: "",
      pitches: 0,
      innings: 0,
      appearances: 0,
      gamePlayed: false,
    },
    {
      dayOffset: 2,
      date: "",
      pitches: 0,
      innings: 0,
      appearances: 0,
      gamePlayed: false,
    },
    {
      dayOffset: 3,
      date: "",
      pitches: 0,
      innings: 0,
      appearances: 0,
      gamePlayed: false,
    },
  ];


  /*
    경기일 기준 직전 3일 조회.

    오늘 경기 분석이라면
    당일 경기는 제외하고
    어제 / 2일 전 / 3일 전만 본다.
  */

  for (
    let dayOffset = 1;
    dayOffset <= 3;
    dayOffset++
  ) {
    const date =
      new Date(baseDate);

    date.setDate(
      date.getDate() -
        dayOffset
    );

    daily[
      dayOffset - 1
    ].date =
      isoDate(date);

    const games =
      await fetchGames(date);

    const game =
      games.find((item) => {
        const home =
          normalizeTeamName(
            item.HOME_NM
          );

        const away =
          normalizeTeamName(
            item.AWAY_NM
          );

        return (
          home === team ||
          away === team
        );
      });

    if (!game) {
      continue;
    }

    if (
      game.CANCEL_SC_ID &&
      game.CANCEL_SC_ID !== "0"
    ) {
      continue;
    }

    const homeScore =
      game.B_SCORE_CN;

    const awayScore =
      game.T_SCORE_CN;

    if (
      homeScore === null ||
      homeScore === undefined ||
      awayScore === null ||
      awayScore === undefined
    ) {
      continue;
    }


    const home =
      normalizeTeamName(
        game.HOME_NM
      );

    const away =
      normalizeTeamName(
        game.AWAY_NM
      );

    const isHome =
      home === team;

    const opponent =
      isHome
        ? away
        : home;


    const rawId =
      String(
        game.G_ID ?? ""
      );

    if (!rawId) {
      continue;
    }

    /*
      GetKboGameList의 G_ID가
      날짜를 이미 포함하면 그대로 사용.

      혹시 날짜 없는 ID가 내려오면
      YYYYMMDD를 앞에 붙인다.
    */

    const fullGameId =
      rawId.startsWith(
        ymd(date)
      )
        ? rawId
        : ymd(date) +
          rawId;


    const seasonId =
      Number(
        game.SEASON_ID ??
        date.getFullYear()
      );

    const srId =
      Number(
        game.SR_ID ?? 0
      );


    const box =
      await fetchPitchers(
        fullGameId,
        seasonId,
        srId
      );

    if (!box) {
      continue;
    }


    const arrPitcher =
      Array.isArray(
        box.arrPitcher
      )
        ? box.arrPitcher
        : [];


    const sideIndex =
      isHome
        ? 1
        : 0;


    const pitchers =
      parsePitchers(
        arrPitcher[
          sideIndex
        ]
      );


    if (!pitchers.length) {
      continue;
    }


    /*
      첫 번째 투수 = 선발
      두 번째부터 = 불펜
    */

    const bullpen =
      pitchers.slice(1);


    daily[
      dayOffset - 1
    ].gamePlayed =
      true;


    for (
      const pitcher of bullpen
    ) {
      if (!pitcher.name) {
        continue;
      }

      const ip =
        inningsToNumber(
          pitcher.innings
        );


      daily[
        dayOffset - 1
      ].pitches +=
        pitcher.pitches;


      daily[
        dayOffset - 1
      ].innings +=
        ip;


      daily[
        dayOffset - 1
      ].appearances += 1;


      appearances.push({
        date:
          isoDate(date),

        dayOffset,

        opponent,

        homeAway:
          isHome
            ? "HOME"
            : "AWAY",

        pitcher:
          pitcher.name,

        innings:
          pitcher.innings,

        inningsNumber:
          Number(
            ip.toFixed(2)
          ),

        pitches:
          pitcher.pitches,

        hits:
          pitcher.hits,

        homeRuns:
          pitcher.homeRuns,

        walks:
          pitcher.walks,

        strikeouts:
          pitcher.strikeouts,

        runs:
          pitcher.runs,

        earnedRuns:
          pitcher.earnedRuns,
      });
    }
  }


  /*
    투수별 3일 집계
  */

  const pitcherMap =
    new Map<
      string,
      {
        pitcher: string;
        appearances: number;
        totalPitches: number;
        innings: number;

        yesterday: boolean;
        twoDaysAgo: boolean;
        threeDaysAgo: boolean;

        weightedPitches: number;
      }
    >();


  for (
    const appearance of appearances
  ) {
    const current =
      pitcherMap.get(
        appearance.pitcher
      ) ?? {
        pitcher:
          appearance.pitcher,

        appearances: 0,
        totalPitches: 0,
        innings: 0,

        yesterday: false,
        twoDaysAgo: false,
        threeDaysAgo: false,

        weightedPitches: 0,
      };


    current.appearances += 1;

    current.totalPitches +=
      appearance.pitches;

    current.innings +=
      appearance.inningsNumber;


    if (
      appearance.dayOffset === 1
    ) {
      current.yesterday =
        true;

      current.weightedPitches +=
        appearance.pitches;
    }


    if (
      appearance.dayOffset === 2
    ) {
      current.twoDaysAgo =
        true;

      current.weightedPitches +=
        appearance.pitches *
        0.65;
    }


    if (
      appearance.dayOffset === 3
    ) {
      current.threeDaysAgo =
        true;

      current.weightedPitches +=
        appearance.pitches *
        0.4;
    }


    pitcherMap.set(
      appearance.pitcher,
      current
    );
  }


  const pitchers =
    Array.from(
      pitcherMap.values()
    )
      .map((pitcher) => {
        const backToBack =
          pitcher.yesterday &&
          pitcher.twoDaysAgo;

        let burden =
          pitcher.weightedPitches;

        if (
          pitcher.appearances >= 2
        ) {
          burden += 8;
        }

        if (backToBack) {
          burden += 15;
        }

        return {
          ...pitcher,

          innings:
            Number(
              pitcher.innings
                .toFixed(2)
            ),

          weightedPitches:
            Number(
              pitcher.weightedPitches
                .toFixed(1)
            ),

          backToBack,

          burden:
            Number(
              burden.toFixed(1)
            ),
        };
      })
      .sort(
        (a, b) =>
          b.burden -
          a.burden
      );


  const totalPitches =
    appearances.reduce(
      (sum, appearance) =>
        sum +
        appearance.pitches,
      0
    );


  const totalInnings =
    appearances.reduce(
      (sum, appearance) =>
        sum +
        appearance.inningsNumber,
      0
    );


  const yesterdayPitches =
    appearances
      .filter(
        (appearance) =>
          appearance.dayOffset === 1
      )
      .reduce(
        (sum, appearance) =>
          sum +
          appearance.pitches,
        0
      );


  const twoDaysAgoPitches =
    appearances
      .filter(
        (appearance) =>
          appearance.dayOffset === 2
      )
      .reduce(
        (sum, appearance) =>
          sum +
          appearance.pitches,
        0
      );


  const threeDaysAgoPitches =
    appearances
      .filter(
        (appearance) =>
          appearance.dayOffset === 3
      )
      .reduce(
        (sum, appearance) =>
          sum +
          appearance.pitches,
        0
      );


  const backToBackPitchers =
    pitchers.filter(
      (pitcher) =>
        pitcher.backToBack
    );


  const multiDayPitchers =
    pitchers.filter(
      (pitcher) =>
        pitcher.appearances >= 2
    );


  /*
    초기 피로지수 v0.1

    어제 투구수 영향이 가장 크고,
    연투/다일 등판에 추가 페널티.

    아직 모델 승률에는 사용하지 않는다.
  */

  const weightedTeamPitches =
    yesterdayPitches +
    twoDaysAgoPitches *
      0.65 +
    threeDaysAgoPitches *
      0.4;


  const fatigueIndex =
    Math.max(
      0,
      Math.min(
        100,
        weightedTeamPitches *
          0.42 +
        backToBackPitchers.length *
          12 +
        multiDayPitchers.length *
          4
      )
    );


  return NextResponse.json({
    fetchedAt:
      new Date().toISOString(),

    team,

    range: {
      days: 3,

      from:
        daily[2]?.date ??
        null,

      to:
        daily[0]?.date ??
        null,
    },

    summary: {
      gamesPlayed:
        daily.filter(
          (day) =>
            day.gamePlayed
        ).length,

      bullpenAppearances:
        appearances.length,

      uniquePitchers:
        pitchers.length,

      totalPitches,

      totalInnings:
        Number(
          totalInnings
            .toFixed(2)
        ),

      yesterdayPitches,
      twoDaysAgoPitches,
      threeDaysAgoPitches,

      backToBackCount:
        backToBackPitchers.length,

      multiDayCount:
        multiDayPitchers.length,

      fatigueIndex:
        Number(
          fatigueIndex
            .toFixed(1)
        ),
    },

    daily:
      daily.map((day) => ({
        ...day,

        innings:
          Number(
            day.innings
              .toFixed(2)
          ),
      })),

    pitchers,

    appearances,
  });
}

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type RawGame = {
  G_ID?: string;

  HOME_NM?: string;
  AWAY_NM?: string;

  SR_ID?: string | number;
  SEASON_ID?: string | number;

  CANCEL_SC_ID?: string;
};

type LineupPlayer = {
  order: number | null;
  position: string;
  name: string;
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

function ymd(
  date: Date
) {
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
              date:
                ymd(date),
            }),

          cache:
            "no-store",
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


function parseLineup(
  hitterObject: unknown
): LineupPlayer[] {
  if (
    !hitterObject
  ) {
    return [];
  }

  const table1 =
    typeof hitterObject === "string"
      ? hitterObject
      : (
          hitterObject as {
            table1?: string;
          }
        ).table1;

  const rows =
    parseTableRows(
      table1
    );

  /*
    table1:
    0 타순
    1 포지션
    2 선수명
  */

  return rows
    .filter(
      (row) =>
        row.length >= 3
    )
    .map((row) => {
      const orderRaw =
        row[0] ?? "";

      const order =
        /^\d+$/.test(
          orderRaw
        )
          ? Number(
              orderRaw
            )
          : null;

      return {
        order,
        position:
          row[1] ?? "",
        name:
          row[2] ?? "",
      };
    })
    .filter(
      (player) =>
        player.name
    );
}


function extractStartingLineup(
  lineup: LineupPlayer[]
): LineupPlayer[] {
  const byOrder =
    new Map<
      number,
      LineupPlayer
    >();

  for (
    const player of lineup
  ) {
    if (
      player.order === null ||
      player.order < 1 ||
      player.order > 9
    ) {
      continue;
    }

    /*
      같은 타순이 여러 번 나오면
      첫 번째 선수가 선발,
      이후 선수는 교체선수로 본다.
    */

    if (
      !byOrder.has(
        player.order
      )
    ) {
      byOrder.set(
        player.order,
        player
      );
    }
  }

  return Array.from(
    byOrder.values()
  ).sort(
    (a, b) =>
      (a.order ?? 99) -
      (b.order ?? 99)
  );
}


async function fetchLineupAnalysis(
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
      "https://www.koreabaseball.com/ws/Schedule.asmx/GetLineUpAnalysis",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded; charset=UTF-8",

          Accept:
            "application/json, text/javascript, */*; q=0.01",

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


export async function GET(
  request: Request
) {
  const url =
    new URL(request.url);

  const awayParam =
    url.searchParams.get(
      "away"
    );

  const homeParam =
    url.searchParams.get(
      "home"
    );

  const dateParam =
    url.searchParams.get(
      "date"
    );

  if (
    !awayParam ||
    !homeParam ||
    !dateParam
  ) {
    return NextResponse.json(
      {
        error:
          "away, home, date 파라미터가 필요합니다.",
      },
      {
        status: 400,
      }
    );
  }

  const away =
    normalizeTeamName(
      awayParam
    );

  const home =
    normalizeTeamName(
      homeParam
    );

  const date =
    new Date(
      `${dateParam}T12:00:00`
    );

  if (
    Number.isNaN(
      date.getTime()
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

  const games =
    await fetchGames(
      date
    );

  const game =
    games.find(
      (item) =>
        normalizeTeamName(
          item.AWAY_NM
        ) === away &&
        normalizeTeamName(
          item.HOME_NM
        ) === home
    );

  if (!game) {
    return NextResponse.json(
      {
        error:
          "경기를 찾지 못했습니다.",
      },
      {
        status: 404,
      }
    );
  }

  const rawId =
    String(
      game.G_ID ?? ""
    );

  if (!rawId) {
    return NextResponse.json(
      {
        error:
          "gameId가 없습니다.",
      },
      {
        status: 502,
      }
    );
  }

  const gameId =
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

  const lineupAnalysis =
    await fetchLineupAnalysis(
      gameId,
      seasonId,
      srId
    );

  if (
    !lineupAnalysis
  ) {
    return NextResponse.json(
      {
        error:
          "라인업 정보를 불러오지 못했습니다.",
      },
      {
        status: 502,
      }
    );
  }

  /*
    GetLineUpAnalysis 응답 구조

    0 = lineup flag
    1 = 홈팀 meta
    2 = 원정팀 meta
    3 = 홈 라인업 table JSON 문자열 배열
    4 = 원정 라인업 table JSON 문자열 배열
  */

  const lineupReady =
    Array.isArray(
      lineupAnalysis?.["0"]
    ) &&
    lineupAnalysis["0"]
      ?.some(
        (item: any) =>
          item?.LINEUP_CK === true
      );

  const homeTable =
    Array.isArray(
      lineupAnalysis?.["3"]
    )
      ? lineupAnalysis["3"][0]
      : null;

  const awayTable =
    Array.isArray(
      lineupAnalysis?.["4"]
    )
      ? lineupAnalysis["4"][0]
      : null;

  const awayLineup =
    parseLineup(
      awayTable
    );

  const homeLineup =
    parseLineup(
      homeTable
    );

  const awayStarting =
    extractStartingLineup(
      awayLineup
    );

  const homeStarting =
    extractStartingLineup(
      homeLineup
    );

  return NextResponse.json({
    fetchedAt:
      new Date().toISOString(),

    gameId,

    date:
      dateParam,

    awayTeam:
      away,

    homeTeam:
      home,

    confirmed:
      lineupReady &&
      awayStarting.length === 9 &&
      homeStarting.length === 9 &&
      awayStarting.every(
        (player, index) =>
          player.order === index + 1
      ) &&
      homeStarting.every(
        (player, index) =>
          player.order === index + 1
      ),

    away: {
      count:
        awayStarting.length,

      lineup:
        awayStarting,
    },

    home: {
      count:
        homeStarting.length,

      lineup:
        homeStarting,
    },
  });
}


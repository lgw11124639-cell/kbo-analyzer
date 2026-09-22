import {
  NextRequest,
  NextResponse,
} from "next/server";

import * as cheerio
  from "cheerio";


export const dynamic =
  "force-dynamic";


const KBO_BASE =
  "https://www.koreabaseball.com";


type RecentGame = {
  date: string;
  type: string;
  opponent: string;

  avg: number | null;

  pa: number;
  ab: number;
  runs: number;
  hits: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  sb: number;
  cs: number;
  bb: number;
  hbp: number;
  so: number;
  gdp: number;
};


function num(
  value:
    | string
    | undefined
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


function nullableNum(
  value:
    | string
    | undefined
) {
  if (!value) {
    return null;
  }

  const n =
    Number(
      value
        .replace(/,/g, "")
        .trim()
    );

  return Number.isFinite(n)
    ? n
    : null;
}


function aggregate(
  games: RecentGame[]
) {
  const pa =
    games.reduce(
      (sum, g) =>
        sum + g.pa,
      0
    );

  const ab =
    games.reduce(
      (sum, g) =>
        sum + g.ab,
      0
    );

  const hits =
    games.reduce(
      (sum, g) =>
        sum + g.hits,
      0
    );

  const doubles =
    games.reduce(
      (sum, g) =>
        sum + g.doubles,
      0
    );

  const triples =
    games.reduce(
      (sum, g) =>
        sum + g.triples,
      0
    );

  const hr =
    games.reduce(
      (sum, g) =>
        sum + g.hr,
      0
    );

  const bb =
    games.reduce(
      (sum, g) =>
        sum + g.bb,
      0
    );

  const hbp =
    games.reduce(
      (sum, g) =>
        sum + g.hbp,
      0
    );


  const avg =
    ab > 0
      ? hits / ab
      : null;


  /*
    KBO 최근경기 표에는
    SF가 없기 때문에
    최근 출루율은 근사값으로 계산.
  */
  const obpApprox =
    pa > 0
      ? (
          hits +
          bb +
          hbp
        ) / pa
      : null;


  const singles =
    Math.max(
      0,
      hits -
      doubles -
      triples -
      hr
    );


  const totalBases =
    singles +
    doubles * 2 +
    triples * 3 +
    hr * 4;


  const slg =
    ab > 0
      ? totalBases / ab
      : null;


  const opsApprox =
    obpApprox !== null &&
    slg !== null
      ? obpApprox + slg
      : null;


  return {
    games:
      games.length,

    pa,
    ab,

    runs:
      games.reduce(
        (sum, g) =>
          sum + g.runs,
        0
      ),

    hits,

    doubles,
    triples,
    hr,

    rbi:
      games.reduce(
        (sum, g) =>
          sum + g.rbi,
        0
      ),

    sb:
      games.reduce(
        (sum, g) =>
          sum + g.sb,
        0
      ),

    cs:
      games.reduce(
        (sum, g) =>
          sum + g.cs,
        0
      ),

    bb,
    hbp,

    so:
      games.reduce(
        (sum, g) =>
          sum + g.so,
        0
      ),

    gdp:
      games.reduce(
        (sum, g) =>
          sum + g.gdp,
        0
      ),

    avg,
    obpApprox,
    slg,
    opsApprox,
  };
}


export async function GET(
  request: NextRequest
) {
  const playerId =
    request.nextUrl
      .searchParams
      .get("playerId");


  if (!playerId) {
    return NextResponse.json(
      {
        error:
          "playerId가 필요합니다.",
      },
      {
        status: 400,
      }
    );
  }


  try {
    const url =
      `${KBO_BASE}/Record/Player/HitterDetail/Basic.aspx?playerId=${encodeURIComponent(playerId)}`;


    const response =
      await fetch(
        url,
        {
          cache:
            "no-store",

          headers: {
            "User-Agent":
              "Mozilla/5.0",

            Referer:
              `${KBO_BASE}/`,
          },
        }
      );


    if (!response.ok) {
      throw new Error(
        `KBO 응답 오류 ${response.status}`
      );
    }


    const html =
      await response.text();

    const $ =
      cheerio.load(html);


    const games:
      RecentGame[] = [];


    $("table").each(
      (_, table) => {
        const headers =
          $(table)
            .find("thead th")
            .map(
              (_, th) =>
                $(th)
                  .text()
                  .replace(
                    /\s+/g,
                    ""
                  )
                  .trim()
            )
            .get();


        /*
          최근 경기 테이블 식별

          실제 KBO 구조:
          일자 / 구분 / 상대 / AVG /
          PA / AB / R / H / ...
        */
        const isRecentTable =
          headers.includes("일자") &&
          headers.includes("상대") &&
          headers.includes("PA") &&
          headers.includes("AB") &&
          headers.includes("H") &&
          headers.includes("HR") &&
          headers.includes("BB") &&
          headers.includes("SO");


        if (!isRecentTable) {
          return;
        }


        $(table)
          .find("tbody tr")
          .each(
            (_, tr) => {
              const cells =
                $(tr)
                  .find("th,td")
                  .map(
                    (_, cell) =>
                      $(cell)
                        .text()
                        .replace(
                          /\s+/g,
                          " "
                        )
                        .trim()
                  )
                  .get();


              if (
                cells.length <
                headers.length
              ) {
                return;
              }


              const row:
                Record<
                  string,
                  string
                > = {};


              headers.forEach(
                (
                  header,
                  index
                ) => {
                  row[header] =
                    cells[index] ??
                    "";
                }
              );


              if (
                !row["일자"] ||
                !row["상대"]
              ) {
                return;
              }


              games.push({
                date:
                  row["일자"],

                type:
                  row["구분"] ?? "",

                opponent:
                  row["상대"],

                avg:
                  nullableNum(
                    row["AVG"]
                  ),

                pa:
                  num(row["PA"]),

                ab:
                  num(row["AB"]),

                runs:
                  num(row["R"]),

                hits:
                  num(row["H"]),

                doubles:
                  num(row["2B"]),

                triples:
                  num(row["3B"]),

                hr:
                  num(row["HR"]),

                rbi:
                  num(row["RBI"]),

                sb:
                  num(row["SB"]),

                cs:
                  num(row["CS"]),

                bb:
                  num(row["BB"]),

                hbp:
                  num(row["HBP"]),

                so:
                  num(row["SO"]),

                gdp:
                  num(row["GDP"]),
              });
            }
          );
      }
    );


    /*
      KBO 페이지에 표시된 순서를 유지하면서
      마지막 최대 10경기 사용.
    */
    const recent10Games =
      games.slice(-10);

    const recent5Games =
      recent10Games.slice(-5);


    return NextResponse.json({
      playerId:
        Number(playerId),

      found:
        recent10Games.length > 0,

      recent5:
        aggregate(
          recent5Games
        ),

      recent10:
        aggregate(
          recent10Games
        ),

      gameLog:
        recent10Games,
    });

  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "최근 타격 기록 조회 실패",
      },
      {
        status: 500,
      }
    );
  }
}

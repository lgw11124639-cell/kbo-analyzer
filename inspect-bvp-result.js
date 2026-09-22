import * as cheerio from "cheerio";

const URL =
  "https://www.koreabaseball.com/Record/Etc/HitVsPit.aspx";

const PITCHER_TEAM =
  "ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$ddlPitcherTeam";

const PITCHER_PLAYER =
  "ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$ddlPitcherPlayer";

const HITTER_TEAM =
  "ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$ddlHitterTeam";

const HITTER_PLAYER =
  "ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$ddlHitterPlayer";

const SEARCH_BUTTON =
  "ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$btnSearch";


function hiddenFields(html) {
  const $ =
    cheerio.load(html);

  const result = {};

  $("input[type=hidden]").each(
    (_, el) => {
      const name =
        $(el).attr("name");

      if (!name) return;

      result[name] =
        $(el).attr("value") ?? "";
    }
  );

  return result;
}


async function request(
  method,
  body,
  cookie
) {
  const res =
    await fetch(
      URL,
      {
        method,

        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",

          "Accept-Language":
            "ko-KR,ko;q=0.9",

          ...(method === "POST"
            ? {
                "Content-Type":
                  "application/x-www-form-urlencoded",
              }
            : {}),

          ...(cookie
            ? {
                Cookie: cookie,
              }
            : {}),
        },

        body:
          method === "POST"
            ? body
            : undefined,
      }
    );

  return {
    html:
      await res.text(),

    cookie:
      res.headers.get(
        "set-cookie"
      ) ?? cookie ?? "",
  };
}


async function postback(
  html,
  cookie,
  eventTarget,
  values
) {
  const fields =
    hiddenFields(html);

  const body =
    new URLSearchParams();

  for (
    const [k, v]
    of Object.entries(fields)
  ) {
    body.set(
      k,
      String(v)
    );
  }

  body.set(
    "__EVENTTARGET",
    eventTarget
  );

  body.set(
    "__EVENTARGUMENT",
    ""
  );

  for (
    const [k, v]
    of Object.entries(values)
  ) {
    body.set(
      k,
      String(v)
    );
  }

  return request(
    "POST",
    body,
    cookie
  );
}


async function main() {

  // 1. 초기 페이지
  const first =
    await request(
      "GET"
    );


  // 2. 두산 투수팀 선택
  const step1 =
    await postback(
      first.html,
      first.cookie,
      PITCHER_TEAM,
      {
        [PITCHER_TEAM]:
          "OB",

        [PITCHER_PLAYER]:
          "0",

        [HITTER_TEAM]:
          "",

        [HITTER_PLAYER]:
          "0",
      }
    );


  // 3. 최민석 선택
  const step2 =
    await postback(
      step1.html,
      step1.cookie,
      PITCHER_PLAYER,
      {
        [PITCHER_TEAM]:
          "OB",

        [PITCHER_PLAYER]:
          "55268",

        [HITTER_TEAM]:
          "",

        [HITTER_PLAYER]:
          "0",
      }
    );


  // 4. NC 타자팀 선택
  const step3 =
    await postback(
      step2.html,
      step2.cookie,
      HITTER_TEAM,
      {
        [PITCHER_TEAM]:
          "OB",

        [PITCHER_PLAYER]:
          "55268",

        [HITTER_TEAM]:
          "NC",

        [HITTER_PLAYER]:
          "0",
      }
    );


  // 5. 김주원 선택
  const step4 =
    await postback(
      step3.html,
      step3.cookie,
      HITTER_PLAYER,
      {
        [PITCHER_TEAM]:
          "OB",

        [PITCHER_PLAYER]:
          "55268",

        [HITTER_TEAM]:
          "NC",

        [HITTER_PLAYER]:
          "51907",
      }
    );


  // 6. 검색 버튼 POST
  const hidden =
    hiddenFields(
      step4.html
    );

  const body =
    new URLSearchParams();

  for (
    const [k, v]
    of Object.entries(hidden)
  ) {
    body.set(
      k,
      String(v)
    );
  }

  body.set(
    "__EVENTTARGET",
    ""
  );

  body.set(
    "__EVENTARGUMENT",
    ""
  );

  body.set(
    PITCHER_TEAM,
    "OB"
  );

  body.set(
    PITCHER_PLAYER,
    "55268"
  );

  body.set(
    HITTER_TEAM,
    "NC"
  );

  body.set(
    HITTER_PLAYER,
    "51907"
  );

  body.set(
    SEARCH_BUTTON,
    "검색"
  );

  const result =
    await request(
      "POST",
      body,
      step4.cookie
    );


  const $ =
    cheerio.load(
      result.html
    );


  console.log(
    "\n===== RESULT TABLES ====="
  );

  $("table").each(
    (tableIndex, table) => {

      const headers =
        $(table)
          .find("thead th")
          .map(
            (_, th) =>
              $(th)
                .text()
                .replace(/\s+/g, " ")
                .trim()
          )
          .get();

      const rows = [];

      $(table)
        .find("tbody tr")
        .each(
          (_, tr) => {

            const cells =
              $(tr)
                .find("th,td")
                .map(
                  (_, td) =>
                    $(td)
                      .text()
                      .replace(/\s+/g, " ")
                      .trim()
                )
                .get();

            if (
              cells.length
            ) {
              rows.push(
                cells
              );
            }
          }
        );

      if (
        headers.length ||
        rows.length
      ) {
        console.log(
          "\nTABLE",
          tableIndex
        );

        console.log(
          "HEADERS =",
          headers
        );

        console.log(
          "ROWS =",
          rows
        );
      }
    }
  );
}


main().catch(
  console.error
);

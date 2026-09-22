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


function hiddenFields(html) {
  const $ = cheerio.load(html);

  const fields = {};

  $("input[type=hidden]").each(
    (_, el) => {
      const name =
        $(el).attr("name");

      if (!name) return;

      fields[name] =
        $(el).attr("value") ?? "";
    }
  );

  return fields;
}


async function getPage() {
  const res =
    await fetch(URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept-Language":
          "ko-KR,ko;q=0.9",
      },
    });

  return {
    html: await res.text(),
    cookie:
      res.headers.get("set-cookie") ?? "",
  };
}


async function postBack(
  html,
  cookie,
  eventTarget,
  values
) {
  const hidden =
    hiddenFields(html);

  const body =
    new URLSearchParams();

  for (
    const [key, value]
    of Object.entries(hidden)
  ) {
    body.set(
      key,
      String(value)
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
    const [key, value]
    of Object.entries(values)
  ) {
    body.set(
      key,
      String(value)
    );
  }

  const res =
    await fetch(URL, {
      method: "POST",

      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",

        "Accept-Language":
          "ko-KR,ko;q=0.9",

        "Content-Type":
          "application/x-www-form-urlencoded",

        "Cookie":
          cookie,
      },

      body,
    });

  return await res.text();
}


function printSelect(
  html,
  selector
) {
  const $ =
    cheerio.load(html);

  console.log(
    "\nSELECT =",
    selector
  );

  $(`#${selector}`)
    .find("option")
    .each(
      (_, opt) => {
        console.log({
          value:
            $(opt).attr(
              "value"
            ),

          text:
            $(opt)
              .text()
              .trim(),
        });
      }
    );
}


async function main() {

  // --------------------------------------------------
  // 초기 페이지
  // --------------------------------------------------

  const first =
    await getPage();


  // --------------------------------------------------
  // 두산 투수팀 선택
  // --------------------------------------------------

  const pitcherHtml =
    await postBack(
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

  console.log(
    "\n===== 두산 투수 목록 ====="
  );

  printSelect(
    pitcherHtml,
    "cphContents_cphContents_cphContents_ddlPitcherPlayer"
  );


  // --------------------------------------------------
  // NC 타자팀 선택
  // --------------------------------------------------

  const hitterHtml =
    await postBack(
      first.html,
      first.cookie,
      HITTER_TEAM,
      {
        [PITCHER_TEAM]:
          "",

        [PITCHER_PLAYER]:
          "0",

        [HITTER_TEAM]:
          "NC",

        [HITTER_PLAYER]:
          "0",
      }
    );

  console.log(
    "\n===== NC 타자 목록 ====="
  );

  printSelect(
    hitterHtml,
    "cphContents_cphContents_cphContents_ddlHitterPlayer"
  );
}


main().catch(
  console.error
);

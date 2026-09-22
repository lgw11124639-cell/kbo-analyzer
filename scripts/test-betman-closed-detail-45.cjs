const { chromium } = require("playwright");

const URL =
  "https://www.betman.co.kr/main/mainPage/gamebuy/closedGameSlip.do" +
  "?gmId=G101&gmTs=260045";

function clean(text) {
  return text.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,
    ""
  );
}

function buildObjects(schedule) {
  const keys =
    Array.isArray(schedule?.keys)
      ? schedule.keys
      : [];

  const datas =
    Array.isArray(schedule?.datas)
      ? schedule.datas
      : [];

  return datas.map((row) =>
    Object.fromEntries(
      keys.map((key, i) => [
        key,
        row[i],
      ])
    )
  );
}

(async () => {
  console.log(
    "===== BETMAN CLOSED DETAIL 45 ====="
  );

  const browser =
    await chromium.launch({
      headless: true,
    });

  const context =
    await browser.newContext({
      viewport: {
        width: 1920,
        height: 1080,
      },
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    });

  const page =
    await context.newPage();

  let found = null;

  page.on(
    "response",
    async (response) => {
      if (found) return;

      const type =
        response.request()
          .resourceType();

      if (
        type !== "xhr" &&
        type !== "fetch"
      ) {
        return;
      }

      if (
        !response.url()
          .includes("betman.co.kr")
      ) {
        return;
      }

      try {
        const text =
          clean(
            await response.text()
          );

        if (
          !text.includes(
            "compSchedules"
          )
        ) {
          return;
        }

        const data =
          JSON.parse(text);

        if (
          !data?.compSchedules
        ) {
          return;
        }

        found = {
          url:
            response.url(),
          data,
        };

        console.log();
        console.log(
          "✅ compSchedules 발견"
        );

        console.log(
          "API:",
          response.url()
        );
      } catch {}
    }
  );

  try {
    const res =
      await page.goto(
        URL,
        {
          waitUntil:
            "domcontentloaded",
          timeout: 45000,
        }
      );

    console.log(
      "PAGE STATUS:",
      res?.status()
    );

    console.log(
      "TITLE:",
      await page.title()
    );

    await page.waitForTimeout(
      10000
    );

    if (!found) {
      console.log();
      console.log(
        "❌ compSchedules 응답 못 찾음"
      );

      console.log(
        "FINAL URL:",
        page.url()
      );

      process.exitCode = 1;
      return;
    }

    const rows =
      buildObjects(
        found.data
          .compSchedules
      );

    console.log();
    console.log(
      "TOTAL ROWS:",
      rows.length
    );

    const kbo =
      rows.filter(
        (r) =>
          r.leagueName ===
          "KBO"
      );

    console.log(
      "KBO ROWS:",
      kbo.length
    );

    const target =
      kbo.filter(
        (r) =>
          [
            "야구 승패",
            "야구 핸디캡",
            "야구 언더오버",
          ].includes(
            r.betNm
          )
      );

    console.log(
      "TARGET ROWS:",
      target.length
    );

    const games =
      new Set(
        target.map(
          (r) =>
            `${r.gameDate}|${r.homeName}|${r.awayName}`
        )
      );

    console.log(
      "KBO GAMES:",
      games.size
    );

    console.log();
    console.log(
      "===== KBO 과거 배당 ====="
    );

    for (const r of target) {
      console.log(
        [
          `SEQ=${r.matchSeq}`,
          r.homeName,
          "vs",
          r.awayName,
          `TYPE=${r.betNm}`,
          `WIN=${r.winAllot}`,
          `DRAW=${r.drawAllot}`,
          `LOSE=${r.loseAllot}`,
          `WIN_LINE=${r.winHandi}`,
          `LOSE_LINE=${r.loseHandi}`,
          `WIN_TXT=${r.winTxt}`,
          `LOSE_TXT=${r.loseTxt}`,
          `RESULT=${r.gameResult}`,
          `SCORE=${r.mchScore}`,
        ].join(" | ")
      );
    }

    console.log();
    console.log(
      "===== 결과 관련 필드 샘플 ====="
    );

    for (
      const r of target.slice(
        0,
        5
      )
    ) {
      console.log({
        matchSeq:
          r.matchSeq,

        home:
          r.homeName,

        away:
          r.awayName,

        betNm:
          r.betNm,

        gameResult:
          r.gameResult,

        mchScore:
          r.mchScore,

        protoStatus:
          r.protoStatus,

        gameReject:
          r.gameReject,
      });
    }
  } finally {
    await context.close()
      .catch(() => {});

    await browser.close()
      .catch(() => {});
  }
})().catch(
  (error) => {
    console.error(error);
    process.exit(1);
  }
);

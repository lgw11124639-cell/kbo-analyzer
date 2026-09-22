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
  const keys = Array.isArray(schedule?.keys)
    ? schedule.keys
    : [];

  const datas = Array.isArray(schedule?.datas)
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
  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });

  const page = await context.newPage();

  let found = null;

  page.on("response", async (response) => {
    if (found) return;

    if (
      !response.url().includes("gameInfoInq")
    ) {
      return;
    }

    try {
      const text = clean(
        await response.text()
      );

      const data = JSON.parse(text);

      if (data?.compSchedules) {
        found = data;

        console.log(
          "API:",
          response.url()
        );
      }
    } catch {}
  });

  await page.goto(URL, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });

  await page.waitForTimeout(8000);

  if (!found) {
    throw new Error(
      "compSchedules 못 찾음"
    );
  }

  const rows =
    buildObjects(
      found.compSchedules
    );

  const kbo =
    rows.filter(
      (r) =>
        r.leagueName === "KBO"
    );

  console.log(
    "KBO ROWS:",
    kbo.length
  );

  console.log();
  console.log(
    "===== betNm 종류 ====="
  );

  console.log(
    [...new Set(
      kbo.map(
        (r) => r.betNm
      )
    )]
  );

  console.log();
  console.log(
    "===== betTypNm 종류 ====="
  );

  console.log(
    [...new Set(
      kbo.map(
        (r) => r.betTypNm
      )
    )]
  );

  console.log();
  console.log(
    "===== KBO 샘플 20개 ====="
  );

  for (
    const r of kbo.slice(0, 20)
  ) {
    console.log({
      matchSeq: r.matchSeq,
      home: r.homeName,
      away: r.awayName,

      betNm: r.betNm,
      betTypId: r.betTypId,
      betTypNm: r.betTypNm,

      winTxt: r.winTxt,
      drawTxt: r.drawTxt,
      loseTxt: r.loseTxt,

      winAllot: r.winAllot,
      drawAllot: r.drawAllot,
      loseAllot: r.loseAllot,

      winHandi: r.winHandi,
      loseHandi: r.loseHandi,

      result: r.gameResult,
      score: r.mchScore,
    });
  }

  await context.close();
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

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
  const keys = Array.isArray(schedule?.keys) ? schedule.keys : [];
  const datas = Array.isArray(schedule?.datas) ? schedule.datas : [];

  return datas.map(data =>
    Object.fromEntries(keys.map((key, i) => [key, data[i]]))
  );
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const responsePromise = page.waitForResponse(
      r => r.url().includes("gameInfoInq"),
      { timeout: 30000 }
    );

    await page.goto(URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    const response = await responsePromise;
    const text = clean(await response.text());
    const json = JSON.parse(text);

    const rows = buildObjects(json.compSchedules);

    const target = rows.filter(row => {
      const home = String(row.homeName ?? "");
      const away = String(row.awayName ?? "");
      const league = String(row.leagueName ?? "");

      return (
        league.includes("KBO") &&
        home.includes("키움") &&
        away.includes("롯데")
      );
    });

    console.log("===== ROUND 45 롯데 @ 키움 RAW =====");
    console.log("ROWS:", target.length);

    console.table(
      target.map(row => ({
        date: row.gameDate,
        seq: row.matchSeq,

        handi: row.handi,
        betId: row.betId,
        betNm: row.betNm,
        betTypId: row.betTypId,
        betTypNm: row.betTypNm,

        winTxt: row.winTxt,
        winHandi: row.winHandi,
        winOdds: row.winAllot,

        drawTxt: row.drawTxt,
        drawHandi: row.drawHandi,
        drawOdds: row.drawAllot,

        loseTxt: row.loseTxt,
        loseHandi: row.loseHandi,
        loseOdds: row.loseAllot,

        result: row.gameResult,
        score: row.mchScore
      }))
    );

  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});

const { chromium } = require("playwright");

const rounds = [45, 46, 50, 93, 108];

function gmTs(round) {
  return `260${String(round).padStart(3, "0")}`;
}

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

  return datas.map(data =>
    Object.fromEntries(
      keys.map((key, i) => [
        key,
        data[i]
      ])
    )
  );
}

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext();

  try {
    for (const round of rounds) {
      const page = await context.newPage();

      const url =
        "https://www.betman.co.kr/main/mainPage/gamebuy/closedGameSlip.do" +
        `?gmId=G101&gmTs=${gmTs(round)}`;

      console.log(
        `\n\n================ ROUND ${round} ================`
      );

      try {
        const responsePromise =
          page.waitForResponse(
            r =>
              r.url().includes("gameInfoInq"),
            { timeout: 30000 }
          );

        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30000
        });

        const response =
          await responsePromise;

        console.log(
          "ENDPOINT:",
          response.url()
        );

        const json =
          JSON.parse(
            clean(
              await response.text()
            )
          );

        const rows =
          buildObjects(
            json.compSchedules
          ).filter(
            r =>
              String(
                r.leagueName ?? ""
              ).includes("KBO")
          );

        console.log(
          "KBO RAW ROWS:",
          rows.length
        );

        /*
          같은 경기의 모든 상품을 보기 위해
          첫 번째 KBO 홈/원정 조합 선택
        */
        const first = rows[0];

        if (!first) {
          console.log("NO KBO ROWS");
          await page.close();
          continue;
        }

        const sample =
          rows.filter(
            r =>
              r.homeName === first.homeName &&
              r.awayName === first.awayName
          );

        console.log(
          "SAMPLE:",
          first.awayName,
          "@",
          first.homeName
        );

        console.table(
          sample.map(r => ({
            date: r.gameDate,
            seq: r.matchSeq,

            handi: r.handi,

            betId: r.betId,
            betNm: r.betNm,

            betTypId: r.betTypId,
            betTypNm: r.betTypNm,

            winTxt: r.winTxt,
            winHandi: r.winHandi,
            winOdds: r.winAllot,

            drawTxt: r.drawTxt,
            drawHandi: r.drawHandi,
            drawOdds: r.drawAllot,

            loseTxt: r.loseTxt,
            loseHandi: r.loseHandi,
            loseOdds: r.loseAllot,

            gameResult: r.gameResult,
            score: r.mchScore
          }))
        );

        console.log(
          "RAW PRODUCT IDENTITIES:"
        );

        console.table(
          [...new Map(
            rows.map(r => [
              [
                r.handi,
                r.betId,
                r.betNm,
                r.betTypId,
                r.betTypNm
              ].join("|"),
              {
                handi: r.handi,
                betId: r.betId,
                betNm: r.betNm,
                betTypId: r.betTypId,
                betTypNm: r.betTypNm
              }
            ])
          ).values()]
        );

      } catch (err) {
        console.error(
          `ROUND ${round} ERROR:`,
          err.message
        );
      }

      await page.close();
    }
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});

const { chromium } = require("playwright");

(async () => {
  const browser =
    await chromium.launch({
      headless: true,
    });

  const context =
    await browser.newContext();

  const page =
    await context.newPage();

  const target =
    page.waitForResponse(
      r =>
        r.url().includes(
          "gameInfoInq"
        ) &&
        r.status() === 200,
      {
        timeout: 30000,
      }
    );

  await page.goto(
    "https://www.betman.co.kr/main/mainPage/gamebuy/closedGameSlip.do?gmId=G101&gmTs=260040",
    {
      waitUntil:
        "domcontentloaded",
      timeout: 30000,
    }
  );

  const response =
    await target;

  const json =
    await response.json();

  const cs =
    json.compSchedules;

  if (!cs) {
    throw new Error(
      "compSchedules 없음"
    );
  }

  const keys =
    cs.keys || [];

  const datas =
    cs.datas || [];

  const rows =
    datas.map(
      values =>
        Object.fromEntries(
          keys.map(
            (key, i) => [
              key,
              values[i],
            ]
          )
        )
    );

  const kbo =
    rows.filter(row => {
      const text =
        [
          row.leagueName,
          row.homeName,
          row.awayName,
        ]
          .join(" ")
          .toUpperCase();

      return (
        text.includes("KBO") ||
        text.includes("KIA") ||
        text.includes("LG")
      );
    });

  const targetRows =
    kbo.filter(row => {
      const home =
        String(
          row.homeName || ""
        );

      const away =
        String(
          row.awayName || ""
        );

      return (
        (
          home.includes("LG") &&
          away.includes("KIA")
        ) ||
        (
          home.includes("KIA") &&
          away.includes("LG")
        )
      );
    });

  console.log(
    "===== ROUND 40 KIA/LG RAW ====="
  );

  console.log(
    "ROWS:",
    targetRows.length
  );

  for (
    const row of targetRows
  ) {
    console.log();
    console.log(
      JSON.stringify(
        {
          matchSeq:
            row.matchSeq,

          gameDate:
            row.gameDate,

          leagueName:
            row.leagueName,

          homeName:
            row.homeName,

          awayName:
            row.awayName,

          betId:
            row.betId,

          betNm:
            row.betNm,

          betTypId:
            row.betTypId,

          betTypNm:
            row.betTypNm,

          winTxt:
            row.winTxt,

          drawTxt:
            row.drawTxt,

          loseTxt:
            row.loseTxt,

          winAllot:
            row.winAllot,

          drawAllot:
            row.drawAllot,

          loseAllot:
            row.loseAllot,

          handi:
            row.handi,

          winHandi:
            row.winHandi,

          drawHandi:
            row.drawHandi,

          loseHandi:
            row.loseHandi,

          gameKey:
            row.gameKey,

          gameResult:
            row.gameResult,

          mchScore:
            row.mchScore,

          protoStatus:
            row.protoStatus,
        },
        null,
        2
      )
    );
  }

  await browser.close();
})().catch(
  error => {
    console.error(error);
    process.exit(1);
  }
);

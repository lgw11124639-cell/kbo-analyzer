const fs = require("fs");
const { chromium } = require("playwright");

const history = JSON.parse(
  fs.readFileSync(
    "data/betman-kbo-history-2026.json",
    "utf8"
  )
);

const game = (history.games || []).find(
  g =>
    g.date === "2026-04-10" &&
    String(g.awayTeam).includes("롯데") &&
    String(g.homeTeam).includes("키움")
);

if (!game) {
  throw new Error("대상 경기 없음");
}

console.log("===== 저장 데이터 =====");
console.log(JSON.stringify(game, null, 2));

(async () => {
  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  const wait = page.waitForResponse(
    r =>
      r.url().includes("gameInfoInq") &&
      r.status() === 200,
    { timeout: 30000 }
  );

  await page.goto(
    `https://www.betman.co.kr/main/mainPage/gamebuy/closedGameSlip.do?gmId=G101&gmTs=${game.gmTs}`,
    {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    }
  );

  const response = await wait;
  const json = await response.json();

  const keys =
    json.compSchedules?.keys || [];

  const rows =
    (json.compSchedules?.datas || []).map(
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

  const target = rows.filter(row => {
    return (
      row.leagueName === "KBO" &&
      String(row.homeName).includes("키움") &&
      String(row.awayName).includes("롯데")
    );
  });

  console.log();
  console.log("===== 원본 전체 상품 =====");
  console.log("ROWS:", target.length);

  for (const row of target) {
    console.log(
      "===== MATCHSEQ", row.matchSeq, "====="
    );
    console.log(
      JSON.stringify(row, null, 2)
    );
  }

  await browser.close();
})().catch(error => {
  console.error(error);
  process.exit(1);
});

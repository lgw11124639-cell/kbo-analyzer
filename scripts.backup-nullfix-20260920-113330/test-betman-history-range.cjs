const { chromium } = require("playwright");

const BASE = "https://www.betman.co.kr";
const START_ROUND = 108;
const END_ROUND = 100;
const YEAR = 2026;

function gmTsFromRound(round) {
  return Number(
    `${String(YEAR).slice(-2)}${String(round).padStart(3, "0")}`
  );
}

function cleanControlChars(text) {
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
      keys.map((key, index) => [
        key,
        row[index],
      ])
    )
  );
}

function validOdd(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 1
  );
}

(async () => {
  console.log(
    "===== BETMAN HISTORY RANGE TEST ====="
  );

  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    viewport: {
      width: 1920,
      height: 1080,
    },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });

  const page = await context.newPage();
  const results = [];

  try {
    for (
      let round = START_ROUND;
      round >= END_ROUND;
      round--
    ) {
      const gmTs = gmTsFromRound(round);

      const url =
        BASE +
        "/main/mainPage/gamebuy/gameSlip.do" +
        `?gmId=G101&gmTs=${gmTs}&gameDivCd=C`;

      console.log();
      console.log(
        `===== ${YEAR}년 ${round}회 / gmTs=${gmTs} =====`
      );

      try {
        const [gameResponse] =
          await Promise.all([
            page.waitForResponse(
              (response) =>
                response.url().includes(
                  "gameInfoInq.do"
                ) &&
                response.status() === 200,
              {
                timeout: 20000,
              }
            ),

            page.goto(url, {
              waitUntil: "domcontentloaded",
              timeout: 30000,
            }),
          ]);

        const text = cleanControlChars(
          await gameResponse.text()
        );

        const data = JSON.parse(text);

        if (!data?.compSchedules) {
          console.log(
            "❌ 과거 발매정보 없음"
          );

          results.push({
            round,
            gmTs,
            ok: false,
            kboGames: 0,
            gamesWithOdds: 0,
          });

          continue;
        }

        const rows = buildObjects(
          data.compSchedules
        );

        const kboRows = rows.filter(
          (row) =>
            row.leagueName === "KBO"
        );

        const targetRows = kboRows.filter(
          (row) =>
            [
              "야구 승패",
              "야구 핸디캡",
              "야구 언더오버",
            ].includes(row.betNm)
        );

        const rowsWithOdds =
          targetRows.filter(
            (row) =>
              validOdd(row.winAllot) ||
              validOdd(row.loseAllot)
          );

        const games = new Set(
          kboRows.map((row) =>
            [
              row.gameDate,
              row.homeName,
              row.awayName,
            ].join("|")
          )
        );

        const gamesWithOdds = new Set(
          rowsWithOdds.map((row) =>
            [
              row.gameDate,
              row.homeName,
              row.awayName,
            ].join("|")
          )
        );

        console.log(
          "KBO games:",
          games.size
        );

        console.log(
          "target rows:",
          targetRows.length
        );

        console.log(
          "rows with odds:",
          rowsWithOdds.length
        );

        console.log(
          "games with odds:",
          gamesWithOdds.size
        );

        results.push({
          round,
          gmTs,
          ok: true,
          kboGames: games.size,
          gamesWithOdds:
            gamesWithOdds.size,
          targetRows:
            targetRows.length,
          rowsWithOdds:
            rowsWithOdds.length,
        });

        await page.waitForTimeout(1000);
      } catch (error) {
        console.log(
          "❌",
          error.message
        );

        results.push({
          round,
          gmTs,
          ok: false,
          kboGames: 0,
          gamesWithOdds: 0,
        });
      }
    }
  } finally {
    await context.close()
      .catch(() => {});

    await browser.close()
      .catch(() => {});
  }

  console.log();
  console.log(
    "===== 최종 결과 ====="
  );

  console.table(results);
})();

const { chromium } = require("playwright");

const PROFILE_DIR =
  "/opt/kbo-analyzer/.betman-browser";

const TARGET_URL =
  "https://www.betman.co.kr/main/mainPage/gamebuy/gameSlip.do" +
  "?gmId=G101&gameDivCd=C";

(async () => {
  console.log(
    "===== BETMAN CURRENT ROUND TEST ====="
  );

  const context =
    await chromium.launchPersistentContext(
      PROFILE_DIR,
      {
        headless: true,

        viewport: {
          width: 1920,
          height: 1080,
        },

        locale: "ko-KR",
        timezoneId: "Asia/Seoul",
      }
    );

  const page =
    context.pages()[0] ||
    await context.newPage();

  let found = false;

  page.on(
    "response",
    async (response) => {
      const url = response.url();

      if (
        !url.includes(
          "gameInfoInq.do"
        )
      ) {
        return;
      }

      try {
        const text =
          await response.text();

        if (
          !text.includes(
            '"currentLottery"'
          )
        ) {
          return;
        }

        const clean =
          text.replace(
            /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,
            ""
          );

        const data =
          JSON.parse(clean);

        const lottery =
          data.currentLottery;

        console.log();
        console.log(
          "===== CURRENT LOTTERY ====="
        );

        console.log(
          "gmId:",
          lottery?.gmId
        );

        console.log(
          "gmTs:",
          lottery?.gmTs
        );

        console.log(
          "gmOsidTs:",
          lottery?.gmOsidTs
        );

        console.log(
          "year:",
          lottery?.gmOsidTsYear
        );

        console.log(
          "saleStatus:",
          lottery?.saleStatus
        );

        console.log(
          "mainStatusMessage:",
          lottery?.mainStatusMessage
        );

        const schedules =
          data?.compSchedules;

        const keys =
          Array.isArray(
            schedules?.keys
          )
            ? schedules.keys
            : [];

        const rows =
          Array.isArray(
            schedules?.datas
          )
            ? schedules.datas
            : [];

        const objects =
          rows.map(
            (row) =>
              Object.fromEntries(
                keys.map(
                  (key, index) => [
                    key,
                    row[index],
                  ]
                )
              )
          );

        const kbo =
          objects.filter(
            (row) =>
              row.leagueName ===
              "KBO"
          );

        console.log(
          "KBO ROWS:",
          kbo.length
        );

        const dates =
          [
            ...new Set(
              kbo.map(
                (row) =>
                  new Intl.DateTimeFormat(
                    "en-CA",
                    {
                      timeZone:
                        "Asia/Seoul",
                      year:
                        "numeric",
                      month:
                        "2-digit",
                      day:
                        "2-digit",
                    }
                  ).format(
                    new Date(
                      Number(
                        row.gameDate
                      )
                    )
                  )
              )
            ),
          ];

        console.log(
          "KBO DATES:",
          dates
        );

        found = true;
      } catch (error) {
        console.log(
          "PARSE ERROR:",
          error.message
        );
      }
    }
  );

  try {
    const response =
      await page.goto(
        TARGET_URL,
        {
          waitUntil:
            "domcontentloaded",
          timeout: 45000,
        }
      );

    console.log();
    console.log(
      "PAGE STATUS:",
      response?.status()
    );

    console.log(
      "FINAL URL:",
      page.url()
    );

    console.log(
      "TITLE:",
      await page.title()
    );

    await page.waitForTimeout(
      10000
    );

    console.log();
    console.log(
      "GAME INFO FOUND:",
      found
    );
  } finally {
    await context.close();
  }
})();

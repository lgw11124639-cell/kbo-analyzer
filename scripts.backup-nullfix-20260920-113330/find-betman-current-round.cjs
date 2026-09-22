const { chromium } = require("playwright");

const PROFILE_DIR =
  "/opt/kbo-analyzer/.betman-browser";

const TARGET_URL =
  "https://www.betman.co.kr/main/mainPage/gamebuy/gameSlip.do" +
  "?gmId=G101&gameDivCd=C";

(async () => {
  console.log("===== BETMAN CURRENT ROUND DISCOVERY =====");

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

  const candidates = [];

  page.on("response", async (response) => {
    const req = response.request();
    const type = req.resourceType();

    if (
      type !== "xhr" &&
      type !== "fetch"
    ) {
      return;
    }

    const url = response.url();

    if (
      !url.includes("betman.co.kr")
    ) {
      return;
    }

    const name =
      url.split("/").pop()?.split("?")[0] ||
      url;

    console.log(
      "XHR/FETCH:",
      response.status(),
      name
    );

    if (
      /inqCacheBuyAbleGameInfoList|gameInfoInq|retrieveComCodeList/i.test(
        url
      )
    ) {
      try {
        const text =
          await response.text();

        console.log(
          "  SIZE:",
          Buffer.byteLength(
            text,
            "utf8"
          )
        );

        console.log(
          "  HAS 260109:",
          text.includes("260109")
        );

        console.log(
          "  HAS gmTs:",
          /gmTs|GM_TS/i.test(text)
        );

        console.log(
          "  HAS G101:",
          text.includes("G101")
        );

        candidates.push({
          name,
          text,
        });
      } catch (error) {
        console.log(
          "  READ ERROR:",
          error.message
        );
      }
    }
  });

  try {
    const res =
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
      res?.status()
    );

    console.log(
      "TITLE:",
      await page.title()
    );

    await page.waitForTimeout(
      12000
    );

    console.log();
    console.log("===== CANDIDATE RESPONSES =====");

    for (
      const item of candidates
    ) {
      console.log();
      console.log(
        "-----",
        item.name,
        "-----"
      );

      const cleaned =
        item.text.replace(
          /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,
          ""
        );

      console.log(
        cleaned.slice(
          0,
          5000
        )
      );
    }

    console.log();
    console.log(
      "FINAL URL:",
      page.url()
    );
  } finally {
    await context.close();
  }
})();

const { chromium } = require("playwright");
const fs = require("fs");

const PROFILE_DIR = "/opt/kbo-analyzer/.betman-browser";

const TARGET_URL =
  "https://www.betman.co.kr/main/mainPage/gamebuy/gameSlip.do" +
  "?gmId=G101&gmTs=260109&gameDivCd=C";

(async () => {
  console.log("===== BETMAN SERVER CHROMIUM TEST =====");

  const context = await chromium.launchPersistentContext(
    PROFILE_DIR,
    {
      headless: true,

      viewport: {
        width: 1920,
        height: 1080,
      },

      locale: "ko-KR",

      timezoneId: "Asia/Seoul",

      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/153.0.0.0 Safari/537.36",
    }
  );

  const page =
    context.pages()[0] ||
    await context.newPage();

  let gameInfoSeen = false;

  page.on("response", async (response) => {
    const url = response.url();

    if (!url.includes("gameInfoInq.do")) {
      return;
    }

    gameInfoSeen = true;

    console.log();
    console.log("===== gameInfoInq RESPONSE =====");
    console.log("STATUS:", response.status());
    console.log("URL:", url);

    try {
      const text = await response.text();

      console.log(
        "BODY SIZE:",
        Buffer.byteLength(text, "utf8")
      );

      console.log(
        "HAS currentLottery:",
        text.includes('"currentLottery"')
      );

      console.log(
        "HAS compSchedules:",
        text.includes('"compSchedules"')
      );

      console.log(
        "HAS SSG:",
        text.includes("SSG 랜더스")
      );

      console.log(
        "HAS ACCESS DENIED:",
        /accessDenied|접근.?거부/i.test(text)
      );

      if (
        text.includes('"currentLottery"') &&
        text.includes('"compSchedules"')
      ) {
        fs.writeFileSync(
          "/tmp/betman-playwright-response.json",
          text,
          "utf8"
        );

        console.log(
          "✅ 응답 저장:",
          "/tmp/betman-playwright-response.json"
        );
      }
    } catch (error) {
      console.log(
        "BODY READ ERROR:",
        error.message
      );
    }
  });

  try {
    console.log();
    console.log("===== PAGE OPEN =====");

    const response = await page.goto(
      TARGET_URL,
      {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      }
    );

    console.log(
      "PAGE STATUS:",
      response?.status() ?? null
    );

    console.log(
      "PAGE URL:",
      page.url()
    );

    console.log(
      "TITLE:",
      await page.title()
    );

    await page.waitForTimeout(10000);

    const cookies =
      await context.cookies(
        "https://www.betman.co.kr"
      );

    console.log();
    console.log("===== COOKIE NAMES ONLY =====");
    console.log(
      cookies.map((c) => c.name)
    );

    console.log();
    console.log(
      "gameInfoInq SEEN:",
      gameInfoSeen
    );

    console.log();
    console.log("===== PAGE TEXT CHECK =====");

    const bodyText =
      await page.locator("body")
        .innerText()
        .catch(() => "");

    console.log(
      "HAS 프로토:",
      bodyText.includes("프로토")
    );

    console.log(
      "HAS SSG:",
      bodyText.includes("SSG")
    );

    console.log(
      "HAS 삼성:",
      bodyText.includes("삼성")
    );

    console.log(
      "HAS 접근거부:",
      /접근.?거부|access denied/i.test(
        bodyText
      )
    );

    await page.screenshot({
      path:
        "/tmp/betman-server-page.png",
      fullPage: false,
    });

    console.log();
    console.log(
      "SCREENSHOT:",
      "/tmp/betman-server-page.png"
    );
  } catch (error) {
    console.error();
    console.error(
      "❌ PAGE ERROR:",
      error
    );
  } finally {
    await context.close();
  }
})();

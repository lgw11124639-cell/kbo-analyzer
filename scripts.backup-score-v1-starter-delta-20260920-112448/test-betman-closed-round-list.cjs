const { chromium } = require("playwright");

const URL =
  "https://www.betman.co.kr/main/mainPage/gamebuy/closedGameList.do" +
  "?sbx_gmCase=&sbx_gmType=G101&curPage=1&perPage=10";

(async () => {
  console.log(
    "===== BETMAN CLOSED ROUND LIST TEST ====="
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

  try {
    const response =
      await page.goto(
        URL,
        {
          waitUntil:
            "networkidle",
          timeout: 45000,
        }
      );

    console.log(
      "PAGE STATUS:",
      response?.status()
    );

    console.log(
      "TITLE:",
      await page.title()
    );

    console.log(
      "FINAL URL:",
      page.url()
    );

    console.log();
    console.log(
      "===== PAGE TEXT CHECK ====="
    );

    const bodyText =
      await page
        .locator("body")
        .innerText();

    console.log(
      "HAS 마감게임보기:",
      bodyText.includes(
        "마감게임보기"
      )
    );

    console.log(
      "HAS 프로토 승부식:",
      bodyText.includes(
        "프로토 승부식"
      )
    );

    console.log(
      "HAS 108회:",
      bodyText.includes(
        "108회"
      )
    );

    console.log();
    console.log(
      "===== 프로토 승부식 링크 ====="
    );

    const links =
      await page
        .locator("a")
        .evaluateAll(
          (anchors) =>
            anchors
              .map((a) => ({
                text:
                  (a.textContent || "")
                    .replace(
                      /\s+/g,
                      " "
                    )
                    .trim(),

                href:
                  a.getAttribute(
                    "href"
                  ) || "",

                onclick:
                  a.getAttribute(
                    "onclick"
                  ) || "",
              }))
              .filter(
                (item) =>
                  item.text.includes(
                    "프로토 승부식"
                  )
              )
        );

    console.log(
      "FOUND:",
      links.length
    );

    links.forEach(
      (item, index) => {
        console.log();
        console.log(
          `#${index + 1}`
        );
        console.log(
          "TEXT:",
          item.text
        );
        console.log(
          "HREF:",
          item.href
        );
        console.log(
          "ONCLICK:",
          item.onclick
        );
      }
    );

    console.log();
    console.log(
      "===== 회차 추출 ====="
    );

    const rounds =
      links
        .map((item) => {
          const match =
            item.text.match(
              /프로토\s*승부식\s*(\d+)회/
            );

          return match
            ? Number(
                match[1]
              )
            : null;
        })
        .filter(
          (value) =>
            Number.isFinite(
              value
            )
        );

    console.log(
      rounds
    );

    console.log();
    console.log(
      "===== TABLE ROWS ====="
    );

    const rows =
      await page
        .locator("tr")
        .evaluateAll(
          (trs) =>
            trs
              .map(
                (tr) =>
                  (tr.innerText || "")
                    .replace(
                      /\s+/g,
                      " "
                    )
                    .trim()
              )
              .filter(
                (text) =>
                  text.includes(
                    "프로토 승부식"
                  )
              )
        );

    rows.forEach(
      (row, index) => {
        console.log(
          `${index + 1}.`,
          row
        );
      }
    );

    await page.screenshot({
      path:
        "/tmp/betman-closed-list.png",
      fullPage: true,
    });

    console.log();
    console.log(
      "SCREENSHOT:",
      "/tmp/betman-closed-list.png"
    );
  } finally {
    await context.close()
      .catch(() => {});

    await browser.close()
      .catch(() => {});
  }
})().catch(
  (error) => {
    console.error(
      "❌ ERROR"
    );
    console.error(error);
    process.exit(1);
  }
);

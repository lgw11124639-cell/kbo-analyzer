const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ROOT = "/opt/kbo-analyzer";
const PROFILE_DIR = path.join(ROOT, ".betman-browser");
const OUTPUT_FILE = path.join(ROOT, "data/betman-kbo-live.json");

const BASE =
  "https://www.betman.co.kr";

const ENTRY_URL =
  BASE +
  "/main/mainPage/gamebuy/gameSlip.do" +
  "?gmId=G101&gameDivCd=C";

function cleanControlChars(text) {
  return text.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,
    ""
  );
}

function toKstDate(ms) {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }
  ).format(
    new Date(Number(ms))
  );
}

function toIso(ms) {
  if (!ms) return null;

  const d = new Date(Number(ms));

  return Number.isNaN(d.getTime())
    ? null
    : d.toISOString();
}

function validOdd(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 1
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

  return datas.map((row) =>
    Object.fromEntries(
      keys.map(
        (key, index) => [
          key,
          row[index],
        ]
      )
    )
  );
}

function normalizeKboRows(data) {
  const rows =
    buildObjects(
      data?.compSchedules
    );

  const allowedProducts =
    new Set([
      "야구 승패",
      "야구 핸디캡",
      "야구 언더오버",
    ]);

  const kboRows =
    rows.filter(
      (row) =>
        row.leagueName === "KBO" &&
        allowedProducts.has(
          row.betNm
        )
    );

  const games =
    new Map();

  for (const row of kboRows) {
    const date =
      toKstDate(
        row.gameDate
      );

    const key =
      [
        date,
        row.homeName,
        row.awayName,
      ].join("|");

    if (!games.has(key)) {
      games.set(
        key,
        {
          id:
            `betman-${date}-${row.homeId}-${row.awayId}`,

          provider:
            "betman",

          date,

          commenceTime:
            toIso(
              row.gameDate
            ),

          matchSeq:
            row.matchSeq,

          league:
            "KBO",

          homeTeamRaw:
            row.homeName,

          awayTeamRaw:
            row.awayName,

          stadium:
            row.meetStadiumFullName ||
            null,

          moneyline: null,
          spread: null,
          total: null,
        }
      );
    }

    const game =
      games.get(key);

    if (
      row.betNm ===
      "야구 승패"
    ) {
      if (
        validOdd(
          row.winAllot
        ) &&
        validOdd(
          row.loseAllot
        )
      ) {
        game.moneyline = {
          matchSeq:
            row.matchSeq,

          homeOdds:
            row.winAllot,

          awayOdds:
            row.loseAllot,
        };
      }
    }

    if (
      row.betNm ===
      "야구 핸디캡"
    ) {
      if (
        validOdd(
          row.winAllot
        ) &&
        validOdd(
          row.loseAllot
        ) &&
        typeof row.winHandi ===
          "number" &&
        typeof row.loseHandi ===
          "number" &&
        (
          row.winHandi !== 0 ||
          row.loseHandi !== 0
        )
      ) {
        game.spread = {
          matchSeq:
            row.matchSeq,

          homeLine:
            row.winHandi,

          homeOdds:
            row.winAllot,

          awayLine:
            row.loseHandi,

          awayOdds:
            row.loseAllot,
        };
      }
    }

    if (
      row.betNm ===
      "야구 언더오버"
    ) {
      const winTxt =
        String(
          row.winTxt || ""
        ).trim();

      const loseTxt =
        String(
          row.loseTxt || ""
        ).trim();

      const line =
        typeof row.winHandi ===
          "number" &&
        row.winHandi > 0
          ? row.winHandi
          : typeof row.loseHandi ===
              "number" &&
            row.loseHandi > 0
            ? row.loseHandi
            : null;

      if (
        line !== null &&
        validOdd(
          row.winAllot
        ) &&
        validOdd(
          row.loseAllot
        )
      ) {
        let underOdds = null;
        let overOdds = null;

        if (
          winTxt === "언더"
        ) {
          underOdds =
            row.winAllot;
        }

        if (
          winTxt === "오버"
        ) {
          overOdds =
            row.winAllot;
        }

        if (
          loseTxt === "언더"
        ) {
          underOdds =
            row.loseAllot;
        }

        if (
          loseTxt === "오버"
        ) {
          overOdds =
            row.loseAllot;
        }

        if (
          validOdd(
            underOdds
          ) &&
          validOdd(
            overOdds
          )
        ) {
          game.total = {
            matchSeq:
              row.matchSeq,

            line,

            underOdds,
            overOdds,
          };
        }
      }
    }
  }

  return [
    ...games.values(),
  ].filter(
    (game) =>
      game.moneyline ||
      game.spread ||
      game.total
  );
}

function waitForResponseText(page, needle, timeout = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      page.off("response", onResponse);
    };
    const onResponse = async (response) => {
      if (settled) return;
      if (!response.url().includes(needle) || response.status() !== 200) return;
      try {
        const text = await response.text();
        if (settled) return;
        settled = true;
        cleanup();
        resolve(text);
      } catch (error) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      }
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("BETMAN_RESPONSE_TIMEOUT " + needle));
    }, timeout);
    page.on("response", onResponse);
  });
}

async function collect() {
  console.log(
    "===== BETMAN KBO COLLECTOR ====="
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

      locale:
        "ko-KR",

      timezoneId:
        "Asia/Seoul",
  });

  const page =
    await context.newPage();

  let currentRound = null;

  try {
    console.log(
      "1. 현재 회차 탐색..."
    );

    const roundTextPromise = waitForResponseText(
      page,
      "inqCacheBuyAbleGameInfoList.do",
      30000
    );

    const [, roundRawText] = await Promise.all([
      page.goto(
        ENTRY_URL,
        {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        }
      ),
      roundTextPromise,
    ]);

    const roundText =
      cleanControlChars(
        roundRawText
      );

    const roundData =
      JSON.parse(
        roundText
      );

    console.log(
      "ROUND_DEBUG_KEYS",
      Object.keys(roundData || {})
    );

    console.log(
      "ROUND_DEBUG_PROTO_TYPE",
      typeof roundData?.protoGames,
      Array.isArray(roundData?.protoGames)
    );

    console.log(
      "ROUND_DEBUG_PROTO_SAMPLE",
      JSON.stringify(
        Array.isArray(roundData?.protoGames)
          ? roundData.protoGames.slice(0, 10)
          : roundData?.protoGames,
        null,
        2
      )
    );

    console.log(
      "ROUND_DEBUG_TOTO_SAMPLE",
      JSON.stringify(
        Array.isArray(roundData?.totoGames)
          ? roundData.totoGames.slice(0, 20)
          : roundData?.totoGames,
        null,
        2
      )
    );

    const protoGames =
      Array.isArray(
        roundData?.protoGames
      )
        ? roundData.protoGames
        : [];

    currentRound =
      protoGames
        .filter(
          (game) =>
            game?.gmId ===
            "G101"
        )
        .sort(
          (a, b) =>
            Number(
              b.gmTs || 0
            ) -
            Number(
              a.gmTs || 0
            )
        )[0] ||
      null;

    if (
      !currentRound?.gmTs
    ) {
      console.log();
      console.log(
        "ℹ️ 현재 발매 중인 프로토 승부식(G101) 회차가 없습니다."
      );
      console.log(
        "   기존 live 배당 파일은 유지하고 다음 주기에 다시 확인합니다."
      );
      return;
    }

    console.log(
      "   gmTs:",
      currentRound.gmTs
    );

    console.log(
      "   회차:",
      currentRound.gmOsidTs
    );

    console.log(
      "   연도:",
      currentRound.gmOsidTsYear
    );

    console.log();
    console.log(
      "2. 현재 회차 게임 데이터 수집..."
    );

    const gameUrl =
      BASE +
      "/main/mainPage/gamebuy/gameSlip.do" +
      `?gmId=G101&gmTs=${currentRound.gmTs}&gameDivCd=C`;

    const gameTextPromise = waitForResponseText(
      page,
      "gameInfoInq.do",
      30000
    );

    const [, gameRawText] = await Promise.all([
      page.goto(
        gameUrl,
        {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        }
      ),
      gameTextPromise,
    ]);

    const gameText =
      cleanControlChars(
        gameRawText
      );

    const data =
      JSON.parse(
        gameText
      );

    if (
      !data?.currentLottery ||
      !data?.compSchedules
    ) {
      throw new Error(
        "Betman 게임 응답 구조가 예상과 다릅니다."
      );
    }

    const events =
      normalizeKboRows(
        data
      );

    const output = {
      provider:
        "betman",

      fetchedAt:
        new Date()
          .toISOString(),

      gmId:
        data.currentLottery.gmId ||
        "G101",

      gmTs:
        data.currentLottery.gmTs ||
        currentRound.gmTs,

      round:
        data.currentLottery.gmOsidTs ||
        currentRound.gmOsidTs ||
        null,

      roundYear:
        data.currentLottery.gmOsidTsYear ||
        currentRound.gmOsidTsYear ||
        null,

      saleStatus:
        data.currentLottery.saleStatus ||
        null,

      statusMessage:
        data.currentLottery.mainStatusMessage ||
        data.currentLottery.statusMessage ||
        null,

      events,
    };

    fs.mkdirSync(
      path.dirname(
        OUTPUT_FILE
      ),
      {
        recursive: true,
      }
    );

    const tempFile =
      OUTPUT_FILE +
      ".tmp";

    fs.writeFileSync(
      tempFile,
      JSON.stringify(
        output,
        null,
        2
      ),
      "utf8"
    );

    fs.renameSync(
      tempFile,
      OUTPUT_FILE
    );

    console.log();
    console.log(
      "✅ 저장 완료"
    );

    console.log(
      "   FILE:",
      OUTPUT_FILE
    );

    console.log(
      "   EVENTS:",
      events.length
    );

    for (
      const event of events
    ) {
      console.log(
        `   ${event.date} ${event.homeTeamRaw} vs ${event.awayTeamRaw}`,
        JSON.stringify({
          ML:
            event.moneyline,
          SP:
            event.spread,
          OU:
            event.total,
        })
      );
    }
  } finally {
    await context.close()
      .catch(() => {});

    await browser.close()
      .catch(() => {});
  }
}

collect().catch(
  (error) => {
    console.error();
    console.error(
      "❌ BETMAN COLLECT ERROR"
    );

    console.error(
      error
    );

    process.exit(1);
  }
);

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ROOT = "/opt/kbo-analyzer";

const OUTPUT =
  path.join(
    ROOT,
    "data",
    "betman-kbo-history-2026.json"
  );

const BASE =
  "https://www.betman.co.kr";

const YEAR = 2026;

const START_ROUND = 108;
const END_ROUND = 1;

const DELAY_MS = 900;

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );
}

function clean(text) {
  return text.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,
    ""
  );
}

function gmTsFromRound(round) {
  return Number(
    `${String(YEAR).slice(-2)}0${String(round).padStart(3, "0")}`
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

  return datas.map(
    (row) =>
      Object.fromEntries(
        keys.map(
          (key, i) => [
            key,
            row[i],
          ]
        )
      )
  );
}

function toKstDate(ms) {
  return new Intl.DateTimeFormat(
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
      Number(ms)
    )
  );
}

function toIso(ms) {
  const d =
    new Date(
      Number(ms)
    );

  if (
    Number.isNaN(
      d.getTime()
    )
  ) {
    return null;
  }

  return d.toISOString();
}

function validOdd(v) {
  return (
    typeof v ===
      "number" &&
    Number.isFinite(v) &&
    v > 1
  );
}

function parseScore(value) {
  if (
    typeof value !==
      "string"
  ) {
    return null;
  }

  const m =
    value.match(
      /^\s*(-?\d+(?:\.\d+)?)\s*:\s*(-?\d+(?:\.\d+)?)\s*$/
    );

  if (!m) {
    return null;
  }

  return {
    home:
      Number(m[1]),
    away:
      Number(m[2]),
  };
}

function gameKey(row) {
  return [
    row.gameDate,
    row.homeName,
    row.awayName,
  ].join("|");
}

function normalizeRound(
  data,
  round,
  gmTs
) {
  const rows =
    buildObjects(
      data?.compSchedules
    );

  const kboRows =
    rows.filter(
      (row) =>
        row.leagueName ===
        "KBO"
    );

  const target =
    kboRows
      .map((row) => {
        /*
          Betman Proto KBO 상품 분류

          구형 API (gameInfoInqAsis.do):
          - betNm / betId 없음
          - handi 코드로 구분
              0 = 풀게임 승패
              2 = 풀게임 핸디캡
              9 = 풀게임 언더오버

          신형 API (gameInfoInq.do):
          - betNm / betId 존재
          - handi 값만으로는 풀게임/전반 구분 불가
            예: 풀게임 U/O와 전반 U/O 모두 handi=9
          - 따라서 betId + betNm으로 정확히 구분

          신형 허용:
              betId 2  = 야구 승패
              betId 7  = 야구 핸디캡
              betId 79 = 야구 언더오버

          제외:
              야구 승1패
              야구 SUM
              야구 전반 승무패
              야구 전반 핸디캡
              야구 전반 언더오버
        */

        const betNm =
          typeof row.betNm === "string"
            ? row.betNm.trim()
            : "";

        const betId =
          row.betId == null
            ? ""
            : String(row.betId);

        /*
          신형 API
        */
        if (betNm) {
          if (
            betId === "2" &&
            betNm === "야구 승패"
          ) {
            return row;
          }

          if (
            betId === "7" &&
            betNm === "야구 핸디캡"
          ) {
            return row;
          }

          if (
            betId === "79" &&
            betNm === "야구 언더오버"
          ) {
            return row;
          }

          return null;
        }

        /*
          구형 API
        */
        const handiCode =
          Number(
            row.handi ?? -1
          );

        if (handiCode === 0) {
          return {
            ...row,
            betNm:
              "야구 승패",
            winTxt:
              "승",
            loseTxt:
              "패",
          };
        }

        if (handiCode === 2) {
          return {
            ...row,
            betNm:
              "야구 핸디캡",
            winTxt:
              "승",
            loseTxt:
              "패",
          };
        }

        if (handiCode === 9) {
          return {
            ...row,
            betNm:
              "야구 언더오버",
            winTxt:
              "언더",
            loseTxt:
              "오버",
          };
        }

        return null;
      })
      .filter(Boolean);

  const groups =
    new Map();

  for (
    const row of target
  ) {
    const key =
      gameKey(row);

    if (
      !groups.has(key)
    ) {
      groups.set(
        key,
        {
          id:
            `betman-${gmTs}-${row.gameDate}-${row.homeId}-${row.awayId}`,

          year:
            YEAR,

          round,

          gmTs,

          date:
            toKstDate(
              row.gameDate
            ),

          commenceTime:
            toIso(
              row.gameDate
            ),

          league:
            "KBO",

          stadium:
            row.meetStadiumFullName ||
            null,

          homeId:
            row.homeId ||
            null,

          awayId:
            row.awayId ||
            null,

          homeTeam:
            row.homeName,

          awayTeam:
            row.awayName,

          actualScore:
            null,

          moneyline:
            null,

          spread:
            null,

          total:
            null,

          canceled:
            false,
        }
      );
    }

    const game =
      groups.get(key);

    const rejected =
      String(
        row.gameReject ?? "0"
      ) !== "0";

    if (rejected) {
      game.canceled =
        true;
    }

    if (
      row.betNm ===
      "야구 승패"
    ) {
      game.actualScore =
        parseScore(
          row.mchScore
        );

      game.moneyline = {
        matchSeq:
          row.matchSeq,

        homeOdds:
          validOdd(
            row.winAllot
          )
            ? row.winAllot
            : null,

        awayOdds:
          validOdd(
            row.loseAllot
          )
            ? row.loseAllot
            : null,

        resultCode:
          row.gameResult ??
          null,

        score:
          row.mchScore ||
          null,

        protoStatus:
          row.protoStatus ||
          null,

        gameReject:
          row.gameReject ||
          null,
      };
    }

    if (
      row.betNm ===
      "야구 핸디캡"
    ) {
      game.spread = {
        matchSeq:
          row.matchSeq,

        homeLine:
          typeof row.winHandi ===
            "number"
            ? row.winHandi
            : null,

        awayLine:
          typeof row.loseHandi ===
            "number"
            ? row.loseHandi
            : null,

        homeOdds:
          validOdd(
            row.winAllot
          )
            ? row.winAllot
            : null,

        awayOdds:
          validOdd(
            row.loseAllot
          )
            ? row.loseAllot
            : null,

        resultCode:
          row.gameResult ??
          null,

        adjustedScore:
          row.mchScore ||
          null,
      };
    }

    if (
      row.betNm ===
      "야구 언더오버"
    ) {
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

      let underOdds =
        null;

      let overOdds =
        null;

      if (
        row.winTxt ===
        "언더"
      ) {
        underOdds =
          validOdd(
            row.winAllot
          )
            ? row.winAllot
            : null;
      }

      if (
        row.winTxt ===
        "오버"
      ) {
        overOdds =
          validOdd(
            row.winAllot
          )
            ? row.winAllot
            : null;
      }

      if (
        row.loseTxt ===
        "언더"
      ) {
        underOdds =
          validOdd(
            row.loseAllot
          )
            ? row.loseAllot
            : null;
      }

      if (
        row.loseTxt ===
        "오버"
      ) {
        overOdds =
          validOdd(
            row.loseAllot
          )
            ? row.loseAllot
            : null;
      }

      game.total = {
        matchSeq:
          row.matchSeq,

        line,

        underOdds,
        overOdds,

        resultCode:
          row.gameResult ??
          null,

        resultScore:
          row.mchScore ||
          null,
      };
    }
  }

  return [
    ...groups.values(),
  ].filter(
    (game) =>
      game.moneyline ||
      game.spread ||
      game.total
  );
}

function loadExisting() {
  if (
    !fs.existsSync(
      OUTPUT
    )
  ) {
    return {
      year:
        YEAR,

      updatedAt:
        null,

      rounds:
        {},

      games:
        [],
    };
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        OUTPUT,
        "utf8"
      )
    );
  } catch {
    throw new Error(
      "기존 history JSON 파싱 실패"
    );
  }
}

function save(output) {
  fs.mkdirSync(
    path.dirname(
      OUTPUT
    ),
    {
      recursive: true,
    }
  );

  output.updatedAt =
    new Date()
      .toISOString();

  output.games =
    Object.values(
      output.rounds
    )
      .flatMap(
        (round) =>
          round.games || []
      )
      .sort(
        (a, b) =>
          String(
            a.commenceTime
          ).localeCompare(
            String(
              b.commenceTime
            )
          )
      );

  const tmp =
    OUTPUT + ".tmp";

  fs.writeFileSync(
    tmp,
    JSON.stringify(
      output,
      null,
      2
    ),
    "utf8"
  );

  fs.renameSync(
    tmp,
    OUTPUT
  );
}

(async () => {
  console.log(
    "===== BETMAN KBO 2026 BACKFILL ====="
  );

  const output =
    loadExisting();

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

  let success = 0;
  let empty = 0;
  let failed = 0;

  try {
    for (
      let round =
        START_ROUND;
      round >=
        END_ROUND;
      round--
    ) {
      /*
        이미 정상 수집된 회차면
        다시 요청하지 않는다.
      */
      if (
        output.rounds[
          round
        ]?.status ===
        "ok"
      ) {
        console.log(
          `SKIP ${round}회 - 이미 수집됨`
        );

        continue;
      }

      const gmTs =
        gmTsFromRound(
          round
        );

      const url =
        BASE +
        "/main/mainPage/gamebuy/closedGameSlip.do" +
        `?gmId=G101&gmTs=${gmTs}`;

      console.log();
      console.log(
        `===== ${round}회 / gmTs=${gmTs} =====`
      );

      try {
        const responsePromise =
          page.waitForResponse(
            (response) =>
              response
                .url()
                .includes(
                  "gameInfoInq"
                ) &&
              response.status() ===
                200,
            {
              timeout:
                15000,
            }
          );

        await page.goto(
          url,
          {
            waitUntil:
              "domcontentloaded",
            timeout:
              30000,
          }
        );

        const response =
          await responsePromise;

        const text =
          clean(
            await response.text()
          );

        const data =
          JSON.parse(text);

        if (
          !data?.compSchedules
        ) {
          console.log(
            "발매정보 없음"
          );

          output.rounds[
            round
          ] = {
            round,
            gmTs,
            status:
              "empty",
            collectedAt:
              new Date()
                .toISOString(),
            games:
              [],
          };

          empty++;

          save(output);

          await sleep(
            DELAY_MS
          );

          continue;
        }

        const games =
          normalizeRound(
            data,
            round,
            gmTs
          );

        output.rounds[
          round
        ] = {
          round,
          gmTs,

          status:
            "ok",

          collectedAt:
            new Date()
              .toISOString(),

          lottery: {
            gmId:
              data
                .currentLottery
                ?.gmId ||
              "G101",

            gmTs:
              data
                .currentLottery
                ?.gmTs ||
              gmTs,

            round:
              data
                .currentLottery
                ?.gmOsidTs ||
              round,

            year:
              data
                .currentLottery
                ?.gmOsidTsYear ||
              YEAR,
          },

          games,
        };

        success++;

        console.log(
          "KBO games:",
          games.length
        );

        if (
          games.length >
          0
        ) {
          const dates =
            [
              ...new Set(
                games.map(
                  (game) =>
                    game.date
                )
              ),
            ];

          console.log(
            "dates:",
            dates.join(
              ", "
            )
          );
        }

        save(output);
      } catch (error) {
        failed++;

        console.log(
          "❌",
          error.message
        );

        output.rounds[
          round
        ] = {
          round,
          gmTs,

          status:
            "error",

          error:
            error.message,

          collectedAt:
            new Date()
              .toISOString(),

          games:
            [],
        };

        save(output);
      }

      await sleep(
        DELAY_MS
      );
    }
  } finally {
    await context.close()
      .catch(() => {});

    await browser.close()
      .catch(() => {});
  }

  const games =
    output.games || [];

  const dateSet =
    new Set(
      games.map(
        (game) =>
          game.date
      )
    );

  const monthCounts =
    {};

  for (
    const game of games
  ) {
    const month =
      String(
        game.date
      ).slice(
        0,
        7
      );

    monthCounts[
      month
    ] =
      (
        monthCounts[
          month
        ] || 0
      ) + 1;
  }

  console.log();
  console.log(
    "===== BACKFILL COMPLETE ====="
  );

  console.log(
    "성공 회차:",
    success
  );

  console.log(
    "빈 회차:",
    empty
  );

  console.log(
    "실패 회차:",
    failed
  );

  console.log(
    "KBO 경기:",
    games.length
  );

  console.log(
    "KBO 경기일:",
    dateSet.size
  );

  console.log();
  console.log(
    "===== 월별 경기수 ====="
  );

  console.table(
    Object.entries(
      monthCounts
    )
      .sort()
      .map(
        ([month, count]) => ({
          month,
          games:
            count,
        })
      )
  );

  console.log();
  console.log(
    "FILE:",
    OUTPUT
  );
})().catch(
  (error) => {
    console.error(error);
    process.exit(1);
  }
);

const fs = require("fs");

const INPUT =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw =
  JSON.parse(
    fs.readFileSync(INPUT, "utf8")
  );

const rows =
  (raw.results || raw)
    .filter(x =>
      ["WIN","LOSS","VOID"].includes(x.result) &&
      Number.isFinite(Number(x.odds)) &&
      Number(x.odds) > 1 &&
      Number.isFinite(Number(x.ev)) &&
      Number.isFinite(Number(x.confidence))
    )
    .map(x => ({
      ...x,
      odds:Number(x.odds),
      ev:Number(x.ev),
      confidence:Number(x.confidence),
    }));

const DISC_START = "2026-03-28";
const DISC_END   = "2026-04-30";

const INTERNAL_START = "2026-05-01";
const INTERNAL_END   = "2026-06-30";

const STAKE = 10000;

function pct(v) {
  if (!Number.isFinite(v)) return null;

  return Math.abs(v) <= 1
    ? v * 100
    : v;
}

function evOf(x) {
  return pct(x.ev);
}

function confOf(x) {
  return pct(x.confidence);
}

function labelOf(x) {
  return String(
    x.label ?? x.side ?? ""
  ).toUpperCase();
}

function isOver(x) {
  const s = labelOf(x);

  return (
    x.market === "TOTAL" &&
    (
      s.includes("OVER") ||
      s.includes("오버")
    )
  );
}

function isUnder(x) {
  const s = labelOf(x);

  return (
    x.market === "TOTAL" &&
    (
      s.includes("UNDER") ||
      s.includes("언더")
    )
  );
}

function evBetween(x,min,max) {
  const ev =
    evOf(x);

  return (
    ev !== null &&
    ev >= min &&
    ev < max
  );
}

function confAtLeast(x,min) {
  const c =
    confOf(x);

  return (
    c !== null &&
    c >= min
  );
}

function oddsBetween(x,min,max) {
  return (
    x.odds >= min &&
    x.odds < max
  );
}

/*
  =====================================================
  사전 정의 SIGNAL FAMILY
  =====================================================

  결과 보고 조건을 만들지 않기 위해
  구간을 미리 고정한다.
*/
const SIGNALS = {

  OVER_EV3_5:
    x =>
      isOver(x) &&
      evBetween(x,3,5),

  OVER_EV5_10:
    x =>
      isOver(x) &&
      evBetween(x,5,10),

  OVER_EV3_10:
    x =>
      isOver(x) &&
      evBetween(x,3,10),

  UNDER_EV3_5:
    x =>
      isUnder(x) &&
      evBetween(x,3,5),

  UNDER_EV5_10:
    x =>
      isUnder(x) &&
      evBetween(x,5,10),

  ML_EV3_5:
    x =>
      x.market === "ML" &&
      evBetween(x,3,5),

  ML_EV5_10:
    x =>
      x.market === "ML" &&
      evBetween(x,5,10),

  ML_EV3_10:
    x =>
      x.market === "ML" &&
      evBetween(x,3,10),

  HANDI_EV3_5:
    x =>
      x.market === "HANDICAP" &&
      evBetween(x,3,5),

  HANDI_EV5_10:
    x =>
      x.market === "HANDICAP" &&
      evBetween(x,5,10),

  HANDI_EV3_10:
    x =>
      x.market === "HANDICAP" &&
      evBetween(x,3,10),

  ML_CONF55_EV0_3:
    x =>
      x.market === "ML" &&
      confAtLeast(x,55) &&
      evBetween(x,0,3),

  ML_CONF55_EV3_10:
    x =>
      x.market === "ML" &&
      confAtLeast(x,55) &&
      evBetween(x,3,10),

  ML_CONF60_EV0_3:
    x =>
      x.market === "ML" &&
      confAtLeast(x,60) &&
      evBetween(x,0,3),

  ML_CONF60_EV3_10:
    x =>
      x.market === "ML" &&
      confAtLeast(x,60) &&
      evBetween(x,3,10),

  EV3_5_ODDS120_180:
    x =>
      evBetween(x,3,5) &&
      oddsBetween(x,1.20,1.80),

  EV3_5_ODDS180_250:
    x =>
      evBetween(x,3,5) &&
      oddsBetween(x,1.80,2.50),

  EV3_5_ODDS250_PLUS:
    x =>
      evBetween(x,3,5) &&
      x.odds >= 2.50,

  EV5_10_ODDS120_180:
    x =>
      evBetween(x,5,10) &&
      oddsBetween(x,1.20,1.80),

  EV5_10_ODDS180_250:
    x =>
      evBetween(x,5,10) &&
      oddsBetween(x,1.80,2.50),

  EV5_10_ODDS250_PLUS:
    x =>
      evBetween(x,5,10) &&
      x.odds >= 2.50,

  OVER_EV3_10_ODDS160_200:
    x =>
      isOver(x) &&
      evBetween(x,3,10) &&
      oddsBetween(x,1.60,2.00),

  ML_EV3_10_ODDS150_200:
    x =>
      x.market === "ML" &&
      evBetween(x,3,10) &&
      oddsBetween(x,1.50,2.00),

  HANDI_EV3_10_ODDS250_PLUS:
    x =>
      x.market === "HANDICAP" &&
      evBetween(x,3,10) &&
      x.odds >= 2.50,
};

function stat(list) {
  let wins = 0;
  let losses = 0;
  let voids = 0;

  let returned = 0;
  let oddsSum = 0;

  let losingStreak = 0;
  let maxLosingStreak = 0;

  const monthly =
    new Map();

  for (const x of list) {
    let ret = 0;

    if (x.result === "WIN") {
      wins++;

      ret =
        STAKE *
        x.odds;

      losingStreak = 0;
    }

    else if (
      x.result === "VOID"
    ) {
      voids++;
      ret = STAKE;
      losingStreak = 0;
    }

    else {
      losses++;
      losingStreak++;

      maxLosingStreak =
        Math.max(
          maxLosingStreak,
          losingStreak
        );
    }

    returned += ret;
    oddsSum += x.odds;

    const month =
      x.date.slice(0,7);

    if (!monthly.has(month)) {
      monthly.set(
        month,
        {
          month,
          bets:0,
          wins:0,
          losses:0,
          voids:0,
          returned:0
        }
      );
    }

    const m =
      monthly.get(month);

    m.bets++;
    m.returned += ret;

    if (
      x.result === "WIN"
    ) m.wins++;

    if (
      x.result === "LOSS"
    ) m.losses++;

    if (
      x.result === "VOID"
    ) m.voids++;
  }

  const invested =
    list.length *
    STAKE;

  const profit =
    returned -
    invested;

  const settled =
    wins +
    losses;

  const monthRows =
    [...monthly.values()]
      .map(m => {
        const inv =
          m.bets *
          STAKE;

        const p =
          m.returned -
          inv;

        return {
          ...m,

          profit:
            Math.round(p),

          roi:
            inv
              ? +(
                  p /
                  inv *
                  100
                ).toFixed(2)
              : 0
        };
      });

  return {
    bets:
      list.length,

    wins,
    losses,
    voids,

    hit:
      settled
        ? +(
            wins /
            settled *
            100
          ).toFixed(2)
        : 0,

    avgOdds:
      list.length
        ? +(
            oddsSum /
            list.length
          ).toFixed(3)
        : 0,

    profit:
      Math.round(profit),

    roi:
      invested
        ? +(
            profit /
            invested *
            100
          ).toFixed(2)
        : 0,

    maxLosingStreak,

    negativeMonths:
      monthRows.filter(
        x => x.profit < 0
      ).length,

    monthly:
      monthRows
  };
}

const discoveryRows =
  rows.filter(
    x =>
      x.date >= DISC_START &&
      x.date <= DISC_END
  );

const internalRows =
  rows.filter(
    x =>
      x.date >= INTERNAL_START &&
      x.date <= INTERNAL_END
  );

const results =
  Object.entries(SIGNALS)
    .map(
      ([name,filter]) => {
        const disc =
          discoveryRows.filter(
            filter
          );

        const internal =
          internalRows.filter(
            filter
          );

        return {
          name,

          discovery:
            stat(disc),

          internal:
            stat(internal)
        };
      }
    );

/*
  최소 샘플 없는 신호는
  랭킹 상단에서 제외.
*/
const ranked =
  [...results]
    .sort(
      (a,b) => {
        const aScore =
          Math.min(
            a.discovery.roi,
            a.internal.roi
          );

        const bScore =
          Math.min(
            b.discovery.roi,
            b.internal.roi
          );

        return bScore - aScore;
      }
    );

console.log(
  "============================================================"
);

console.log(
  "KBO SIGNAL FAMILY AUDIT V2.2"
);

console.log(
  "DISCOVERY:",
  DISC_START,
  "~",
  DISC_END
);

console.log(
  "INTERNAL:",
  INTERNAL_START,
  "~",
  INTERNAL_END
);

console.log(
  "FINAL 07~09: LOCKED"
);

console.log(
  "============================================================"
);

console.log();
console.log(
  "===== ALL SIGNALS ====="
);

console.table(
  ranked.map(
    (x,rank) => ({
      rank:
        rank + 1,

      signal:
        x.name,

      DBets:
        x.discovery.bets,

      DHit:
        x.discovery.hit,

      DOdds:
        x.discovery.avgOdds,

      DROI:
        x.discovery.roi,

      IBets:
        x.internal.bets,

      IHit:
        x.internal.hit,

      IOdds:
        x.internal.avgOdds,

      IROI:
        x.internal.roi,

      minROI:
        +Math.min(
          x.discovery.roi,
          x.internal.roi
        ).toFixed(2),

      DLose:
        x.discovery.maxLosingStreak,

      ILose:
        x.internal.maxLosingStreak
    }))
);

/*
  이제부터는 매우 단순하게:

  두 구간 각각 최소 5픽
  두 구간 ROI 모두 > 0
*/
const robust =
  ranked
    .filter(
      x =>
        x.discovery.bets >= 5 &&
        x.internal.bets >= 5 &&
        x.discovery.roi > 0 &&
        x.internal.roi > 0
    );

console.log();
console.log(
  "===== ROBUST SIGNALS ====="
);

console.table(
  robust.map(
    (x,rank) => ({
      rank:
        rank + 1,

      signal:
        x.name,

      DBets:
        x.discovery.bets,

      DROI:
        x.discovery.roi,

      IBets:
        x.internal.bets,

      IROI:
        x.internal.roi,

      total:
        x.discovery.bets +
        x.internal.bets,

      minROI:
        +Math.min(
          x.discovery.roi,
          x.internal.roi
        ).toFixed(2)
    }))
);

console.log();
console.log(
  "ROBUST COUNT:",
  robust.length
);

if (robust.length) {
  for (
    const x
    of robust
  ) {
    console.log();
    console.log(
      "=============================="
    );

    console.log(
      x.name
    );

    console.log(
      "DISCOVERY MONTHLY"
    );

    console.table(
      x.discovery.monthly
    );

    console.log(
      "INTERNAL MONTHLY"
    );

    console.table(
      x.internal.monthly
    );
  }
}

fs.writeFileSync(
  "data/kbo-signal-families-v22.json",
  JSON.stringify(
    {
      generatedAt:
        new Date()
          .toISOString(),

      final:
        "LOCKED",

      results,

      robust:
        robust.map(
          x => x.name
        )
    },
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-signal-families-v22.json"
);

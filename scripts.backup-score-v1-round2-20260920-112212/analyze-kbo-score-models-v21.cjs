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
  return Math.abs(v) <= 1 ? v * 100 : v;
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

function gradeValue(x) {
  const g =
    String(x.grade || "")
      .toUpperCase();

  if (g === "A") return 3;
  if (g === "B") return 2;
  return 1;
}

/*
  후보군은 V2.0 그대로 고정.
  이번에는 후보 조건을 바꾸지 않고
  순위 점수만 비교한다.
*/
function eligible(x) {
  const ev =
    evOf(x);

  const conf =
    confOf(x);

  if (
    ev === null ||
    conf === null
  ) {
    return false;
  }

  if (
    isOver(x) &&
    ev >= 3 &&
    ev < 10
  ) {
    return true;
  }

  if (
    x.market === "HANDICAP" &&
    ev >= 3 &&
    ev < 10
  ) {
    return true;
  }

  if (
    x.market === "ML" &&
    ev >= 3 &&
    ev < 10
  ) {
    return true;
  }

  if (
    x.market === "ML" &&
    conf >= 55 &&
    ev >= 0 &&
    ev < 10
  ) {
    return true;
  }

  return false;
}

/*
  ======================================================
  V2.1 점수 모델

  결과값은 점수 계산에 절대 넣지 않는다.
  모델 수를 작게 고정해서 과탐색 방지.
  ======================================================
*/
const MODELS = {

  /*
    V2.0 기준
  */
  CURRENT(x) {
    const ev =
      evOf(x) ?? -30;

    const conf =
      confOf(x) ?? 0;

    let s =
      conf * 1.00 +
      ev * 0.75 +
      gradeValue(x) * 2;

    if (
      isOver(x) &&
      ev >= 3 &&
      ev < 10
    ) s += 4;

    if (
      x.market === "HANDICAP" &&
      ev >= 3 &&
      ev < 10
    ) s += 2;

    if (
      x.market === "ML" &&
      conf >= 55
    ) s += 2;

    if (x.odds > 2.20) {
      s -=
        (x.odds - 2.20) * 4;
    }

    return s;
  },

  /*
    EV 비중 강화
  */
  EV_HEAVY(x) {
    const ev =
      evOf(x) ?? -30;

    const conf =
      confOf(x) ?? 0;

    let s =
      conf * 0.55 +
      ev * 2.00 +
      gradeValue(x) * 1.5;

    if (isOver(x)) {
      s += 3;
    }

    if (
      x.market === "HANDICAP"
    ) {
      s += 2;
    }

    if (x.odds > 3.00) {
      s -=
        (x.odds - 3.00) * 2;
    }

    return s;
  },

  /*
    confidence/EV 균형
  */
  BALANCED(x) {
    const ev =
      evOf(x) ?? -30;

    const conf =
      confOf(x) ?? 0;

    let s =
      conf * 0.70 +
      ev * 1.35 +
      gradeValue(x) * 1.5;

    if (
      isOver(x)
    ) {
      s += 3;
    }

    if (
      x.market === "HANDICAP"
    ) {
      s += 2;
    }

    return s;
  },

  /*
    낮은 EV 정배 ML 감점
  */
  VALUE_FILTERED(x) {
    const ev =
      evOf(x) ?? -30;

    const conf =
      confOf(x) ?? 0;

    let s =
      conf * 0.65 +
      ev * 1.60 +
      gradeValue(x) * 1.5;

    if (
      isOver(x)
    ) {
      s += 3;
    }

    if (
      x.market === "HANDICAP"
    ) {
      s += 3;
    }

    if (
      x.market === "ML" &&
      ev < 3
    ) {
      s -= 10;
    }

    if (
      x.market === "ML" &&
      ev >= 5
    ) {
      s += 3;
    }

    return s;
  },

  /*
    순수 value 위주.
    grade 영향 최소.
  */
  PURE_VALUE(x) {
    const ev =
      evOf(x) ?? -30;

    const conf =
      confOf(x) ?? 0;

    let s =
      ev * 2.20 +
      conf * 0.40 +
      gradeValue(x) * 0.5;

    if (
      isOver(x)
    ) {
      s += 2;
    }

    if (
      x.market === "HANDICAP"
    ) {
      s += 2;
    }

    if (
      x.odds >= 3.20
    ) {
      s -= 3;
    }

    return s;
  },
};

function groupByDate(source) {
  const map =
    new Map();

  for (const x of source) {
    if (!map.has(x.date)) {
      map.set(x.date,[]);
    }

    map.get(x.date).push(x);
  }

  return [...map.entries()]
    .sort(
      (a,b) =>
        a[0].localeCompare(b[0])
    );
}

function selectTop1(
  source,
  model
) {
  const out = [];

  for (
    const [date,dayRows]
    of groupByDate(source)
  ) {
    const pool =
      dayRows
        .filter(eligible)
        .sort(
          (a,b) =>
            MODELS[model](b) -
            MODELS[model](a)
        );

    if (!pool.length) {
      continue;
    }

    out.push({
      ...pool[0],
      date,
      modelScore:
        MODELS[model](
          pool[0]
        )
    });
  }

  return out;
}

function stat(list) {
  let wins = 0;
  let losses = 0;
  let voids = 0;

  let returned = 0;
  let oddsSum = 0;

  let losingStreak = 0;
  let maxLosingStreak = 0;

  const markets = {};
  const monthly = {};

  for (const x of list) {
    oddsSum += x.odds;

    let ret = 0;

    if (
      x.result === "WIN"
    ) {
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

    let market =
      x.market;

    if (
      isOver(x)
    ) {
      market = "OVER";
    }

    markets[market] =
      (markets[market] || 0) +
      1;

    const month =
      x.date.slice(0,7);

    if (!monthly[month]) {
      monthly[month] = {
        bets:0,
        wins:0,
        losses:0,
        returned:0
      };
    }

    monthly[month].bets++;
    monthly[month].returned +=
      ret;

    if (
      x.result === "WIN"
    ) monthly[month].wins++;

    if (
      x.result === "LOSS"
    ) monthly[month].losses++;
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

  const monthlyRows =
    Object.entries(monthly)
      .map(
        ([month,m]) => {
          const inv =
            m.bets *
            STAKE;

          const p =
            m.returned -
            inv;

          return {
            month,
            bets:m.bets,
            wins:m.wins,
            losses:m.losses,

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
        }
      );

  return {
    bets:list.length,
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
      monthlyRows
        .filter(
          x =>
            x.profit < 0
        ).length,

    markets,

    monthly:
      monthlyRows
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

const results = [];

for (
  const model
  of Object.keys(MODELS)
) {
  const discPicks =
    selectTop1(
      discoveryRows,
      model
    );

  const intPicks =
    selectTop1(
      internalRows,
      model
    );

  results.push({
    model,

    discovery:
      stat(discPicks),

    internal:
      stat(intPicks),

    discPicks,
    intPicks
  });
}

console.log(
  "============================================================"
);

console.log(
  "KBO SCORE MODEL TEST V2.1"
);

console.log(
  "FINAL 07~09: LOCKED"
);

console.log(
  "CANDIDATE FILTER: SAME AS V2.0"
);

console.log(
  "============================================================"
);

console.log();
console.log(
  "===== SCORE MODEL COMPARISON ====="
);

console.table(
  results.map(
    x => ({
      model:
        x.model,

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

      DNegM:
        x.discovery.negativeMonths,

      INegM:
        x.internal.negativeMonths,

      DLose:
        x.discovery.maxLosingStreak,

      ILose:
        x.internal.maxLosingStreak
    }))
);

console.log();
console.log(
  "===== MARKET MIX ====="
);

console.table(
  results.map(
    x => ({
      model:x.model,

      DMarkets:
        JSON.stringify(
          x.discovery.markets
        ),

      IMarkets:
        JSON.stringify(
          x.internal.markets
        )
    }))
);

/*
  통과 조건:
  후보 조건은 동일하므로
  TOP1이 양쪽에서 실제로 플러스인지 확인.

  최소 10건 / 기간.
*/
const passed =
  results
    .filter(
      x =>
        x.discovery.bets >= 10 &&
        x.internal.bets >= 10 &&
        x.discovery.roi > 0 &&
        x.internal.roi > 0
    )
    .sort(
      (a,b) =>
        Math.min(
          b.discovery.roi,
          b.internal.roi
        ) -
        Math.min(
          a.discovery.roi,
          a.internal.roi
        )
    );

console.log();
console.log(
  "===== PASSED MODELS ====="
);

console.table(
  passed.map(
    (x,rank) => ({
      rank:
        rank + 1,

      model:
        x.model,

      DBets:
        x.discovery.bets,

      DROI:
        x.discovery.roi,

      IBets:
        x.internal.bets,

      IROI:
        x.internal.roi,

      minROI:
        Math.min(
          x.discovery.roi,
          x.internal.roi
        )
    }))
);

if (passed[0]) {
  const best =
    passed[0];

  console.log();
  console.log(
    "===== BEST MODEL INTERNAL PICKS ====="
  );

  console.table(
    best.intPicks.map(
      x => ({
        date:x.date,
        market:
          isOver(x)
            ? "OVER"
            : x.market,
        pick:x.label,
        odds:x.odds,
        ev:
          +(evOf(x) ?? 0)
            .toFixed(2),
        conf:
          +(confOf(x) ?? 0)
            .toFixed(2),
        grade:x.grade,
        score:
          +x.modelScore
            .toFixed(2),
        result:x.result
      })
    )
  );
}

fs.writeFileSync(
  "data/kbo-score-models-v21.json",
  JSON.stringify(
    {
      generatedAt:
        new Date()
          .toISOString(),

      final:
        "LOCKED",

      results:
        results.map(
          x => ({
            model:x.model,

            discovery:
              x.discovery,

            internal:
              x.internal
          })
        ),

      passed:
        passed.map(
          x => x.model
        )
    },
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-score-models-v21.json"
);

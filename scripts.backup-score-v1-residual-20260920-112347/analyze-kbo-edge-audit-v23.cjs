const fs = require("fs");

const FILE =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw =
  JSON.parse(
    fs.readFileSync(FILE, "utf8")
  );

const rows =
  (raw.results || raw)
    .filter(x =>
      ["WIN","LOSS","VOID"].includes(x.result) &&
      Number.isFinite(Number(x.odds)) &&
      Number(x.odds) > 1
    )
    .map(x => ({
      ...x,
      odds:Number(x.odds)
    }));

const DISC_START = "2026-03-28";
const DISC_END   = "2026-04-30";

const INT_START = "2026-05-01";
const INT_END   = "2026-06-30";

const STAKE = 10000;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function label(x) {
  return String(
    x.label ?? ""
  ).toUpperCase();
}

function isOver(x) {
  return (
    x.market === "TOTAL" &&
    (
      label(x).includes("OVER") ||
      label(x).includes("오버")
    )
  );
}

function isUnder(x) {
  return (
    x.market === "TOTAL" &&
    (
      label(x).includes("UNDER") ||
      label(x).includes("언더")
    )
  );
}

function sideType(x) {
  if (isOver(x)) return "OVER";
  if (isUnder(x)) return "UNDER";
  return x.market;
}

const EDGE_FIELDS = [
  "starterEdge",
  "formEdge",
  "bullpenEdge",
  "lineupEdge",
  "totalEdge"
];

/*
  실제 값 분포를 먼저 확인.
*/
console.log(
  "============================================================"
);

console.log(
  "KBO RAW EDGE AUDIT V2.3"
);

console.log(
  "DISCOVERY:",
  DISC_START,
  "~",
  DISC_END
);

console.log(
  "INTERNAL:",
  INT_START,
  "~",
  INT_END
);

console.log(
  "FINAL 07~09: LOCKED"
);

console.log(
  "============================================================"
);

console.log();
console.log(
  "===== EDGE VALUE DISTRIBUTION ====="
);

for (const field of EDGE_FIELDS) {
  const vals =
    rows
      .map(x => num(x[field]))
      .filter(v => v !== null)
      .sort((a,b) => a-b);

  if (!vals.length) {
    console.log(
      field,
      "NO DATA"
    );
    continue;
  }

  function q(p) {
    const idx =
      Math.min(
        vals.length - 1,
        Math.floor(
          (vals.length - 1) * p
        )
      );

    return vals[idx];
  }

  console.log(
    field,
    {
      n:vals.length,
      min:vals[0],
      p10:q(.10),
      p25:q(.25),
      p50:q(.50),
      p75:q(.75),
      p90:q(.90),
      max:vals[vals.length-1]
    }
  );
}

function stat(list) {
  let wins = 0;
  let losses = 0;
  let voids = 0;

  let returned = 0;
  let oddsSum = 0;

  for (const x of list) {
    oddsSum += x.odds;

    if (x.result === "WIN") {
      wins++;
      returned +=
        STAKE * x.odds;
    }
    else if (x.result === "VOID") {
      voids++;
      returned += STAKE;
    }
    else {
      losses++;
    }
  }

  const invested =
    list.length * STAKE;

  const profit =
    returned - invested;

  const settled =
    wins + losses;

  return {
    bets:list.length,
    wins,
    losses,
    voids,

    hit:
      settled
        ? +(wins / settled * 100)
            .toFixed(2)
        : 0,

    odds:
      list.length
        ? +(oddsSum / list.length)
            .toFixed(3)
        : 0,

    profit:
      Math.round(profit),

    roi:
      invested
        ? +(profit / invested * 100)
            .toFixed(2)
        : 0
  };
}

const discovery =
  rows.filter(
    x =>
      x.date >= DISC_START &&
      x.date <= DISC_END
  );

const internal =
  rows.filter(
    x =>
      x.date >= INT_START &&
      x.date <= INT_END
  );

/*
  edge 절대값 구간.
  값 스케일을 몰라도
  0.02 / .05 / .10 / .15 / .20 기준으로 먼저 확인.
*/
const THRESHOLDS = [
  0.02,
  0.05,
  0.10,
  0.15,
  0.20
];

const MARKET_TYPES = [
  "OVER",
  "UNDER",
  "ML",
  "HANDICAP"
];

const results = [];

for (const field of EDGE_FIELDS) {
  for (const market of MARKET_TYPES) {
    for (const threshold of THRESHOLDS) {

      /*
        양수 edge
      */
      const discPos =
        discovery.filter(
          x =>
            sideType(x) === market &&
            num(x[field]) !== null &&
            num(x[field]) >= threshold
        );

      const intPos =
        internal.filter(
          x =>
            sideType(x) === market &&
            num(x[field]) !== null &&
            num(x[field]) >= threshold
        );

      results.push({
        name:
          `${market} / ${field} >= ${threshold}`,

        field,
        market,
        direction:"POS",
        threshold,

        discovery:
          stat(discPos),

        internal:
          stat(intPos)
      });

      /*
        음수 edge도 반대 선택과 관계가 있을 수 있으므로 검사.
      */
      const discNeg =
        discovery.filter(
          x =>
            sideType(x) === market &&
            num(x[field]) !== null &&
            num(x[field]) <= -threshold
        );

      const intNeg =
        internal.filter(
          x =>
            sideType(x) === market &&
            num(x[field]) !== null &&
            num(x[field]) <= -threshold
        );

      results.push({
        name:
          `${market} / ${field} <= -${threshold}`,

        field,
        market,
        direction:"NEG",
        threshold,

        discovery:
          stat(discNeg),

        internal:
          stat(intNeg)
      });
    }
  }
}

/*
  최소 표본 5개씩 있는 것만 우선 랭킹.
*/
const ranked =
  results
    .filter(
      x =>
        x.discovery.bets >= 5 &&
        x.internal.bets >= 5
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
  "===== EDGE SIGNAL RANKING ====="
);

console.table(
  ranked
    .slice(0,40)
    .map(
      (x,rank) => ({
        rank:rank+1,

        signal:x.name,

        DBets:
          x.discovery.bets,

        DHit:
          x.discovery.hit,

        DOdds:
          x.discovery.odds,

        DROI:
          x.discovery.roi,

        IBets:
          x.internal.bets,

        IHit:
          x.internal.hit,

        IOdds:
          x.internal.odds,

        IROI:
          x.internal.roi,

        minROI:
          +Math.min(
            x.discovery.roi,
            x.internal.roi
          ).toFixed(2)
      })
    )
);

/*
  양쪽 기간 플러스.
*/
const robust =
  ranked.filter(
    x =>
      x.discovery.roi > 0 &&
      x.internal.roi > 0
  );

console.log();
console.log(
  "===== ROBUST EDGE SIGNALS ====="
);

console.table(
  robust.map(
    (x,rank) => ({
      rank:rank+1,

      signal:x.name,

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
    })
  )
);

console.log();
console.log(
  "ROBUST EDGE COUNT:",
  robust.length
);

/*
  두 edge 동시조건도 탐색.
  단 너무 많은 조합은 피하고
  threshold 0.05 / 0.10만 사용.
*/
const comboThresholds = [
  0.05,
  0.10
];

const comboResults = [];

for (
  let i=0;
  i<EDGE_FIELDS.length;
  i++
) {
  for (
    let j=i+1;
    j<EDGE_FIELDS.length;
    j++
  ) {
    const f1 =
      EDGE_FIELDS[i];

    const f2 =
      EDGE_FIELDS[j];

    for (const market of MARKET_TYPES) {
      for (const t of comboThresholds) {

        const filter =
          x =>
            sideType(x) === market &&
            num(x[f1]) !== null &&
            num(x[f2]) !== null &&
            num(x[f1]) >= t &&
            num(x[f2]) >= t;

        const d =
          stat(
            discovery.filter(filter)
          );

        const v =
          stat(
            internal.filter(filter)
          );

        comboResults.push({
          name:
            `${market} / ${f1}+${f2} >= ${t}`,

          discovery:d,
          internal:v
        });
      }
    }
  }
}

const comboRanked =
  comboResults
    .filter(
      x =>
        x.discovery.bets >= 4 &&
        x.internal.bets >= 4
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
  "===== TWO-EDGE COMBINATION RANKING ====="
);

console.table(
  comboRanked
    .slice(0,30)
    .map(
      (x,rank) => ({
        rank:rank+1,

        signal:x.name,

        DBets:
          x.discovery.bets,

        DHit:
          x.discovery.hit,

        DROI:
          x.discovery.roi,

        IBets:
          x.internal.bets,

        IHit:
          x.internal.hit,

        IROI:
          x.internal.roi,

        minROI:
          +Math.min(
            x.discovery.roi,
            x.internal.roi
          ).toFixed(2)
      })
    )
);

const comboRobust =
  comboRanked.filter(
    x =>
      x.discovery.roi > 0 &&
      x.internal.roi > 0
  );

console.log();
console.log(
  "===== ROBUST TWO-EDGE SIGNALS ====="
);

console.table(
  comboRobust.map(
    (x,rank) => ({
      rank:rank+1,

      signal:x.name,

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
    })
  )
);

console.log();
console.log(
  "ROBUST TWO-EDGE COUNT:",
  comboRobust.length
);

fs.writeFileSync(
  "data/kbo-edge-audit-v23.json",
  JSON.stringify(
    {
      generatedAt:
        new Date().toISOString(),

      periods:{
        discovery:[
          DISC_START,
          DISC_END
        ],

        internal:[
          INT_START,
          INT_END
        ],

        final:"LOCKED"
      },

      edgeFields:
        EDGE_FIELDS,

      robust:
        robust,

      comboRobust:
        comboRobust
    },
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-edge-audit-v23.json"
);

const fs = require("fs");

const FILE =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));

function findArray(v) {
  if (Array.isArray(v)) return v;

  if (v && typeof v === "object") {
    for (const key of [
      "candidates",
      "records",
      "results",
      "picks",
      "items",
      "data",
    ]) {
      if (Array.isArray(v[key])) return v[key];
    }

    for (const value of Object.values(v)) {
      if (
        Array.isArray(value) &&
        value.length &&
        typeof value[0] === "object"
      ) {
        return value;
      }
    }
  }

  return [];
}

const rows = findArray(raw);

if (!rows.length) {
  console.error("❌ 후보 배열을 찾지 못했습니다.");
  console.log(
    "ROOT KEYS:",
    raw && typeof raw === "object"
      ? Object.keys(raw)
      : []
  );
  process.exit(1);
}

console.log("===== DATA =====");
console.log("ROWS:", rows.length);
console.log(
  "SAMPLE KEYS:",
  Object.keys(rows[0]).sort().join(", ")
);
console.log();

function first(row, keys) {
  for (const k of keys) {
    if (
      row[k] !== undefined &&
      row[k] !== null &&
      row[k] !== ""
    ) {
      return row[k];
    }
  }
  return null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dateOf(r) {
  return String(
    first(r, [
      "date",
      "gameDate",
      "targetDate",
      "matchDate",
    ]) ?? ""
  ).slice(0, 10);
}

function marketOf(r) {
  return String(
    first(r, ["market", "marketType"]) ?? ""
  ).toUpperCase();
}

function sideOf(r) {
  return String(
    first(r, [
      "side",
      "selection",
      "pick",
      "target",
      "direction",
    ]) ?? ""
  ).toUpperCase();
}

function oddsOf(r) {
  return num(
    first(r, [
      "odds",
      "decimalOdds",
      "pickOdds",
    ])
  );
}

function confOf(r) {
  let v = num(
    first(r, [
      "confidence",
      "probability",
      "modelProbability",
    ])
  );

  if (v === null) return null;
  if (v <= 1) v *= 100;
  return v;
}

function evOf(r) {
  let v = num(
    first(r, [
      "ev",
      "expectedValue",
      "expectedValuePct",
    ])
  );

  if (v === null) return null;

  // analyzer EV is normally decimal form.
  if (Math.abs(v) <= 1) v *= 100;

  return v;
}

function resultOf(r) {
  return String(
    first(r, [
      "result",
      "settlement",
      "outcome",
      "pickResult",
    ]) ?? ""
  ).toUpperCase();
}

function profitOf(r) {
  let p = num(
    first(r, [
      "profit",
      "netProfit",
      "pnl",
    ])
  );

  if (p !== null) return p;

  const result = resultOf(r);
  const odds = oddsOf(r);

  if (result === "WIN" && odds)
    return 10000 * (odds - 1);

  if (result === "LOSS")
    return -10000;

  if (
    result === "VOID" ||
    result === "PUSH"
  )
    return 0;

  return null;
}

function edge(r, aliases) {
  return num(first(r, aliases));
}

function starterEdge(r) {
  return edge(r, [
    "starterEdge",
    "starterScoreEdge",
  ]);
}

function formEdge(r) {
  return edge(r, [
    "teamFormEdge",
    "teamFormEdgeScore",
    "formEdge",
  ]);
}

function bullpenEdge(r) {
  return edge(r, [
    "bullpenEdge",
    "bullpenEdgeScore",
  ]);
}

function lineupEdge(r) {
  return edge(r, [
    "lineupEdge",
    "lineupMatchupEdgeScore",
  ]);
}

function totalEdge(r) {
  let v = num(
    first(r, [
      "totalEdge",
      "projectedTotalEdge",
    ])
  );

  if (v !== null) return Math.abs(v);

  const projected = num(r.projectedTotal);
  const line = num(
    first(r, ["totalLine", "line"])
  );

  if (
    projected !== null &&
    line !== null
  ) {
    return Math.abs(projected - line);
  }

  return null;
}

const settled = rows.filter((r) =>
  ["WIN", "LOSS", "VOID", "PUSH"].includes(
    resultOf(r)
  )
);

const train = settled.filter((r) => {
  const d = dateOf(r);
  return d >= "2026-03-28" &&
         d <= "2026-06-30";
});

const valid = settled.filter((r) => {
  const d = dateOf(r);
  return d >= "2026-07-01" &&
         d <= "2026-09-30";
});

function summary(arr) {
  const usable = arr.filter(
    (r) => profitOf(r) !== null
  );

  const wins =
    usable.filter(
      (r) => resultOf(r) === "WIN"
    ).length;

  const losses =
    usable.filter(
      (r) => resultOf(r) === "LOSS"
    ).length;

  const profit =
    usable.reduce(
      (s, r) => s + profitOf(r),
      0
    );

  const stake =
    (wins + losses) * 10000;

  return {
    bets: wins + losses,
    wins,
    losses,
    hitRate:
      wins + losses
        ? +(wins / (wins + losses) * 100)
            .toFixed(2)
        : 0,
    avgOdds:
      +(
        usable
          .map(oddsOf)
          .filter((x) => x !== null)
          .reduce((a, b) => a + b, 0) /
        Math.max(
          1,
          usable
            .map(oddsOf)
            .filter((x) => x !== null)
            .length
        )
      ).toFixed(3),
    avgConf:
      +(
        usable
          .map(confOf)
          .filter((x) => x !== null)
          .reduce((a, b) => a + b, 0) /
        Math.max(
          1,
          usable
            .map(confOf)
            .filter((x) => x !== null)
            .length
        )
      ).toFixed(2),
    avgEv:
      +(
        usable
          .map(evOf)
          .filter((x) => x !== null)
          .reduce((a, b) => a + b, 0) /
        Math.max(
          1,
          usable
            .map(evOf)
            .filter((x) => x !== null)
            .length
        )
      ).toFixed(2),
    profit: Math.round(profit),
    roi:
      stake
        ? +(profit / stake * 100)
            .toFixed(2)
        : 0,
  };
}

const CONDITIONS = [
  {
    name: "CONF 55-60",
    fn: r => {
      const c = confOf(r);
      return c !== null &&
             c >= 55 &&
             c < 60;
    },
  },
  {
    name: "CONF 60-65",
    fn: r => {
      const c = confOf(r);
      return c !== null &&
             c >= 60 &&
             c < 65;
    },
  },
  {
    name: "CONF 65-70",
    fn: r => {
      const c = confOf(r);
      return c !== null &&
             c >= 65 &&
             c < 70;
    },
  },

  {
    name: "EV 0-3",
    fn: r => {
      const e = evOf(r);
      return e !== null &&
             e >= 0 &&
             e < 3;
    },
  },
  {
    name: "EV 3-5",
    fn: r => {
      const e = evOf(r);
      return e !== null &&
             e >= 3 &&
             e < 5;
    },
  },
  {
    name: "EV 5-10",
    fn: r => {
      const e = evOf(r);
      return e !== null &&
             e >= 5 &&
             e < 10;
    },
  },

  {
    name: "ODDS 1.40-1.59",
    fn: r => {
      const o = oddsOf(r);
      return o !== null &&
             o >= 1.4 &&
             o < 1.6;
    },
  },
  {
    name: "ODDS 1.60-1.79",
    fn: r => {
      const o = oddsOf(r);
      return o !== null &&
             o >= 1.6 &&
             o < 1.8;
    },
  },
  {
    name: "ODDS 1.80-1.99",
    fn: r => {
      const o = oddsOf(r);
      return o !== null &&
             o >= 1.8 &&
             o < 2;
    },
  },
  {
    name: "ODDS 2.00-2.49",
    fn: r => {
      const o = oddsOf(r);
      return o !== null &&
             o >= 2 &&
             o < 2.5;
    },
  },
  {
    name: "ODDS 2.50+",
    fn: r => {
      const o = oddsOf(r);
      return o !== null && o >= 2.5;
    },
  },

  {
    name: "ML",
    fn: r => marketOf(r) === "ML",
  },
  {
    name: "HANDICAP",
    fn: r => marketOf(r) === "HANDICAP",
  },
  {
    name: "TOTAL",
    fn: r => marketOf(r) === "TOTAL",
  },

  {
    name: "STARTER +",
    fn: r => {
      const x = starterEdge(r);
      return x !== null && x > 0;
    },
  },
  {
    name: "STARTER STRONG +5",
    fn: r => {
      const x = starterEdge(r);
      return x !== null && x >= 5;
    },
  },

  {
    name: "FORM +",
    fn: r => {
      const x = formEdge(r);
      return x !== null && x > 0;
    },
  },
  {
    name: "BULLPEN +",
    fn: r => {
      const x = bullpenEdge(r);
      return x !== null && x > 0;
    },
  },
  {
    name: "LINEUP +",
    fn: r => {
      const x = lineupEdge(r);
      return x !== null && x > 0;
    },
  },

  {
    name: "TOTAL EDGE 0.8+",
    fn: r => {
      const x = totalEdge(r);
      return x !== null && x >= 0.8;
    },
  },
  {
    name: "TOTAL EDGE 1.2+",
    fn: r => {
      const x = totalEdge(r);
      return x !== null && x >= 1.2;
    },
  },
  {
    name: "TOTAL EDGE 1.6+",
    fn: r => {
      const x = totalEdge(r);
      return x !== null && x >= 1.6;
    },
  },
];

function testRule(name, fns) {
  const tf = r => fns.every(fn => fn(r));

  const tr = summary(train.filter(tf));
  const va = summary(valid.filter(tf));

  return {
    rule: name,

    trainBets: tr.bets,
    trainHit: tr.hitRate,
    trainROI: tr.roi,

    validBets: va.bets,
    validHit: va.hitRate,
    validROI: va.roi,

    trainProfit: tr.profit,
    validProfit: va.profit,
  };
}

const rules = [];

// 1개 조건
for (const a of CONDITIONS) {
  rules.push(
    testRule(a.name, [a.fn])
  );
}

// 2개 조건
for (let i = 0; i < CONDITIONS.length; i++) {
  for (
    let j = i + 1;
    j < CONDITIONS.length;
    j++
  ) {
    rules.push(
      testRule(
        `${CONDITIONS[i].name} + ${CONDITIONS[j].name}`,
        [
          CONDITIONS[i].fn,
          CONDITIONS[j].fn,
        ]
      )
    );
  }
}

// 지나친 소표본 방지
const useful = rules.filter(
  r =>
    r.trainBets >= 20 &&
    r.validBets >= 10
);

// validation을 규칙 선택에는 쓰지 않고,
// 화면 정렬만 validation ROI와 샘플 수로 표시.
// 실제 후보는 train 양수 여부를 우선 확인.
const trainPositive = useful
  .filter(r => r.trainROI > 0)
  .sort((a, b) =>
    b.trainROI - a.trainROI
  );

console.log(
  "===== TRAIN 양수 패턴 / VALIDATION 확인 ====="
);

console.table(
  trainPositive.slice(0, 80)
);

console.log();

const robust = useful
  .filter(
    r =>
      r.trainROI > 0 &&
      r.validROI > 0
  )
  .sort((a, b) => {
    const aMin = Math.min(
      a.trainROI,
      a.validROI
    );
    const bMin = Math.min(
      b.trainROI,
      b.validROI
    );

    return bMin - aMin;
  });

console.log(
  "===== TRAIN + VALIDATION 모두 양수 ====="
);

console.table(
  robust.slice(0, 60)
);

console.log();

console.log(
  "===== BASELINE ====="
);

console.log("TRAIN", summary(train));
console.log("VALID", summary(valid));

console.log();
console.log(
  "ROBUST RULE COUNT:",
  robust.length
);

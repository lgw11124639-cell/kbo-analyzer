const fs = require("fs");

const FILE =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const j = JSON.parse(
  fs.readFileSync(FILE, "utf8")
);

const rows = j.results.filter(
  x =>
    x.result === "WIN" ||
    x.result === "LOSS"
);

function num(v) {
  return typeof v === "number" &&
    Number.isFinite(v)
    ? v
    : null;
}

function stat(list) {
  const settled = list.filter(
    x =>
      x.result === "WIN" ||
      x.result === "LOSS"
  );

  const wins = settled.filter(
    x => x.result === "WIN"
  ).length;

  const stake =
    settled.length * 10000;

  const returned =
    settled.reduce(
      (sum, x) =>
        sum +
        (
          x.result === "WIN"
            ? 10000 * x.odds
            : 0
        ),
      0
    );

  const profit =
    returned - stake;

  return {
    bets: settled.length,
    wins,
    losses:
      settled.length - wins,

    hitRate:
      settled.length
        ? Number(
            (
              wins /
              settled.length *
              100
            ).toFixed(2)
          )
        : 0,

    avgOdds:
      settled.length
        ? Number(
            (
              settled.reduce(
                (s,x) =>
                  s + x.odds,
                0
              ) /
              settled.length
            ).toFixed(3)
          )
        : 0,

    avgConfidence:
      settled.length
        ? Number(
            (
              settled.reduce(
                (s,x) =>
                  s +
                  (num(x.confidence) ?? 0),
                0
              ) /
              settled.length *
              100
            ).toFixed(2)
          )
        : 0,

    avgEv:
      settled.length
        ? Number(
            (
              settled.reduce(
                (s,x) =>
                  s +
                  (num(x.ev) ?? 0),
                0
              ) /
              settled.length *
              100
            ).toFixed(2)
          )
        : 0,

    profit:
      Math.round(profit),

    roi:
      stake
        ? Number(
            (
              profit /
              stake *
              100
            ).toFixed(2)
          )
        : 0,
  };
}

function printGroup(
  title,
  groups
) {
  console.log();
  console.log(
    `===== ${title} =====`
  );

  console.table(
    groups.map(
      ([name, filter]) => ({
        group: name,
        ...stat(
          rows.filter(filter)
        ),
      })
    )
  );
}

function labelText(x) {
  return String(
    x.label ?? ""
  ).toUpperCase();
}

/*
  현재 추천 필터 통과
*/
printGroup(
  "CURRENT FILTER",
  [
    [
      "PASS",
      x =>
        x.passesCurrentFilter ===
        true,
    ],
    [
      "FAIL",
      x =>
        x.passesCurrentFilter !==
        true,
    ],
  ]
);

/*
  시장
*/
printGroup(
  "MARKET",
  [
    [
      "ML",
      x => x.market === "ML",
    ],
    [
      "HANDICAP",
      x =>
        x.market ===
        "HANDICAP",
    ],
    [
      "TOTAL",
      x =>
        x.market === "TOTAL",
    ],
  ]
);

/*
  ML 홈/원정
*/
printGroup(
  "ML SIDE",
  [
    [
      "HOME",
      x =>
        x.market === "ML" &&
        (
          labelText(x).includes("홈") ||
          labelText(x).includes("HOME") ||
          labelText(x).includes(
            String(
              x.homeTeam
            ).toUpperCase()
          )
        ),
    ],
    [
      "AWAY",
      x =>
        x.market === "ML" &&
        (
          labelText(x).includes("원정") ||
          labelText(x).includes("AWAY") ||
          labelText(x).includes(
            String(
              x.awayTeam
            ).toUpperCase()
          )
        ),
    ],
  ]
);

/*
  TOTAL 방향
*/
printGroup(
  "TOTAL SIDE",
  [
    [
      "OVER",
      x =>
        x.market === "TOTAL" &&
        (
          labelText(x).includes(
            "OVER"
          ) ||
          labelText(x).includes(
            "오버"
          )
        ),
    ],
    [
      "UNDER",
      x =>
        x.market === "TOTAL" &&
        (
          labelText(x).includes(
            "UNDER"
          ) ||
          labelText(x).includes(
            "언더"
          )
        ),
    ],
  ]
);

/*
  예측 확률 구간
*/
printGroup(
  "CONFIDENCE",
  [
    [
      "50-54.9%",
      x =>
        num(x.confidence) >= .50 &&
        num(x.confidence) < .55,
    ],
    [
      "55-59.9%",
      x =>
        num(x.confidence) >= .55 &&
        num(x.confidence) < .60,
    ],
    [
      "60-64.9%",
      x =>
        num(x.confidence) >= .60 &&
        num(x.confidence) < .65,
    ],
    [
      "65-69.9%",
      x =>
        num(x.confidence) >= .65 &&
        num(x.confidence) < .70,
    ],
    [
      "70%+",
      x =>
        num(x.confidence) >= .70,
    ],
  ]
);

/*
  EV 구간
*/
printGroup(
  "EV",
  [
    [
      "< 0%",
      x =>
        num(x.ev) !== null &&
        x.ev < 0,
    ],
    [
      "0-2.9%",
      x =>
        num(x.ev) >= 0 &&
        num(x.ev) < .03,
    ],
    [
      "3-4.9%",
      x =>
        num(x.ev) >= .03 &&
        num(x.ev) < .05,
    ],
    [
      "5-9.9%",
      x =>
        num(x.ev) >= .05 &&
        num(x.ev) < .10,
    ],
    [
      "10%+",
      x =>
        num(x.ev) >= .10,
    ],
  ]
);

/*
  배당 구간
*/
printGroup(
  "ODDS",
  [
    [
      "1.00-1.39",
      x =>
        x.odds >= 1 &&
        x.odds < 1.40,
    ],
    [
      "1.40-1.59",
      x =>
        x.odds >= 1.40 &&
        x.odds < 1.60,
    ],
    [
      "1.60-1.79",
      x =>
        x.odds >= 1.60 &&
        x.odds < 1.80,
    ],
    [
      "1.80-1.99",
      x =>
        x.odds >= 1.80 &&
        x.odds < 2.00,
    ],
    [
      "2.00-2.49",
      x =>
        x.odds >= 2 &&
        x.odds < 2.50,
    ],
    [
      "2.50+",
      x =>
        x.odds >= 2.50,
    ],
  ]
);

/*
  TOTAL EDGE
*/
printGroup(
  "TOTAL EDGE",
  [
    [
      "0-0.79",
      x =>
        x.market === "TOTAL" &&
        num(x.totalEdge) !== null &&
        x.totalEdge < .8,
    ],
    [
      "0.8-1.19",
      x =>
        x.market === "TOTAL" &&
        num(x.totalEdge) >= .8 &&
        x.totalEdge < 1.2,
    ],
    [
      "1.2-1.59",
      x =>
        x.market === "TOTAL" &&
        num(x.totalEdge) >= 1.2 &&
        x.totalEdge < 1.6,
    ],
    [
      "1.6-1.99",
      x =>
        x.market === "TOTAL" &&
        num(x.totalEdge) >= 1.6 &&
        x.totalEdge < 2,
    ],
    [
      "2.0+",
      x =>
        x.market === "TOTAL" &&
        num(x.totalEdge) >= 2,
    ],
  ]
);

/*
  월별 현재 추천필터
*/
const pass =
  rows.filter(
    x =>
      x.passesCurrentFilter ===
      true
  );

const months =
  [...new Set(
    pass.map(
      x => x.month
    )
  )].sort();

console.log();
console.log(
  "===== CURRENT FILTER MONTHLY ====="
);

console.table(
  months.map(
    month => ({
      month,
      ...stat(
        pass.filter(
          x => x.month === month
        )
      ),
    })
  )
);

console.log();
console.log(
  "TOTAL SETTLED:",
  rows.length
);

const fs = require("fs");

const FILE =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw =
  JSON.parse(
    fs.readFileSync(
      FILE,
      "utf8"
    )
  );

const source =
  Array.isArray(raw)
    ? raw
    : raw.results ||
      raw.recommendations ||
      [];

function num(v) {
  const n = Number(v);

  return Number.isFinite(n)
    ? n
    : null;
}

function conf(v) {
  let n = num(v);

  if (n === null) {
    return null;
  }

  if (n > 1) {
    n /= 100;
  }

  return n;
}

function result(v) {
  const s =
    String(v ?? "")
      .trim()
      .toUpperCase();

  if (s === "WIN") {
    return "WIN";
  }

  if (
    s === "LOSS" ||
    s === "LOSE"
  ) {
    return "LOSS";
  }

  return null;
}

function dateOf(r) {
  return String(
    r.date ??
    r.gameDate ??
    ""
  ).slice(0, 10);
}

/*
  경기 + 시장별 confidence 우세 방향 1개
*/
const map =
  new Map();

for (const r of source) {
  const market =
    String(
      r.market ?? ""
    ).toUpperCase();

  if (
    ![
      "ML",
      "HANDICAP",
      "TOTAL",
    ].includes(market)
  ) {
    continue;
  }

  const c =
    conf(
      r.confidence
    );

  const res =
    result(
      r.result
    );

  const odds =
    num(
      r.odds
    );

  if (
    c === null ||
    res === null ||
    odds === null ||
    odds <= 1
  ) {
    continue;
  }

  const gameId =
    String(
      r.gameId ??
      `${dateOf(r)}:${r.awayTeam}:${r.homeTeam}`
    );

  const key =
    `${gameId}::${market}`;

  const current =
    map.get(key);

  if (
    !current ||
    c >
      conf(
        current.confidence
      )
  ) {
    map.set(
      key,
      r
    );
  }
}

const rows =
  [...map.values()]
    .map(r => ({
      ...r,

      date:
        dateOf(r),

      market:
        String(
          r.market
        ).toUpperCase(),

      confidence:
        conf(
          r.confidence
        ),

      odds:
        num(
          r.odds
        ),

      result:
        result(
          r.result
        ),

      projectedTotal:
        num(
          r.projectedTotal
        ),

      totalLine:
        num(
          r.totalLine
        ),
    }))
    .filter(
      r =>
        r.confidence !== null &&
        r.odds !== null &&
        r.result !== null
    );

function summary(list) {
  let wins = 0;
  let losses = 0;
  let profit = 0;

  for (const r of list) {
    if (
      r.result === "WIN"
    ) {
      wins++;
      profit +=
        r.odds - 1;
    } else {
      losses++;
      profit -= 1;
    }
  }

  const count =
    wins + losses;

  return {
    count,
    wins,
    losses,

    hit:
      count
        ? wins / count
        : 0,

    roi:
      count
        ? profit / count
        : 0,
  };
}

function pct(v) {
  return (
    v * 100
  ).toFixed(2) + "%";
}

function phase(r) {
  return (
    r.date <=
    "2026-07-31"
  )
    ? "TRAIN"
    : "VALID";
}

const rules = [
  {
    name: "57%+ (A+B)",
    min: 0.57,
  },
  {
    name: "58%+",
    min: 0.58,
  },
  {
    name: "59%+",
    min: 0.59,
  },
  {
    name: "60%+",
    min: 0.60,
  },
  {
    name: "61%+",
    min: 0.61,
  },
  {
    name: "62%+ (A)",
    min: 0.62,
  },
  {
    name: "63%+",
    min: 0.63,
  },
  {
    name: "64%+",
    min: 0.64,
  },
  {
    name: "65%+",
    min: 0.65,
  },
  {
    name: "67%+",
    min: 0.67,
  },
  {
    name: "70%+",
    min: 0.70,
  },
];

const markets = [
  "ML",
  "HANDICAP",
  "TOTAL",
];

console.log(
  "=========================================="
);

console.log(
  "CONFIDENCE RULE AUDIT V1"
);

console.log(
  "EV 조건 완전 제외"
);

console.log(
  "TOTAL은 두 버전 모두 확인"
);

console.log(
  "TRAIN <= 2026-07-31"
);

console.log(
  "VALID >= 2026-08-01"
);

console.log(
  "=========================================="
);

for (
  const market
  of markets
) {
  console.log(
    `\n\n######## ${market} ########`
  );

  console.log(
    "RULE | ALL N HIT ROI | TRAIN N HIT ROI | VALID N HIT ROI"
  );

  for (
    const rule
    of rules
  ) {
    const list =
      rows.filter(
        r =>
          r.market ===
            market &&
          r.confidence >=
            rule.min
      );

    const train =
      list.filter(
        r =>
          phase(r) ===
          "TRAIN"
      );

    const valid =
      list.filter(
        r =>
          phase(r) ===
          "VALID"
      );

    const a =
      summary(list);

    const t =
      summary(train);

    const v =
      summary(valid);

    console.log(
      [
        rule.name.padEnd(12),

        `ALL ${String(
          a.count
        ).padStart(3)} ${pct(
          a.hit
        ).padStart(7)} ${pct(
          a.roi
        ).padStart(8)}`,

        `TRAIN ${String(
          t.count
        ).padStart(3)} ${pct(
          t.hit
        ).padStart(7)} ${pct(
          t.roi
        ).padStart(8)}`,

        `VALID ${String(
          v.count
        ).padStart(3)} ${pct(
          v.hit
        ).padStart(7)} ${pct(
          v.roi
        ).padStart(8)}`,
      ].join(
        " | "
      )
    );
  }
}

/*
  TOTAL만 기존 0.8 edge 추가 적용
*/
console.log(
  "\n\n######## TOTAL + EDGE >= 0.8 ########"
);

for (
  const rule
  of rules
) {
  const list =
    rows.filter(
      r => {
        if (
          r.market !==
            "TOTAL" ||
          r.confidence <
            rule.min
        ) {
          return false;
        }

        if (
          r.projectedTotal ===
            null ||
          r.totalLine ===
            null
        ) {
          return true;
        }

        return (
          Math.abs(
            r.projectedTotal -
            r.totalLine
          ) >= 0.8
        );
      }
    );

  const train =
    list.filter(
      r =>
        phase(r) ===
        "TRAIN"
    );

  const valid =
    list.filter(
      r =>
        phase(r) ===
        "VALID"
    );

  const a =
    summary(list);

  const t =
    summary(train);

  const v =
    summary(valid);

  console.log(
    [
      rule.name.padEnd(12),

      `ALL ${String(
        a.count
      ).padStart(3)} ${pct(
        a.hit
      ).padStart(7)} ${pct(
        a.roi
      ).padStart(8)}`,

      `TRAIN ${String(
        t.count
      ).padStart(3)} ${pct(
        t.hit
      ).padStart(7)} ${pct(
        t.roi
      ).padStart(8)}`,

      `VALID ${String(
        v.count
      ).padStart(3)} ${pct(
        v.hit
      ).padStart(7)} ${pct(
        v.roi
      ).padStart(8)}`,
    ].join(
      " | "
    )
  );
}

console.log(
  "\n===== DONE ====="
);

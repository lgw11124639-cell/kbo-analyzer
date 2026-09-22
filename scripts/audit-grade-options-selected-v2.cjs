const fs = require("fs");

const FILE =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw =
  JSON.parse(
    fs.readFileSync(FILE, "utf8")
  );

const rows =
  Array.isArray(raw.results)
    ? raw.results
    : [];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n)
    ? n
    : null;
}

function confidence(v) {
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

  if (
    s === "WIN" ||
    s === "W" ||
    s === "적중"
  ) {
    return "WIN";
  }

  if (
    s === "LOSS" ||
    s === "LOSE" ||
    s === "L" ||
    s === "미적중"
  ) {
    return "LOSS";
  }

  if (
    s === "VOID" ||
    s === "PUSH" ||
    s === "DRAW"
  ) {
    return "VOID";
  }

  return null;
}

function gradeWeight(g) {
  if (g === "A") return 300;
  if (g === "B") return 200;
  return 100;
}

function tieScore(r) {
  return (
    gradeWeight(
      String(r.grade ?? "C")
    ) +
    (r.confidence ?? 0) * 100 +
    (r.ev ?? -1) * 100
  );
}

const normalized =
  rows
    .map((r, index) => ({
      ...r,

      __index:
        index,

      confidence:
        confidence(
          r.confidence
        ),

      ev:
        num(r.ev),

      market:
        String(
          r.market ?? ""
        ).toUpperCase(),

      result:
        result(
          r.result
        ),
    }))
    .filter(
      (r) =>
        r.gameId &&
        [
          "ML",
          "HANDICAP",
          "TOTAL",
        ].includes(
          r.market
        ) &&
        r.confidence !== null
    );

/*
  실제 운영 규칙:
  gameId + market마다
  confidence 최고 방향 하나.

  confidence 완전 동률이면
  기존 pickScore 방식으로 결정.

  그래도 동률이면
  원본 순서 유지.
*/
const selectedMap =
  new Map();

for (const r of normalized) {
  const key =
    `${r.gameId}::${r.market}`;

  const previous =
    selectedMap.get(key);

  if (!previous) {
    selectedMap.set(
      key,
      r
    );
    continue;
  }

  if (
    r.confidence >
    previous.confidence
  ) {
    selectedMap.set(
      key,
      r
    );
    continue;
  }

  if (
    r.confidence ===
      previous.confidence &&
    tieScore(r) >
      tieScore(previous)
  ) {
    selectedMap.set(
      key,
      r
    );
  }
}

const selected =
  [...selectedMap.values()]
    .filter(
      (r) =>
        r.result === "WIN" ||
        r.result === "LOSS"
    );

/*
  후보 1
*/
function option1(r) {
  const ev =
    r.ev ?? -999;

  if (
    r.confidence >= 0.62 &&
    ev >= 0.03
  ) {
    return "A";
  }

  if (
    r.confidence >= 0.55 &&
    ev >= 0
  ) {
    return "B";
  }

  return "C";
}

/*
  후보 2
  시장별 기준
*/
function option2(r) {
  const ev =
    r.ev ?? -999;

  if (r.market === "ML") {
    if (
      r.confidence >= 0.60 &&
      ev >= 0.04
    ) {
      return "A";
    }

    if (
      r.confidence >= 0.54 &&
      ev >= 0.01
    ) {
      return "B";
    }

    return "C";
  }

  if (
    r.market === "HANDICAP"
  ) {
    if (
      r.confidence >= 0.58 &&
      ev >= 0.03
    ) {
      return "A";
    }

    if (
      r.confidence >= 0.53 &&
      ev >= 0
    ) {
      return "B";
    }

    return "C";
  }

  if (
    r.market === "TOTAL"
  ) {
    if (
      r.confidence >= 0.58 &&
      ev >= 0.03
    ) {
      return "A";
    }

    if (
      r.confidence >= 0.53 &&
      ev >= 0
    ) {
      return "B";
    }

    return "C";
  }

  return "C";
}

/*
  후보 3
  종합점수형
*/
function option3(r) {
  const ev =
    r.ev ?? -0.20;

  let score =
    (
      r.confidence -
      0.50
    ) * 500 +
    ev * 250;

  if (
    r.market ===
    "HANDICAP"
  ) {
    score += 2;
  }

  if (
    r.market ===
    "TOTAL"
  ) {
    score -= 1;
  }

  if (
    score >= 55 &&
    ev >= 0.02 &&
    r.confidence >= 0.56
  ) {
    return "A";
  }

  if (
    score >= 25 &&
    ev >= 0 &&
    r.confidence >= 0.52
  ) {
    return "B";
  }

  return "C";
}

function pct(a, b) {
  return b
    ? (
        (
          a /
          b *
          100
        ).toFixed(2) +
        "%"
      )
    : "0.00%";
}

function avg(xs, key) {
  const values =
    xs
      .map(
        (x) =>
          num(x[key])
      )
      .filter(
        (x) =>
          x !== null
      );

  if (!values.length) {
    return null;
  }

  return (
    values.reduce(
      (a, b) =>
        a + b,
      0
    ) /
    values.length
  );
}

function summarize(
  title,
  grader
) {
  console.log();
  console.log(
    "========================================"
  );
  console.log(title);
  console.log(
    "========================================"
  );

  const graded =
    selected.map(
      (r) => ({
        ...r,
        testGrade:
          grader(r),
      })
    );

  for (
    const g of [
      "A",
      "B",
      "C",
    ]
  ) {
    const xs =
      graded.filter(
        (r) =>
          r.testGrade === g
      );

    const wins =
      xs.filter(
        (r) =>
          r.result === "WIN"
      ).length;

    const losses =
      xs.filter(
        (r) =>
          r.result === "LOSS"
      ).length;

    const ac =
      avg(
        xs,
        "confidence"
      );

    const ae =
      avg(
        xs,
        "ev"
      );

    console.log();
    console.log(
      `${g}급`
    );

    console.log(
      "  PICKS =",
      xs.length
    );

    console.log(
      "  W/L =",
      `${wins}/${losses}`
    );

    console.log(
      "  HIT =",
      pct(
        wins,
        wins + losses
      )
    );

    console.log(
      "  AVG CONF =",
      ac === null
        ? "N/A"
        : (
            ac *
            100
          ).toFixed(2) +
          "%"
    );

    console.log(
      "  AVG EV =",
      ae === null
        ? "N/A"
        : (
            ae *
            100
          ).toFixed(2) +
          "%"
    );

    for (
      const market of [
        "ML",
        "HANDICAP",
        "TOTAL",
      ]
    ) {
      const ms =
        xs.filter(
          (r) =>
            r.market ===
            market
        );

      const mw =
        ms.filter(
          (r) =>
            r.result ===
            "WIN"
        ).length;

      console.log(
        `    ${market.padEnd(8)}`,
        `N=${String(ms.length).padStart(4)}`,
        `HIT=${pct(mw, ms.length)}`
      );
    }
  }

  const ab =
    graded.filter(
      (r) =>
        r.testGrade === "A" ||
        r.testGrade === "B"
    );

  const abWins =
    ab.filter(
      (r) =>
        r.result ===
        "WIN"
    ).length;

  console.log();
  console.log(
    "A+B PICKS =",
    ab.length
  );

  console.log(
    "A+B HIT =",
    pct(
      abWins,
      ab.length
    )
  );
}

console.log(
  "===== SELECTED MARKET GRADE AUDIT V2 ====="
);

console.log(
  "RAW =",
  rows.length
);

console.log(
  "NORMALIZED =",
  normalized.length
);

console.log(
  "SELECTED W/L =",
  selected.length
);

for (
  const market of [
    "ML",
    "HANDICAP",
    "TOTAL",
  ]
) {
  const xs =
    selected.filter(
      (r) =>
        r.market ===
        market
    );

  const wins =
    xs.filter(
      (r) =>
        r.result ===
        "WIN"
    ).length;

  console.log(
    market,
    "N=",
    xs.length,
    "HIT=",
    pct(
      wins,
      xs.length
    )
  );
}

summarize(
  "OPTION 1 — SIMPLE",
  option1
);

summarize(
  "OPTION 2 — MARKET BALANCED",
  option2
);

summarize(
  "OPTION 3 — SCORE",
  option3
);

summarize(
  "CURRENT STORED GRADE",
  (r) =>
    ["A", "B", "C"]
      .includes(
        String(r.grade)
      )
      ? String(r.grade)
      : "C"
);

console.log();
console.log(
  "===== COMPLETE ====="
);

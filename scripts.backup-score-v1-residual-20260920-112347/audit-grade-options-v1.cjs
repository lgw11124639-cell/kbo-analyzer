const fs = require("fs");

const FILE =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw =
  JSON.parse(
    fs.readFileSync(FILE, "utf8")
  );

const rows =
  Array.isArray(raw.recommendations)
    ? raw.recommendations
    : Array.isArray(raw.results)
      ? raw.results
      : [];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n)
    ? n
    : null;
}

function normalizeConfidence(v) {
  let n = num(v);

  if (n === null) {
    return null;
  }

  if (n > 1) {
    n /= 100;
  }

  return n;
}

function normalizeResult(v) {
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
    s === "PUSH" ||
    s === "VOID" ||
    s === "DRAW"
  ) {
    return "VOID";
  }

  return null;
}

const valid =
  rows
    .map((r) => ({
      ...r,

      confidence:
        normalizeConfidence(
          r.confidence
        ),

      ev:
        num(r.ev),

      market:
        String(
          r.market ?? ""
        ).toUpperCase(),

      result:
        normalizeResult(
          r.result
        ),
    }))
    .filter(
      (r) =>
        r.confidence !== null &&
        (
          r.result === "WIN" ||
          r.result === "LOSS"
        )
    );

/*
  OPTION 1
  단순형

  A:
  confidence >= 62%
  EV >= 3%

  B:
  confidence >= 55%
  EV >= 0%

  나머지 C
*/
function gradeSimple(r) {
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
  OPTION 2
  균형형 / 시장별 기준

  ML:
    A 60% + EV 4%
    B 54% + EV 1%

  HANDICAP:
    A 58% + EV 3%
    B 53% + EV 0%

  TOTAL:
    A 58% + EV 3%
    B 53% + EV 0%
*/
function gradeMarketBalanced(r) {
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
  OPTION 3
  점수형

  confidence와 EV를 따로 컷하지 않고
  종합 점수로 평가.

  confidence:
    50% = 0점 기준

  EV:
    0% = 0점 기준

  시장별 작은 보정만 적용.

  이 단계에서는 실제 적중률을
  grade 계산식에 넣지 않는다.
  -> 백테스트 결과를 등급 산식에
     역으로 넣는 과적합 방지.
*/
function gradeScore(r) {
  const ev =
    r.ev ?? -0.20;

  let score =
    (r.confidence - 0.50) *
      500 +
    ev * 250;

  /*
    시장별 모델 구조 차이만
    소폭 보정.
  */
  if (
    r.market === "HANDICAP"
  ) {
    score += 2;
  }

  if (
    r.market === "TOTAL"
  ) {
    score -= 1;
  }

  /*
    EV 음수 픽은
    A로 올라가지 못하게 제한.
  */
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
  if (!b) {
    return "0.00%";
  }

  return (
    (
      a /
      b *
      100
    ).toFixed(2) +
    "%"
  );
}

function avg(arr, key) {
  const nums =
    arr
      .map(
        (x) =>
          num(x[key])
      )
      .filter(
        (x) =>
          x !== null
      );

  if (!nums.length) {
    return null;
  }

  return (
    nums.reduce(
      (a, b) =>
        a + b,
      0
    ) /
    nums.length
  );
}

function summarize(
  name,
  grader
) {
  console.log();
  console.log(
    "========================================"
  );
  console.log(name);
  console.log(
    "========================================"
  );

  const graded =
    valid.map((r) => ({
      ...r,
      testGrade:
        grader(r),
    }));

  for (
    const grade of [
      "A",
      "B",
      "C",
    ]
  ) {
    const xs =
      graded.filter(
        (x) =>
          x.testGrade ===
          grade
      );

    const wins =
      xs.filter(
        (x) =>
          x.result ===
          "WIN"
      ).length;

    const losses =
      xs.filter(
        (x) =>
          x.result ===
          "LOSS"
      ).length;

    const avgConf =
      avg(
        xs,
        "confidence"
      );

    const avgEv =
      avg(
        xs,
        "ev"
      );

    console.log();
    console.log(
      `${grade}급`
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
      avgConf === null
        ? "N/A"
        : (
            avgConf *
            100
          ).toFixed(2) +
          "%"
    );

    console.log(
      "  AVG EV =",
      avgEv === null
        ? "N/A"
        : (
            avgEv *
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
          (x) =>
            x.market ===
            market
        );

      const mw =
        ms.filter(
          (x) =>
            x.result ===
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
      (x) =>
        x.testGrade === "A" ||
        x.testGrade === "B"
    );

  const abWins =
    ab.filter(
      (x) =>
        x.result ===
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
  "===== GRADE OPTION AUDIT V1 ====="
);

console.log(
  "SOURCE ROWS =",
  rows.length
);

console.log(
  "VALID W/L ROWS =",
  valid.length
);

console.log(
  "DATE RANGE =",
  valid
    .map((x) => x.date)
    .filter(Boolean)
    .sort()[0] ??
    "N/A",
  "~",
  valid
    .map((x) => x.date)
    .filter(Boolean)
    .sort()
    .slice(-1)[0] ??
    "N/A"
);

console.log();
console.log(
  "AVAILABLE KEYS ="
);

console.log(
  rows[0]
    ? Object.keys(rows[0])
        .sort()
        .join(", ")
    : "NO ROW"
);

summarize(
  "OPTION 1 — SIMPLE",
  gradeSimple
);

summarize(
  "OPTION 2 — MARKET BALANCED",
  gradeMarketBalanced
);

summarize(
  "OPTION 3 — SCORE",
  gradeScore
);

console.log();
console.log(
  "===== CURRENT STORED GRADE ====="
);

summarize(
  "CURRENT RAW GRADE",
  (r) =>
    ["A", "B", "C"].includes(
      String(r.grade)
    )
      ? String(r.grade)
      : "C"
);

console.log();
console.log(
  "===== COMPLETE ====="
);

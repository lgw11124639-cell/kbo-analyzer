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

  return null;
}

function gradeValue(g) {
  if (g === "A") return 300;
  if (g === "B") return 200;
  return 100;
}

function pickScore(r) {
  return (
    gradeValue(
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
      __index: index,
      confidence:
        conf(r.confidence),
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
        r.gameId &&
        r.confidence !== null &&
        [
          "ML",
          "HANDICAP",
          "TOTAL",
        ].includes(
          r.market
        )
    );

/*
  현재 운영 방식:
  경기 + 시장당 confidence 최고 방향 1개.
*/
const map =
  new Map();

for (const r of normalized) {
  const key =
    `${r.gameId}::${r.market}`;

  const prev =
    map.get(key);

  if (!prev) {
    map.set(key, r);
    continue;
  }

  if (
    r.confidence >
    prev.confidence
  ) {
    map.set(key, r);
    continue;
  }

  if (
    r.confidence ===
      prev.confidence &&
    pickScore(r) >
      pickScore(prev)
  ) {
    map.set(key, r);
  }
}

const selected =
  [...map.values()]
    .filter(
      (r) =>
        r.result === "WIN" ||
        r.result === "LOSS"
    );

function pct(w, n) {
  return n
    ? (
        w / n * 100
      ).toFixed(2) + "%"
    : "N/A";
}

function report(
  title,
  xs
) {
  const wins =
    xs.filter(
      (r) =>
        r.result === "WIN"
    ).length;

  const avgConf =
    xs.length
      ? xs.reduce(
          (s, r) =>
            s +
            r.confidence,
          0
        ) /
        xs.length
      : null;

  const evs =
    xs
      .map((r) => r.ev)
      .filter(
        (v) =>
          Number.isFinite(v)
      );

  const avgEv =
    evs.length
      ? evs.reduce(
          (a, b) =>
            a + b,
          0
        ) /
        evs.length
      : null;

  console.log(
    title.padEnd(20),
    "N=",
    String(xs.length).padStart(4),
    "HIT=",
    pct(
      wins,
      xs.length
    ),
    "CONF=",
    avgConf === null
      ? "N/A"
      : (
          avgConf * 100
        ).toFixed(2) + "%",
    "EV=",
    avgEv === null
      ? "N/A"
      : (
          avgEv * 100
        ).toFixed(2) + "%"
  );
}

console.log(
  "===== GRADE CALIBRATION V3 ====="
);

report(
  "ALL",
  selected
);

console.log();
console.log(
  "===== MARKET ====="
);

for (
  const market of [
    "ML",
    "HANDICAP",
    "TOTAL",
  ]
) {
  report(
    market,
    selected.filter(
      (r) =>
        r.market === market
    )
  );
}

/*
  confidence는 선택된 방향이라
  대부분 50% 이상.
*/
const CONF_BANDS = [
  [0.50, 0.52],
  [0.52, 0.54],
  [0.54, 0.56],
  [0.56, 0.58],
  [0.58, 0.60],
  [0.60, 0.62],
  [0.62, 0.64],
  [0.64, 0.66],
  [0.66, 0.68],
  [0.68, 0.71],
  [0.71, 1.01],
];

console.log();
console.log(
  "===== CONFIDENCE BANDS : ALL ====="
);

for (
  const [lo, hi]
  of CONF_BANDS
) {
  const xs =
    selected.filter(
      (r) =>
        r.confidence >= lo &&
        r.confidence < hi
    );

  report(
    `${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%`,
    xs
  );
}

for (
  const market of [
    "ML",
    "HANDICAP",
    "TOTAL",
  ]
) {
  console.log();
  console.log(
    `===== CONFIDENCE : ${market} =====`
  );

  for (
    const [lo, hi]
    of CONF_BANDS
  ) {
    const xs =
      selected.filter(
        (r) =>
          r.market === market &&
          r.confidence >= lo &&
          r.confidence < hi
      );

    if (!xs.length) {
      continue;
    }

    report(
      `${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%`,
      xs
    );
  }
}

const EV_BANDS = [
  [-1, -0.15],
  [-0.15, -0.10],
  [-0.10, -0.05],
  [-0.05, 0],
  [0, 0.03],
  [0.03, 0.06],
  [0.06, 0.10],
  [0.10, 1],
];

console.log();
console.log(
  "===== EV BANDS ====="
);

for (
  const [lo, hi]
  of EV_BANDS
) {
  const xs =
    selected.filter(
      (r) =>
        r.ev !== null &&
        r.ev >= lo &&
        r.ev < hi
    );

  report(
    `${(lo * 100).toFixed(0)}~${(hi * 100).toFixed(0)}%`,
    xs
  );
}

/*
  confidence-only 후보 컷.
  아직 적용 아님.
*/
const OPTIONS = [
  {
    name:
      "CUT A62 / B57",
    a: 0.62,
    b: 0.57,
  },
  {
    name:
      "CUT A64 / B58",
    a: 0.64,
    b: 0.58,
  },
  {
    name:
      "CUT A60 / B56",
    a: 0.60,
    b: 0.56,
  },
];

console.log();
console.log(
  "===== CONF-ONLY GRADE OPTIONS ====="
);

for (
  const option of OPTIONS
) {
  console.log();
  console.log(
    "---",
    option.name,
    "---"
  );

  const a =
    selected.filter(
      (r) =>
        r.confidence >=
        option.a
    );

  const b =
    selected.filter(
      (r) =>
        r.confidence <
          option.a &&
        r.confidence >=
          option.b
    );

  const c =
    selected.filter(
      (r) =>
        r.confidence <
        option.b
    );

  report(
    "A",
    a
  );

  report(
    "B",
    b
  );

  report(
    "C",
    c
  );
}

console.log();
console.log(
  "===== COMPLETE ====="
);

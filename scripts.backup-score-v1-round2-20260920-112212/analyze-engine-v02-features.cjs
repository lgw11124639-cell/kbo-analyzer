const fs = require("fs");

const FILE =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw = JSON.parse(
  fs.readFileSync(
    FILE,
    "utf8"
  )
);

const rows =
  Array.isArray(raw)
    ? raw
    : raw.results || [];

const valid =
  rows.filter(
    r =>
      r &&
      r.date <= "2026-09-13" &&
      ["ML", "HANDICAP", "TOTAL"]
        .includes(r.market) &&
      ["WIN", "LOSS"]
        .includes(r.result)
  );

console.log(
  "ROWS =",
  valid.length
);

const TRAIN_END =
  "2026-07-31";

function pct(
  wins,
  count
) {
  return count
    ? (
        wins /
        count *
        100
      ).toFixed(2) + "%"
    : "-";
}

function summarize(
  arr
) {
  const wins =
    arr.filter(
      r => r.result === "WIN"
    ).length;

  return {
    n: arr.length,
    wins,
    hit:
      pct(
        wins,
        arr.length
      ),
  };
}

function median(values) {
  const xs =
    values
      .filter(Number.isFinite)
      .sort(
        (a, b) =>
          a - b
      );

  if (!xs.length) {
    return null;
  }

  const m =
    Math.floor(
      xs.length / 2
    );

  return xs.length % 2
    ? xs[m]
    : (
        xs[m - 1] +
        xs[m]
      ) / 2;
}

function mean(values) {
  const xs =
    values.filter(
      Number.isFinite
    );

  return xs.length
    ? xs.reduce(
        (a, b) =>
          a + b,
        0
      ) / xs.length
    : null;
}

function std(values) {
  const xs =
    values.filter(
      Number.isFinite
    );

  if (
    xs.length < 2
  ) {
    return null;
  }

  const m =
    mean(xs);

  return Math.sqrt(
    xs.reduce(
      (sum, x) =>
        sum +
        Math.pow(
          x - m,
          2
        ),
      0
    ) /
      xs.length
  );
}

function number(
  value
) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

/*
  동일 경기 + 시장에서
  confidence가 높은 방향 하나 선택.
  현재 실제 통계 방식과 동일한 비교용.
*/
function selectCurrent(
  source
) {
  const map =
    new Map();

  for (
    const row of source
  ) {
    const key =
      `${row.gameId}::${row.market}`;

    const current =
      map.get(key);

    if (
      !current ||
      Number(row.confidence) >
        Number(
          current.confidence
        )
    ) {
      map.set(
        key,
        row
      );
    }
  }

  return [
    ...map.values()
  ];
}

const selected =
  selectCurrent(
    valid
  );

console.log(
  "\n===== CURRENT BASELINE ====="
);

for (
  const market of [
    "ML",
    "HANDICAP",
    "TOTAL",
  ]
) {
  const all =
    selected.filter(
      r =>
        r.market === market
    );

  const train =
    all.filter(
      r =>
        r.date <=
        TRAIN_END
    );

  const validRows =
    all.filter(
      r =>
        r.date >
        TRAIN_END
    );

  console.log(
    market,
    "ALL",
    summarize(all),
    "TRAIN",
    summarize(train),
    "VALID",
    summarize(validRows)
  );
}


/*
============================================================
FEATURE BUCKET AUDIT
절대값이 클수록 실제 적중률이 좋아지는지 확인.
============================================================
*/

const FEATURES = [
  "starterEdge",
  "formEdge",
  "bullpenEdge",
  "lineupEdge",
  "totalEdge",
];

function bucketAudit(
  market,
  feature
) {
  const source =
    selected.filter(
      r =>
        r.market === market &&
        number(
          r[feature]
        ) !== null
    );

  if (
    source.length < 30
  ) {
    return;
  }

  const absValues =
    source.map(
      r =>
        Math.abs(
          number(
            r[feature]
          )
        )
    );

  const med =
    median(
      absValues
    );

  if (
    med === null
  ) {
    return;
  }

  const low =
    source.filter(
      r =>
        Math.abs(
          number(
            r[feature]
          )
        ) < med
    );

  const high =
    source.filter(
      r =>
        Math.abs(
          number(
            r[feature]
          )
        ) >= med
    );

  console.log(
    market.padEnd(9),
    feature.padEnd(12),
    "median=",
    med.toFixed(4),
    "LOW",
    summarize(low),
    "HIGH",
    summarize(high)
  );
}

console.log(
  "\n===== FEATURE STRENGTH BUCKETS ====="
);

for (
  const market of [
    "ML",
    "HANDICAP",
    "TOTAL",
  ]
) {
  for (
    const feature of FEATURES
  ) {
    bucketAudit(
      market,
      feature
    );
  }
}


/*
============================================================
FEATURE DISTRIBUTIONS
v0.2에서 z-score 보정에 쓸 수 있는지 확인.
============================================================
*/

console.log(
  "\n===== FEATURE DISTRIBUTIONS ====="
);

for (
  const feature of FEATURES
) {
  const xs =
    valid
      .map(
        r =>
          number(
            r[feature]
          )
      )
      .filter(
        x =>
          x !== null
      );

  if (
    !xs.length
  ) {
    continue;
  }

  console.log(
    feature.padEnd(12),
    "N=",
    xs.length,
    "MEAN=",
    mean(xs).toFixed(4),
    "SD=",
    std(xs).toFixed(4),
    "MIN=",
    Math.min(...xs).toFixed(4),
    "MAX=",
    Math.max(...xs).toFixed(4)
  );
}


/*
============================================================
TOTAL EDGE 방향 검증

현재 선택된 O/U에서
totalEdge 절대값이 커질수록
실제 적중률이 개선되는지 본다.
============================================================
*/

console.log(
  "\n===== TOTAL EDGE BUCKETS ====="
);

const totalRows =
  selected.filter(
    r =>
      r.market ===
        "TOTAL" &&
      number(
        r.totalEdge
      ) !== null
  );

const totalCuts = [
  [0, 0.5],
  [0.5, 1],
  [1, 1.5],
  [1.5, 2],
  [2, 999],
];

for (
  const [
    lo,
    hi,
  ] of totalCuts
) {
  const group =
    totalRows.filter(
      r => {
        const edge =
          Math.abs(
            number(
              r.totalEdge
            )
          );

        return (
          edge >= lo &&
          edge < hi
        );
      }
    );

  console.log(
    `${lo}~${hi}`,
    summarize(group)
  );
}


/*
============================================================
CONFIDENCE CALIBRATION
============================================================
*/

console.log(
  "\n===== CONFIDENCE BUCKETS ====="
);

const confCuts = [
  [0.50, 0.54],
  [0.54, 0.58],
  [0.58, 0.62],
  [0.62, 0.66],
  [0.66, 0.70],
  [0.70, 1.01],
];

for (
  const market of [
    "ML",
    "HANDICAP",
    "TOTAL",
  ]
) {
  console.log(
    "\n--",
    market,
    "--"
  );

  const marketRows =
    selected.filter(
      r =>
        r.market === market
    );

  for (
    const [
      lo,
      hi,
    ] of confCuts
  ) {
    const group =
      marketRows.filter(
        r => {
          const c =
            number(
              r.confidence
            );

          return (
            c !== null &&
            c >= lo &&
            c < hi
          );
        }
      );

    if (
      !group.length
    ) {
      continue;
    }

    console.log(
      `${(
        lo * 100
      ).toFixed(0)}~${(
        hi * 100
      ).toFixed(0)}%`,
      summarize(group)
    );
  }
}


/*
============================================================
MONTHLY STABILITY
============================================================
*/

console.log(
  "\n===== MONTHLY MARKET STABILITY ====="
);

const months =
  [
    ...new Set(
      selected.map(
        r =>
          r.date.slice(
            0,
            7
          )
      )
    ),
  ].sort();

for (
  const month of months
) {
  const parts = [];

  for (
    const market of [
      "ML",
      "HANDICAP",
      "TOTAL",
    ]
  ) {
    const group =
      selected.filter(
        r =>
          r.market ===
            market &&
          r.date.startsWith(
            month
          )
      );

    const s =
      summarize(group);

    parts.push(
      `${market} ${s.wins}/${s.n} ${s.hit}`
    );
  }

  console.log(
    month,
    parts.join(
      " | "
    )
  );
}

console.log(
  "\n===== DONE ====="
);

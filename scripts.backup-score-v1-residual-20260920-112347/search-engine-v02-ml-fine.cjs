const fs = require("fs");

const raw = JSON.parse(
  fs.readFileSync(
    "data/kbo-backtest-2026-all-candidates-lineup-base.json",
    "utf8"
  )
);

const rows =
  (Array.isArray(raw)
    ? raw
    : raw.results || [])
  .filter(
    r =>
      r &&
      r.market === "ML" &&
      r.date <= "2026-09-13" &&
      ["WIN", "LOSS"].includes(r.result)
  );

const TRAIN_END = "2026-07-31";

const TRAIN =
  rows.filter(
    r => r.date <= TRAIN_END
  );

const VALID =
  rows.filter(
    r => r.date > TRAIN_END
  );

function num(v) {
  const n = Number(v);

  return Number.isFinite(n)
    ? n
    : null;
}

function clamp(
  v,
  lo = 0.001,
  hi = 0.999
) {
  return Math.max(
    lo,
    Math.min(
      hi,
      v
    )
  );
}

function logit(p) {
  const x =
    clamp(p);

  return Math.log(
    x /
    (1 - x)
  );
}

function sigmoid(x) {
  return (
    1 /
    (
      1 +
      Math.exp(-x)
    )
  );
}

function fairPair(a, b) {
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    a <= 1 ||
    b <= 1
  ) {
    return null;
  }

  const ia = 1 / a;
  const ib = 1 / b;

  const sum =
    ia + ib;

  return [
    ia / sum,
    ib / sum,
  ];
}

function isAwayPick(row) {
  return (
    typeof row.label === "string" &&
    typeof row.awayTeam === "string" &&
    row.label.includes(row.awayTeam)
  );
}

function isHomePick(row) {
  return (
    typeof row.label === "string" &&
    typeof row.homeTeam === "string" &&
    row.label.includes(row.homeTeam)
  );
}

function group(source) {
  const map =
    new Map();

  for (
    const row of source
  ) {
    const key =
      row.gameId;

    if (!map.has(key)) {
      map.set(
        key,
        []
      );
    }

    map
      .get(key)
      .push(row);
  }

  return [
    ...map.values()
  ];
}

function scoreRow(
  row,
  pair,
  marketBlend,
  starterBeta
) {
  const model =
    num(row.confidence) ?? 0.5;

  const oddsFair =
    fairPair(
      num(pair[0]?.odds),
      num(pair[1]?.odds)
    );

  let market = 0.5;

  if (oddsFair) {
    market =
      row === pair[0]
        ? oddsFair[0]
        : oddsFair[1];
  }

  const edge =
    num(row.starterEdge) ?? 0;

  let signedStarter = 0;

  if (isAwayPick(row)) {
    signedStarter =
      edge;
  } else if (
    isHomePick(row)
  ) {
    signedStarter =
      -edge;
  }

  const starterZ =
    signedStarter /
    32.5641;

  return sigmoid(
    (
      1 - marketBlend
    ) *
      logit(model) +
    marketBlend *
      logit(market) +
    starterBeta *
      starterZ
  );
}

function select(
  source,
  marketBlend,
  starterBeta
) {
  const picked = [];

  for (
    const pair of group(source)
  ) {
    if (
      pair.length < 2
    ) {
      continue;
    }

    let best = null;
    let bestScore =
      -Infinity;

    for (
      const row of pair
    ) {
      const score =
        scoreRow(
          row,
          pair,
          marketBlend,
          starterBeta
        );

      if (
        score >
        bestScore
      ) {
        bestScore =
          score;

        best = {
          ...row,
          candidateScore:
            score,
        };
      }
    }

    if (best) {
      picked.push(best);
    }
  }

  return picked;
}

function summarize(list) {
  const wins =
    list.filter(
      r =>
        r.result === "WIN"
    ).length;

  return {
    n: list.length,
    wins,
    hit:
      list.length
        ? wins / list.length
        : 0,
  };
}

function monthly(list) {
  const map =
    new Map();

  for (
    const row of list
  ) {
    const month =
      row.date.slice(0, 7);

    if (!map.has(month)) {
      map.set(
        month,
        []
      );
    }

    map
      .get(month)
      .push(row);
  }

  return [
    ...map.entries()
  ].map(
    ([month, rows]) => ({
      month,
      ...summarize(rows),
    })
  );
}

const blends = [];

for (
  let x = 0.35;
  x <= 0.6001;
  x += 0.025
) {
  blends.push(
    Number(
      x.toFixed(3)
    )
  );
}

const betas = [];

for (
  let x = -0.10;
  x <= 0.1001;
  x += 0.025
) {
  betas.push(
    Number(
      x.toFixed(3)
    )
  );
}

const results = [];

for (
  const marketBlend
  of blends
) {
  for (
    const starterBeta
    of betas
  ) {
    const train =
      select(
        TRAIN,
        marketBlend,
        starterBeta
      );

    const valid =
      select(
        VALID,
        marketBlend,
        starterBeta
      );

    const trainS =
      summarize(train);

    const validS =
      summarize(valid);

    /*
      TRAIN 중심으로 후보 정렬,
      VALID는 선정 후 확인.
    */
    results.push({
      marketBlend,
      starterBeta,
      train:
        trainS,
      valid:
        validS,
      trainRows:
        train,
      validRows:
        valid,
    });
  }
}

results.sort(
  (a, b) =>
    b.train.hit -
    a.train.hit
);

console.log(
  "===== TOP 20 ML BY TRAIN ====="
);

for (
  let i = 0;
  i < 20;
  i++
) {
  const r =
    results[i];

  console.log(
    "\nRANK",
    i + 1
  );

  console.log(
    "CONFIG",
    {
      marketBlend:
        r.marketBlend,
      starterBeta:
        r.starterBeta,
    }
  );

  console.log(
    "TRAIN",
    r.train
  );

  console.log(
    "VALID",
    r.valid
  );

  console.log(
    "VALID MONTHLY",
    monthly(
      r.validRows
    )
  );
}

const baselineTrain =
  select(
    TRAIN,
    0,
    0
  );

const baselineValid =
  select(
    VALID,
    0,
    0
  );

console.log(
  "\n===== BASELINE ====="
);

console.log(
  "TRAIN",
  summarize(
    baselineTrain
  )
);

console.log(
  "VALID",
  summarize(
    baselineValid
  )
);

console.log(
  "VALID MONTHLY",
  monthly(
    baselineValid
  )
);

console.log(
  "\nSSH ANALYSIS DONE"
);

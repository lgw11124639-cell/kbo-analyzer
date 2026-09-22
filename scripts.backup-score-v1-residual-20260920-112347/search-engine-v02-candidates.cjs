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
      r.date <= "2026-09-13" &&
      ["WIN", "LOSS"].includes(r.result)
  );

const TRAIN_END =
  "2026-07-31";

const TRAIN =
  rows.filter(
    r =>
      r.date <= TRAIN_END
  );

const VALID =
  rows.filter(
    r =>
      r.date > TRAIN_END
  );

function num(v) {
  const n =
    Number(v);

  return Number.isFinite(n)
    ? n
    : null;
}

function clamp(
  v,
  lo = 0.01,
  hi = 0.99
) {
  return Math.max(
    lo,
    Math.min(
      hi,
      v
    )
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

function logit(p) {
  const x =
    clamp(
      p,
      0.001,
      0.999
    );

  return Math.log(
    x /
    (1 - x)
  );
}

function summary(list) {
  const wins =
    list.filter(
      x =>
        x.result === "WIN"
    ).length;

  const n =
    list.length;

  return {
    n,
    wins,
    hit:
      n
        ? wins / n
        : 0,
  };
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

  const ia =
    1 / a;

  const ib =
    1 / b;

  const sum =
    ia + ib;

  return [
    ia / sum,
    ib / sum,
  ];
}

function groupRows(
  source,
  market
) {
  const map =
    new Map();

  for (
    const row of source
  ) {
    if (
      row.market !== market
    ) {
      continue;
    }

    const key =
      `${row.gameId}::${market}`;

    if (!map.has(key)) {
      map.set(
        key,
        []
      );
    }

    map.get(key).push(row);
  }

  return [
    ...map.values()
  ];
}

function isAwayPick(row) {
  return (
    typeof row.label === "string" &&
    typeof row.awayTeam === "string" &&
    row.label.includes(
      row.awayTeam
    )
  );
}

function isHomePick(row) {
  return (
    typeof row.label === "string" &&
    typeof row.homeTeam === "string" &&
    row.label.includes(
      row.homeTeam
    )
  );
}

function mlScore(
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

  let market =
    0.5;

  if (oddsFair) {
    if (
      row === pair[0]
    ) {
      market =
        oddsFair[0];
    } else {
      market =
        oddsFair[1];
    }
  }

  let starterSigned =
    0;

  const edge =
    num(row.starterEdge) ?? 0;

  if (
    isAwayPick(row)
  ) {
    starterSigned =
      edge;
  } else if (
    isHomePick(row)
  ) {
    starterSigned =
      -edge;
  }

  const starterZ =
    starterSigned /
    32.5641;

  const blendedLogit =
    (
      1 - marketBlend
    ) *
      logit(model) +
    marketBlend *
      logit(market) +
    starterBeta *
      starterZ;

  return sigmoid(
    blendedLogit
  );
}

function totalScore(
  row,
  pair,
  marketBlend
) {
  const model =
    num(row.confidence) ?? 0.5;

  const oddsFair =
    fairPair(
      num(pair[0]?.odds),
      num(pair[1]?.odds)
    );

  let market =
    0.5;

  if (oddsFair) {
    market =
      row === pair[0]
        ? oddsFair[0]
        : oddsFair[1];
  }

  const blendedLogit =
    (
      1 - marketBlend
    ) *
      logit(model) +
    marketBlend *
      logit(market);

  return sigmoid(
    blendedLogit
  );
}

function pickMarket(
  source,
  market,
  config
) {
  const groups =
    groupRows(
      source,
      market
    );

  const picked = [];

  for (
    const pair of groups
  ) {
    if (
      pair.length < 2
    ) {
      continue;
    }

    let best =
      null;

    let bestScore =
      -Infinity;

    for (
      const row of pair
    ) {
      let score;

      if (
        market === "ML"
      ) {
        score =
          mlScore(
            row,
            pair,
            config.mlMarketBlend,
            config.starterBeta
          );
      } else if (
        market === "TOTAL"
      ) {
        score =
          totalScore(
            row,
            pair,
            config.totalMarketBlend
          );
      } else {
        score =
          num(
            row.confidence
          ) ?? 0;
      }

      if (
        score >
        bestScore
      ) {
        bestScore =
          score;

        best =
          {
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

const mlBlends = [
  0,
  0.10,
  0.20,
  0.30,
  0.40,
  0.50,
];

const starterBetas = [
  -0.10,
  -0.05,
  0,
  0.05,
  0.10,
  0.15,
  0.20,
];

const totalBlends = [
  0,
  0.10,
  0.20,
  0.30,
  0.40,
  0.50,
  0.60,
];

const results = [];

for (
  const mlMarketBlend
  of mlBlends
) {
  for (
    const starterBeta
    of starterBetas
  ) {
    for (
      const totalMarketBlend
      of totalBlends
    ) {
      const config = {
        mlMarketBlend,
        starterBeta,
        totalMarketBlend,
      };

      const trainML =
        pickMarket(
          TRAIN,
          "ML",
          config
        );

      const trainHC =
        pickMarket(
          TRAIN,
          "HANDICAP",
          config
        );

      const trainTOTAL =
        pickMarket(
          TRAIN,
          "TOTAL",
          config
        );

      const trainAll = [
        ...trainML,
        ...trainHC,
        ...trainTOTAL,
      ];

      const trainSummary =
        summary(
          trainAll
        );

      const trainMLSummary =
        summary(
          trainML
        );

      const trainTotalSummary =
        summary(
          trainTOTAL
        );

      results.push({
        config,

        train: {
          all:
            trainSummary,
          ml:
            trainMLSummary,
          total:
            trainTotalSummary,
        },
      });
    }
  }
}

/*
  TRAIN만 보고 후보 선정.
  너무 작은 차이 과적합 방지를 위해
  전체 + ML + TOTAL을 같이 본다.
*/
results.sort(
  (a, b) => {
    const sa =
      a.train.all.hit *
        0.45 +
      a.train.ml.hit *
        0.35 +
      a.train.total.hit *
        0.20;

    const sb =
      b.train.all.hit *
        0.45 +
      b.train.ml.hit *
        0.35 +
      b.train.total.hit *
        0.20;

    return sb - sa;
  }
);

const top =
  results.slice(
    0,
    15
  );

function evaluateValid(
  config
) {
  const ml =
    pickMarket(
      VALID,
      "ML",
      config
    );

  const hc =
    pickMarket(
      VALID,
      "HANDICAP",
      config
    );

  const total =
    pickMarket(
      VALID,
      "TOTAL",
      config
    );

  return {
    all:
      summary([
        ...ml,
        ...hc,
        ...total,
      ]),

    ml:
      summary(ml),

    handicap:
      summary(hc),

    total:
      summary(total),
  };
}

console.log(
  "===== TOP 15 BY TRAIN ====="
);

for (
  let i = 0;
  i < top.length;
  i++
) {
  const item =
    top[i];

  const valid =
    evaluateValid(
      item.config
    );

  console.log(
    "\nRANK",
    i + 1
  );

  console.log(
    "CONFIG",
    item.config
  );

  console.log(
    "TRAIN ALL",
    item.train.all,
    "ML",
    item.train.ml,
    "TOTAL",
    item.train.total
  );

  console.log(
    "VALID ALL",
    valid.all,
    "ML",
    valid.ml,
    "HC",
    valid.handicap,
    "TOTAL",
    valid.total
  );
}

/*
  현행 v0.1 비교
*/
const baselineConfig = {
  mlMarketBlend: 0,
  starterBeta: 0,
  totalMarketBlend: 0,
};

console.log(
  "\n===== BASELINE V0.1 ====="
);

console.log(
  "TRAIN",
  {
    all:
      summary([
        ...pickMarket(
          TRAIN,
          "ML",
          baselineConfig
        ),
        ...pickMarket(
          TRAIN,
          "HANDICAP",
          baselineConfig
        ),
        ...pickMarket(
          TRAIN,
          "TOTAL",
          baselineConfig
        ),
      ]),

    ml:
      summary(
        pickMarket(
          TRAIN,
          "ML",
          baselineConfig
        )
      ),

    total:
      summary(
        pickMarket(
          TRAIN,
          "TOTAL",
          baselineConfig
        )
      ),
  }
);

console.log(
  "VALID",
  evaluateValid(
    baselineConfig
  )
);

console.log(
  "\nSSH ANALYSIS DONE"
);

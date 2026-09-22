const fs = require("fs");

const INPUT =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw =
  JSON.parse(
    fs.readFileSync(INPUT, "utf8")
  );

const rows =
  (raw.results || raw)
    .filter(x =>
      ["WIN","LOSS"].includes(x.result) &&
      ["ML","HANDICAP","TOTAL"].includes(x.market) &&
      Number.isFinite(Number(x.odds)) &&
      Number(x.odds) > 1 &&
      Number.isFinite(Number(x.confidence))
    )
    .map(x => {
      let confidence =
        Number(x.confidence);

      if (confidence > 1) {
        confidence /= 100;
      }

      return {
        ...x,
        odds:
          Number(x.odds),
        confidence,
        actual:
          x.result === "WIN"
            ? 1
            : 0
      };
    });

const PERIODS = {
  DISCOVERY:[
    "2026-03-28",
    "2026-04-30"
  ],

  INTERNAL:[
    "2026-05-01",
    "2026-06-30"
  ]
};

const BUCKETS = [
  [0.40,0.45],
  [0.45,0.50],
  [0.50,0.55],
  [0.55,0.60],
  [0.60,0.65],
  [0.65,0.70],
  [0.70,0.75],
  [0.75,0.80],
  [0.80,0.90],
  [0.90,1.01]
];

function overallCalibration(list) {
  if (!list.length) {
    return {
      bets:0,
      avgPredicted:0,
      actualHit:0,
      gap:0,
      brier:0,
      rawMarketBrier:0
    };
  }

  const predicted =
    list.reduce(
      (s,x) =>
        s + x.confidence,
      0
    ) /
    list.length;

  const actual =
    list.reduce(
      (s,x) =>
        s + x.actual,
      0
    ) /
    list.length;

  const brier =
    list.reduce(
      (s,x) =>
        s +
        (
          x.confidence -
          x.actual
        ) ** 2,
      0
    ) /
    list.length;

  const marketBrier =
    list.reduce(
      (s,x) => {
        const p =
          1 / x.odds;

        return (
          s +
          (
            p -
            x.actual
          ) ** 2
        );
      },
      0
    ) /
    list.length;

  return {
    bets:
      list.length,

    avgPredicted:
      +(predicted*100)
        .toFixed(2),

    actualHit:
      +(actual*100)
        .toFixed(2),

    gap:
      +(
        (
          actual -
          predicted
        ) *
        100
      ).toFixed(2),

    brier:
      +brier
        .toFixed(4),

    rawMarketBrier:
      +marketBrier
        .toFixed(4)
  };
}

function bucketStats(
  list,
  min,
  max
) {
  const selected =
    list.filter(
      x =>
        x.confidence >= min &&
        x.confidence < max
    );

  if (!selected.length) {
    return {
      bets:0,
      predicted:0,
      actual:0,
      calibrationGap:0,
      avgOdds:0,
      marketBE:0,
      roi:0
    };
  }

  const predicted =
    selected.reduce(
      (s,x) =>
        s + x.confidence,
      0
    ) /
    selected.length;

  const actual =
    selected.reduce(
      (s,x) =>
        s + x.actual,
      0
    ) /
    selected.length;

  const avgOdds =
    selected.reduce(
      (s,x) =>
        s + x.odds,
      0
    ) /
    selected.length;

  const returned =
    selected.reduce(
      (s,x) =>
        s +
        (
          x.actual
            ? x.odds
            : 0
        ),
      0
    );

  const roi =
    returned /
    selected.length -
    1;

  return {
    bets:
      selected.length,

    predicted:
      +(predicted*100)
        .toFixed(2),

    actual:
      +(actual*100)
        .toFixed(2),

    calibrationGap:
      +(
        (
          actual -
          predicted
        ) *
        100
      ).toFixed(2),

    avgOdds:
      +avgOdds
        .toFixed(3),

    marketBE:
      +(100/avgOdds)
        .toFixed(2),

    roi:
      +(roi*100)
        .toFixed(2)
  };
}

function makeBucketTable(list) {
  return BUCKETS.map(
    ([min,max]) => ({
      bucket:
        `${Math.round(min*100)}-${Math.round(max*100)}%`,

      ...bucketStats(
        list,
        min,
        max
      )
    })
  );
}

const output = {};

console.log(
  "============================================================"
);

console.log(
  "KBO CONFIDENCE CALIBRATION V3.3"
);

console.log(
  "PREDICTED CONFIDENCE vs ACTUAL HIT RATE"
);

console.log(
  "FINAL 07~09: LOCKED"
);

console.log(
  "============================================================"
);

for (
  const [period,range]
  of Object.entries(
    PERIODS
  )
) {
  const [
    start,
    end
  ] = range;

  const source =
    rows.filter(
      x =>
        x.date >= start &&
        x.date <= end
    );

  output[period] = {};

  console.log();
  console.log(
    `===== ${period} / ALL =====`
  );

  const allOverall =
    overallCalibration(
      source
    );

  console.table([
    allOverall
  ]);

  const allBuckets =
    makeBucketTable(
      source
    );

  console.table(
    allBuckets
  );

  output[period].ALL = {
    overall:
      allOverall,
    buckets:
      allBuckets
  };

  for (
    const market
    of ["ML","HANDICAP","TOTAL"]
  ) {
    const marketRows =
      source.filter(
        x =>
          x.market === market
      );

    console.log();
    console.log(
      `===== ${period} / ${market} =====`
    );

    const marketOverall =
      overallCalibration(
        marketRows
      );

    console.table([
      marketOverall
    ]);

    const marketBuckets =
      makeBucketTable(
        marketRows
      );

    console.table(
      marketBuckets
    );

    output[period][market] = {
      overall:
        marketOverall,
      buckets:
        marketBuckets
    };
  }
}

/*
  confidence - raw implied probability
*/

const EDGE_BUCKETS = [
  [-0.20,-0.10],
  [-0.10,-0.05],
  [-0.05,0],
  [0,0.03],
  [0.03,0.05],
  [0.05,0.10],
  [0.10,0.20],
  [0.20,1]
];

const edgeOutput = {};

console.log();
console.log(
  "===== CONFIDENCE MINUS IMPLIED PROBABILITY ====="
);

for (
  const [period,range]
  of Object.entries(
    PERIODS
  )
) {
  const [
    start,
    end
  ] = range;

  const source =
    rows
      .filter(
        x =>
          x.date >= start &&
          x.date <= end
      )
      .map(x => ({
        ...x,

        confEdge:
          x.confidence -
          1/x.odds
      }));

  console.log();
  console.log(
    period
  );

  const table =
    EDGE_BUCKETS.map(
      ([min,max]) => {
        const selected =
          source.filter(
            x =>
              x.confEdge >= min &&
              x.confEdge < max
          );

        if (!selected.length) {
          return {
            edge:
              `${(min*100).toFixed(0)}~${(max*100).toFixed(0)}%`,

            bets:0,
            hit:0,
            avgOdds:0,
            roi:0
          };
        }

        const wins =
          selected.reduce(
            (s,x) =>
              s + x.actual,
            0
          );

        const avgOdds =
          selected.reduce(
            (s,x) =>
              s + x.odds,
            0
          ) /
          selected.length;

        const returned =
          selected.reduce(
            (s,x) =>
              s +
              (
                x.actual
                  ? x.odds
                  : 0
              ),
            0
          );

        return {
          edge:
            `${(min*100).toFixed(0)}~${(max*100).toFixed(0)}%`,

          bets:
            selected.length,

          hit:
            +(
              wins /
              selected.length *
              100
            ).toFixed(2),

          avgOdds:
            +avgOdds
              .toFixed(3),

          roi:
            +(
              (
                returned /
                selected.length -
                1
              ) *
              100
            ).toFixed(2)
        };
      }
    );

  console.table(
    table
  );

  edgeOutput[period] =
    table;
}

fs.writeFileSync(
  "data/kbo-confidence-calibration-v33.json",
  JSON.stringify(
    {
      generatedAt:
        new Date()
          .toISOString(),

      final:
        "LOCKED",

      output,
      edgeOutput
    },
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-confidence-calibration-v33.json"
);

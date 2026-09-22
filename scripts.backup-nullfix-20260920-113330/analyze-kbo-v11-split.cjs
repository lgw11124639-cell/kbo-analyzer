const fs = require("fs");

const j = JSON.parse(
  fs.readFileSync(
    "data/kbo-backtest-2026-all-candidates-lineup-base.json",
    "utf8"
  )
);

const all =
  j.results.filter(
    x =>
      x.result === "WIN" ||
      x.result === "LOSS"
  );

function stat(rows) {
  const wins =
    rows.filter(
      x => x.result === "WIN"
    ).length;

  const stake =
    rows.length * 10000;

  const returned =
    rows.reduce(
      (sum,x) =>
        sum +
        (
          x.result === "WIN"
            ? 10000 * x.odds
            : 0
        ),
      0
    );

  return {
    bets:
      rows.length,

    wins,

    losses:
      rows.length - wins,

    hitRate:
      rows.length
        ? +(
            wins /
            rows.length *
            100
          ).toFixed(2)
        : 0,

    avgOdds:
      rows.length
        ? +(
            rows.reduce(
              (s,x) =>
                s + x.odds,
              0
            ) /
            rows.length
          ).toFixed(3)
        : 0,

    avgConf:
      rows.length
        ? +(
            rows.reduce(
              (s,x) =>
                s +
                (x.confidence ?? 0),
              0
            ) /
            rows.length *
            100
          ).toFixed(2)
        : 0,

    avgEv:
      rows.length
        ? +(
            rows.reduce(
              (s,x) =>
                s +
                (x.ev ?? 0),
              0
            ) /
            rows.length *
            100
          ).toFixed(2)
        : 0,

    profit:
      Math.round(
        returned -
        stake
      ),

    roi:
      stake
        ? +(
            (
              returned -
              stake
            ) /
            stake *
            100
          ).toFixed(2)
        : 0,
  };
}

function side(x) {
  const label =
    String(
      x.label ?? ""
    ).toUpperCase();

  if (
    x.market === "TOTAL"
  ) {
    if (
      label.includes("UNDER") ||
      label.includes("언더")
    ) return "UNDER";

    if (
      label.includes("OVER") ||
      label.includes("오버")
    ) return "OVER";
  }

  if (
    x.market === "ML" ||
    x.market === "HANDICAP"
  ) {
    if (
      label.includes("HOME") ||
      label.includes("홈") ||
      label.includes(
        String(
          x.homeTeam
        ).toUpperCase()
      )
    ) return "HOME";

    if (
      label.includes("AWAY") ||
      label.includes("원정") ||
      label.includes(
        String(
          x.awayTeam
        ).toUpperCase()
      )
    ) return "AWAY";
  }

  return "UNKNOWN";
}

function report(
  title,
  rows
) {
  console.log();
  console.log(
    `========== ${title} ==========`
  );

  const pass =
    rows.filter(
      x =>
        x.passesCurrentFilter ===
        true
    );

  console.log();
  console.log(
    "===== CURRENT FILTER ====="
  );

  console.table([
    {
      group:
        "PASS",
      ...stat(pass),
    },
  ]);

  console.log();
  console.log(
    "===== PASS MARKET / SIDE ====="
  );

  const keys =
    [
      "ML|HOME",
      "ML|AWAY",
      "HANDICAP|HOME",
      "HANDICAP|AWAY",
      "TOTAL|OVER",
      "TOTAL|UNDER",
    ];

  console.table(
    keys.map(
      key => {
        const [
          market,
          direction,
        ] =
          key.split("|");

        return {
          group:
            key,

          ...stat(
            pass.filter(
              x =>
                x.market ===
                  market &&
                side(x) ===
                  direction
            )
          ),
        };
      }
    )
  );

  console.log();
  console.log(
    "===== PASS CONFIDENCE ====="
  );

  const confGroups = [
    [
      "55-59.9",
      .55,
      .60,
    ],
    [
      "60-64.9",
      .60,
      .65,
    ],
    [
      "65-69.9",
      .65,
      .70,
    ],
    [
      "70+",
      .70,
      9,
    ],
  ];

  console.table(
    confGroups.map(
      ([name,min,max]) => ({
        group:
          name,

        ...stat(
          pass.filter(
            x =>
              x.confidence >=
                min &&
              x.confidence <
                max
          )
        ),
      })
    )
  );

  console.log();
  console.log(
    "===== PASS EV ====="
  );

  const evGroups = [
    [
      "0-2.9",
      0,
      .03,
    ],
    [
      "3-4.9",
      .03,
      .05,
    ],
    [
      "5-9.9",
      .05,
      .10,
    ],
    [
      "10+",
      .10,
      9,
    ],
  ];

  console.table(
    evGroups.map(
      ([name,min,max]) => ({
        group:
          name,

        ...stat(
          pass.filter(
            x =>
              x.ev >= min &&
              x.ev < max
          )
        ),
      })
    )
  );

  console.log();
  console.log(
    "===== PASS ODDS ====="
  );

  const oddsGroups = [
    ["1.20-1.39",1.2,1.4],
    ["1.40-1.59",1.4,1.6],
    ["1.60-1.79",1.6,1.8],
    ["1.80-1.99",1.8,2.0],
    ["2.00+",2.0,99],
  ];

  console.table(
    oddsGroups.map(
      ([name,min,max]) => ({
        group:
          name,

        ...stat(
          pass.filter(
            x =>
              x.odds >= min &&
              x.odds < max
          )
        ),
      })
    )
  );
}

const train =
  all.filter(
    x =>
      x.date >=
        "2026-03-28" &&
      x.date <=
        "2026-06-30"
  );

const validation =
  all.filter(
    x =>
      x.date >=
        "2026-07-01"
  );

report(
  "TRAIN 03-06",
  train
);

report(
  "VALIDATION 07-09",
  validation
);

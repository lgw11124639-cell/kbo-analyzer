const fs = require("fs");

const FILE =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const j = JSON.parse(
  fs.readFileSync(FILE, "utf8")
);

const all =
  j.results.filter(
    x =>
      x.result === "WIN" ||
      x.result === "LOSS"
  );

function pct(v) {
  if (
    typeof v !== "number" ||
    !Number.isFinite(v)
  ) return null;

  return Math.abs(v) <= 1
    ? v * 100
    : v;
}

function side(x) {
  const label =
    String(x.label ?? "")
      .toUpperCase();

  if (x.market === "TOTAL") {
    if (
      label.includes("OVER") ||
      label.includes("오버")
    ) return "OVER";

    if (
      label.includes("UNDER") ||
      label.includes("언더")
    ) return "UNDER";
  }

  if (
    x.market === "ML" ||
    x.market === "HANDICAP"
  ) {
    const home =
      String(x.homeTeam ?? "")
        .toUpperCase();

    const away =
      String(x.awayTeam ?? "")
        .toUpperCase();

    if (
      label.includes("HOME") ||
      label.includes("홈") ||
      (
        home &&
        label.includes(home)
      )
    ) {
      return "HOME";
    }

    if (
      label.includes("AWAY") ||
      label.includes("원정") ||
      (
        away &&
        label.includes(away)
      )
    ) {
      return "AWAY";
    }
  }

  return "UNKNOWN";
}

function stat(rows) {
  const wins =
    rows.filter(
      x => x.result === "WIN"
    ).length;

  const losses =
    rows.filter(
      x => x.result === "LOSS"
    ).length;

  const stake =
    (wins + losses) * 10000;

  const returned =
    rows.reduce(
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

  const oddsList =
    rows
      .map(x => x.odds)
      .filter(
        x =>
          typeof x === "number" &&
          Number.isFinite(x)
      );

  const confList =
    rows
      .map(x => pct(x.confidence))
      .filter(x => x !== null);

  const evList =
    rows
      .map(x => pct(x.ev))
      .filter(x => x !== null);

  return {
    bets:
      wins + losses,

    wins,
    losses,

    hitRate:
      wins + losses
        ? +(
            wins /
            (wins + losses) *
            100
          ).toFixed(2)
        : 0,

    avgOdds:
      oddsList.length
        ? +(
            oddsList.reduce(
              (a,b) => a+b,
              0
            ) /
            oddsList.length
          ).toFixed(3)
        : 0,

    avgConf:
      confList.length
        ? +(
            confList.reduce(
              (a,b) => a+b,
              0
            ) /
            confList.length
          ).toFixed(2)
        : 0,

    avgEv:
      evList.length
        ? +(
            evList.reduce(
              (a,b) => a+b,
              0
            ) /
            evList.length
          ).toFixed(2)
        : 0,

    profit:
      Math.round(profit),

    roi:
      stake
        ? +(
            profit /
            stake *
            100
          ).toFixed(2)
        : 0,
  };
}

function isEv3to10(x) {
  const ev = pct(x.ev);

  return (
    ev !== null &&
    ev >= 3 &&
    ev < 10
  );
}

function isEv3to5(x) {
  const ev = pct(x.ev);

  return (
    ev !== null &&
    ev >= 3 &&
    ev < 5
  );
}

function isEv5to10(x) {
  const ev = pct(x.ev);

  return (
    ev !== null &&
    ev >= 5 &&
    ev < 10
  );
}

const evRows =
  all.filter(isEv3to10);

const train =
  evRows.filter(
    x =>
      x.date >= "2026-03-28" &&
      x.date <= "2026-06-30"
  );

const valid =
  evRows.filter(
    x =>
      x.date >= "2026-07-01"
  );

function printTable(
  title,
  rows,
  groups
) {
  console.log();
  console.log(
    `===== ${title} =====`
  );

  console.table(
    groups.map(
      ([name, fn]) => ({
        group: name,
        ...stat(
          rows.filter(fn)
        ),
      })
    )
  );
}

function report(
  title,
  rows
) {
  console.log();
  console.log();
  console.log(
    "======================================"
  );
  console.log(title);
  console.log(
    "======================================"
  );

  console.log();
  console.log(
    "OVERALL:",
    stat(rows)
  );

  printTable(
    "EV BAND",
    rows,
    [
      [
        "EV 3-5",
        isEv3to5,
      ],
      [
        "EV 5-10",
        isEv5to10,
      ],
    ]
  );

  printTable(
    "MARKET",
    rows,
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
          x.market ===
          "TOTAL",
      ],
    ]
  );

  printTable(
    "MARKET / SIDE",
    rows,
    [
      [
        "ML HOME",
        x =>
          x.market === "ML" &&
          side(x) === "HOME",
      ],
      [
        "ML AWAY",
        x =>
          x.market === "ML" &&
          side(x) === "AWAY",
      ],
      [
        "HCAP HOME",
        x =>
          x.market ===
            "HANDICAP" &&
          side(x) === "HOME",
      ],
      [
        "HCAP AWAY",
        x =>
          x.market ===
            "HANDICAP" &&
          side(x) === "AWAY",
      ],
      [
        "TOTAL OVER",
        x =>
          x.market ===
            "TOTAL" &&
          side(x) === "OVER",
      ],
      [
        "TOTAL UNDER",
        x =>
          x.market ===
            "TOTAL" &&
          side(x) === "UNDER",
      ],
    ]
  );

  printTable(
    "ODDS",
    rows,
    [
      [
        "1.00-1.39",
        x =>
          x.odds >= 1 &&
          x.odds < 1.4,
      ],
      [
        "1.40-1.59",
        x =>
          x.odds >= 1.4 &&
          x.odds < 1.6,
      ],
      [
        "1.60-1.79",
        x =>
          x.odds >= 1.6 &&
          x.odds < 1.8,
      ],
      [
        "1.80-1.99",
        x =>
          x.odds >= 1.8 &&
          x.odds < 2,
      ],
      [
        "2.00-2.49",
        x =>
          x.odds >= 2 &&
          x.odds < 2.5,
      ],
      [
        "2.50+",
        x =>
          x.odds >= 2.5,
      ],
    ]
  );

  printTable(
    "CONFIDENCE",
    rows,
    [
      [
        "< 50",
        x =>
          pct(x.confidence) <
          50,
      ],
      [
        "50-54.9",
        x => {
          const c =
            pct(x.confidence);

          return (
            c >= 50 &&
            c < 55
          );
        },
      ],
      [
        "55-59.9",
        x => {
          const c =
            pct(x.confidence);

          return (
            c >= 55 &&
            c < 60
          );
        },
      ],
      [
        "60-64.9",
        x => {
          const c =
            pct(x.confidence);

          return (
            c >= 60 &&
            c < 65
          );
        },
      ],
      [
        "65-69.9",
        x => {
          const c =
            pct(x.confidence);

          return (
            c >= 65 &&
            c < 70
          );
        },
      ],
      [
        "70+",
        x =>
          pct(x.confidence) >=
          70,
      ],
    ]
  );

  /*
    월별
  */
  const months =
    [...new Set(
      rows.map(
        x => x.month
      )
    )]
      .filter(Boolean)
      .sort();

  console.log();
  console.log(
    "===== MONTHLY ====="
  );

  console.table(
    months.map(
      month => ({
        month,
        ...stat(
          rows.filter(
            x =>
              x.month === month
          )
        ),
      })
    )
  );

  /*
    날짜순 누적손익 / MDD
  */
  const sorted =
    [...rows].sort(
      (a,b) => {
        const d =
          String(a.date)
            .localeCompare(
              String(b.date)
            );

        if (d !== 0)
          return d;

        return String(
          a.gameId ?? ""
        ).localeCompare(
          String(
            b.gameId ?? ""
          )
        );
      }
    );

  let cumulative = 0;
  let peak = 0;

  let maxDrawdown = 0;
  let maxDrawdownPct = 0;

  const startBankroll =
    1000000;

  let bankroll =
    startBankroll;

  let peakBankroll =
    bankroll;

  let worstFromDate =
    null;

  let currentPeakDate =
    null;

  for (const x of sorted) {
    const pnl =
      x.result === "WIN"
        ? 10000 *
          (x.odds - 1)
        : -10000;

    cumulative += pnl;

    if (
      cumulative > peak
    ) {
      peak = cumulative;
    }

    const dd =
      peak - cumulative;

    if (
      dd > maxDrawdown
    ) {
      maxDrawdown = dd;
    }

    bankroll += pnl;

    if (
      bankroll >
      peakBankroll
    ) {
      peakBankroll =
        bankroll;

      currentPeakDate =
        x.date;
    }

    const ddPct =
      peakBankroll > 0
        ? (
            (
              peakBankroll -
              bankroll
            ) /
            peakBankroll *
            100
          )
        : 0;

    if (
      ddPct >
      maxDrawdownPct
    ) {
      maxDrawdownPct =
        ddPct;

      worstFromDate = {
        peakDate:
          currentPeakDate,

        bottomDate:
          x.date,
      };
    }
  }

  console.log();
  console.log(
    "===== RISK / DRAWDOWN ====="
  );

  console.table([
    {
      startBankroll:
        startBankroll,

      endBankroll:
        Math.round(
          bankroll
        ),

      netProfit:
        Math.round(
          bankroll -
          startBankroll
        ),

      maxDrawdown:
        Math.round(
          maxDrawdown
        ),

      maxDrawdownPct:
        +maxDrawdownPct
          .toFixed(2),

      peakDate:
        worstFromDate
          ?.peakDate ??
          null,

      bottomDate:
        worstFromDate
          ?.bottomDate ??
          null,
    },
  ]);
}

report(
  "TRAIN EV 3~10% / 03-06",
  train
);

report(
  "VALIDATION EV 3~10% / 07-09",
  valid
);

report(
  "ALL EV 3~10%",
  evRows
);

/*
  두 기간 모두 존재하는 세부 패턴 비교
*/
const candidateRules = [
  [
    "EV3-5",
    isEv3to5,
  ],

  [
    "EV5-10",
    isEv5to10,
  ],

  [
    "ML",
    x =>
      x.market === "ML",
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
      x.market ===
      "TOTAL",
  ],

  [
    "TOTAL OVER",
    x =>
      x.market === "TOTAL" &&
      side(x) === "OVER",
  ],

  [
    "TOTAL UNDER",
    x =>
      x.market === "TOTAL" &&
      side(x) === "UNDER",
  ],

  [
    "ODDS 1.60-1.79",
    x =>
      x.odds >= 1.6 &&
      x.odds < 1.8,
  ],

  [
    "ODDS 1.80-1.99",
    x =>
      x.odds >= 1.8 &&
      x.odds < 2,
  ],

  [
    "ODDS 2.00-2.49",
    x =>
      x.odds >= 2 &&
      x.odds < 2.5,
  ],

  [
    "ODDS 2.50+",
    x =>
      x.odds >= 2.5,
  ],

  [
    "CONF 50-55",
    x => {
      const c =
        pct(x.confidence);

      return (
        c >= 50 &&
        c < 55
      );
    },
  ],

  [
    "CONF 55-60",
    x => {
      const c =
        pct(x.confidence);

      return (
        c >= 55 &&
        c < 60
      );
    },
  ],

  [
    "CONF 60-65",
    x => {
      const c =
        pct(x.confidence);

      return (
        c >= 60 &&
        c < 65
      );
    },
  ],
];

console.log();
console.log();
console.log(
  "======================================"
);
console.log(
  "TRAIN / VALIDATION 세부 비교"
);
console.log(
  "======================================"
);

const compare =
  candidateRules.map(
    ([name, fn]) => {
      const tr =
        stat(
          train.filter(fn)
        );

      const va =
        stat(
          valid.filter(fn)
        );

      return {
        rule: name,

        trainBets:
          tr.bets,

        trainHit:
          tr.hitRate,

        trainROI:
          tr.roi,

        validBets:
          va.bets,

        validHit:
          va.hitRate,

        validROI:
          va.roi,
      };
    }
  );

console.table(compare);

console.log();
console.log(
  "===== 양쪽 모두 +ROI & 최소 표본 ====="
);

console.table(
  compare
    .filter(
      x =>
        x.trainBets >= 10 &&
        x.validBets >= 8 &&
        x.trainROI > 0 &&
        x.validROI > 0
    )
    .sort(
      (a,b) =>
        Math.min(
          b.trainROI,
          b.validROI
        ) -
        Math.min(
          a.trainROI,
          a.validROI
        )
    )
);

console.log();
console.log(
  "TOTAL EV3-10 ROWS:",
  evRows.length
);
console.log(
  "TRAIN:",
  train.length
);
console.log(
  "VALID:",
  valid.length
);

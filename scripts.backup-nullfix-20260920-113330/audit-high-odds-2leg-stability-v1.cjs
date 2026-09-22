const fs = require("fs");

const raw =
  JSON.parse(
    fs.readFileSync(
      "data/kbo-engine-stats-v0.1-backtest.json",
      "utf8"
    )
  );

const rows =
  raw?.aiCombos?.records ||
  [];

const base =
  rows.filter(
    r =>
      r.mode === "HIGH_ODDS" &&
      Number(r.leg) === 2 &&
      Number(r.averageConfidence) >= 0.60
  );

const rules = [
  {
    name: "EV>=-3%",
    minEv: -0.03,
  },
  {
    name: "EV>=0%",
    minEv: 0,
  },
];

function phase(r) {
  return String(
    r.date || ""
  ) <= "2026-07-31"
    ? "TRAIN"
    : "VALID";
}

function settle(list) {
  let wins = 0;
  let losses = 0;
  let voids = 0;

  let stake = 0;
  let returned = 0;

  let oddsSum = 0;
  let confSum = 0;
  let evSum = 0;
  let evCount = 0;

  for (const r of list) {
    const result =
      String(
        r.result || ""
      ).toUpperCase();

    const odds =
      Number(
        r.effectiveOdds ??
        r.odds
      );

    const conf =
      Number(
        r.averageConfidence
      );

    const ev =
      Number(
        r.averageEv
      );

    stake += 1;

    if (result === "WIN") {
      wins++;

      returned +=
        Number.isFinite(odds)
          ? odds
          : 0;

    } else if (
      result === "LOSS"
    ) {
      losses++;

    } else {
      voids++;
      returned += 1;
    }

    if (
      Number.isFinite(odds)
    ) {
      oddsSum += odds;
    }

    if (
      Number.isFinite(conf)
    ) {
      confSum += conf;
    }

    if (
      Number.isFinite(ev)
    ) {
      evSum += ev;
      evCount++;
    }
  }

  const decided =
    wins + losses;

  return {
    n:
      list.length,

    wins,
    losses,
    voids,

    hit:
      decided
        ? wins / decided
        : null,

    roi:
      stake
        ? (
            returned -
            stake
          ) /
          stake
        : null,

    profit:
      returned -
      stake,

    avgOdds:
      list.length
        ? oddsSum /
          list.length
        : null,

    avgConf:
      list.length
        ? confSum /
          list.length
        : null,

    avgEv:
      evCount
        ? evSum /
          evCount
        : null,
  };
}

function pct(v) {
  return v === null
    ? "-"
    : (
        v * 100
      ).toFixed(1) + "%";
}

function dec(v) {
  return v === null
    ? "-"
    : v.toFixed(2);
}

function printSummary(
  label,
  list
) {
  const s =
    settle(list);

  console.log(
    [
      label.padEnd(12),
      `N=${String(
        s.n
      ).padStart(3)}`,
      `W/L=${String(
        s.wins
      ).padStart(2)}/${String(
        s.losses
      ).padStart(2)}`,
      `HIT=${pct(
        s.hit
      ).padStart(7)}`,
      `ROI=${pct(
        s.roi
      ).padStart(8)}`,
      `P=${s.profit.toFixed(
        2
      ).padStart(7)}`,
      `ODDS=${dec(
        s.avgOdds
      ).padStart(5)}`,
      `CONF=${pct(
        s.avgConf
      ).padStart(7)}`,
      `EV=${pct(
        s.avgEv
      ).padStart(7)}`,
    ].join(" | ")
  );
}

function groupBy(
  list,
  keyFn
) {
  const map =
    new Map();

  for (const row of list) {
    const key =
      keyFn(row);

    const bucket =
      map.get(key) || [];

    bucket.push(row);

    map.set(
      key,
      bucket
    );
  }

  return map;
}

console.log(
  "============================================"
);

console.log(
  "HIGH_ODDS 2LEG STABILITY AUDIT V1"
);

console.log(
  "CONF >= 60%"
);

console.log(
  "============================================"
);

for (
  const rule of rules
) {
  const list =
    base.filter(
      r =>
        Number(
          r.averageEv
        ) >= rule.minEv
    );

  console.log(
    `\n\n############################################`
  );

  console.log(
    `RULE: ${rule.name}`
  );

  console.log(
    `############################################`
  );

  printSummary(
    "ALL",
    list
  );

  printSummary(
    "TRAIN",
    list.filter(
      r =>
        phase(r) ===
        "TRAIN"
    )
  );

  printSummary(
    "VALID",
    list.filter(
      r =>
        phase(r) ===
        "VALID"
    )
  );

  console.log(
    "\n===== MONTHLY ====="
  );

  const monthly =
    groupBy(
      list,
      r =>
        String(
          r.date || ""
        ).slice(0, 7)
    );

  for (
    const [
      month,
      monthRows,
    ]
    of [
      ...monthly.entries(),
    ].sort(
      (a, b) =>
        a[0].localeCompare(
          b[0]
        )
    )
  ) {
    printSummary(
      month,
      monthRows
    );
  }

  console.log(
    "\n===== DAILY ====="
  );

  const daily =
    groupBy(
      list,
      r =>
        String(
          r.date || ""
        )
    );

  for (
    const [
      date,
      dateRows,
    ]
    of [
      ...daily.entries(),
    ].sort(
      (a, b) =>
        a[0].localeCompare(
          b[0]
        )
    )
  ) {
    printSummary(
      date,
      dateRows
    );
  }

  console.log(
    "\n===== BEST / WORST DAYS ====="
  );

  const dayStats =
    [
      ...daily.entries(),
    ]
      .map(
        ([
          date,
          dayRows,
        ]) => ({
          date,
          rows:
            dayRows,
          stats:
            settle(
              dayRows
            ),
        })
      );

  const bestDays =
    [...dayStats]
      .sort(
        (a, b) =>
          b.stats.profit -
          a.stats.profit
      )
      .slice(
        0,
        10
      );

  const worstDays =
    [...dayStats]
      .sort(
        (a, b) =>
          a.stats.profit -
          b.stats.profit
      )
      .slice(
        0,
        10
      );

  console.log(
    "\nTOP 10"
  );

  for (
    const x of bestDays
  ) {
    printSummary(
      x.date,
      x.rows
    );
  }

  console.log(
    "\nBOTTOM 10"
  );

  for (
    const x of worstDays
  ) {
    printSummary(
      x.date,
      x.rows
    );
  }

  console.log(
    "\n===== LEAVE-ONE-MONTH-OUT ====="
  );

  const months =
    [
      ...monthly.keys(),
    ].sort();

  for (
    const month
    of months
  ) {
    const without =
      list.filter(
        r =>
          String(
            r.date || ""
          ).slice(
            0,
            7
          ) !== month
      );

    printSummary(
      `NO ${month}`,
      without
    );
  }
}

console.log(
  "\n===== DONE ====="
);

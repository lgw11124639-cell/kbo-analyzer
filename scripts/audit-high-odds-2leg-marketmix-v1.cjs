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

const list =
  rows.filter(
    r =>
      r.mode === "HIGH_ODDS" &&
      Number(r.leg) === 2 &&
      Number(
        r.averageConfidence
      ) >= 0.60 &&
      Number(
        r.averageEv
      ) >= 0
  );

function phase(r) {
  return String(
    r.date || ""
  ) <= "2026-07-31"
    ? "TRAIN"
    : "VALID";
}

function comboMarketKey(r) {
  const markets =
    (r.picks || [])
      .map(
        p =>
          String(
            p.market || ""
          ).toUpperCase()
      )
      .sort();

  return markets.join("+");
}

function settle(rows) {
  let wins = 0;
  let losses = 0;
  let stake = 0;
  let returned = 0;

  for (const r of rows) {
    const result =
      String(
        r.result || ""
      ).toUpperCase();

    const odds =
      Number(
        r.effectiveOdds ??
        r.odds
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
      returned += 1;
    }
  }

  const decided =
    wins + losses;

  return {
    n:
      rows.length,

    wins,
    losses,

    hit:
      decided
        ? wins / decided
        : null,

    roi:
      stake
        ? (
            returned -
            stake
          ) / stake
        : null,

    profit:
      returned -
      stake,
  };
}

function pct(v) {
  return v === null
    ? "-"
    : (
        v * 100
      ).toFixed(1) + "%";
}

function print(
  name,
  rows
) {
  const s =
    settle(rows);

  console.log(
    [
      name.padEnd(22),

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
    ].join(
      " | "
    )
  );
}

const groups =
  new Map();

for (const r of list) {
  const key =
    comboMarketKey(r);

  if (!groups.has(key)) {
    groups.set(
      key,
      []
    );
  }

  groups.get(
    key
  ).push(r);
}

console.log(
  "============================================"
);

console.log(
  "HIGH_ODDS 2LEG MARKET MIX AUDIT V1"
);

console.log(
  "CONF >= 60% / EV >= 0%"
);

console.log(
  "============================================"
);

print(
  "ALL",
  list
);

print(
  "TRAIN",
  list.filter(
    r =>
      phase(r) ===
      "TRAIN"
  )
);

print(
  "VALID",
  list.filter(
    r =>
      phase(r) ===
      "VALID"
  )
);

console.log(
  "\n===== MARKET MIX ====="
);

for (
  const [
    key,
    group
  ] of [
    ...groups.entries(),
  ].sort(
    (a, b) =>
      b[1].length -
      a[1].length
  )
) {
  console.log(
    `\n### ${key}`
  );

  print(
    "ALL",
    group
  );

  print(
    "TRAIN",
    group.filter(
      r =>
        phase(r) ===
        "TRAIN"
    )
  );

  print(
    "VALID",
    group.filter(
      r =>
        phase(r) ===
        "VALID"
    )
  );
}

console.log(
  "\n===== PICK MARKET COUNTS ====="
);

const pickCounts = {
  ML: 0,
  HANDICAP: 0,
  TOTAL: 0,
};

for (const r of list) {
  for (
    const p of
    r.picks || []
  ) {
    const market =
      String(
        p.market || ""
      ).toUpperCase();

    if (
      market in
      pickCounts
    ) {
      pickCounts[
        market
      ]++;
    }
  }
}

console.log(
  pickCounts
);

console.log(
  "\n===== DONE ====="
);

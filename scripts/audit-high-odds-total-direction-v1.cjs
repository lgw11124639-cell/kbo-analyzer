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
      Number(r.averageConfidence) >= 0.60 &&
      Number(r.averageEv) >= 0 &&
      Array.isArray(r.picks) &&
      r.picks.length === 2 &&
      r.picks.every(
        p =>
          String(
            p.market || ""
          ).toUpperCase() ===
          "TOTAL"
      )
  );

function phase(r) {
  return String(
    r.date || ""
  ) <= "2026-07-31"
    ? "TRAIN"
    : "VALID";
}

function directionKey(r) {
  const dirs =
    r.picks.map(
      p => {
        const label =
          String(
            p.label || ""
          );

        if (
          label.includes(
            "오버"
          )
        ) {
          return "OVER";
        }

        if (
          label.includes(
            "언더"
          )
        ) {
          return "UNDER";
        }

        return "UNKNOWN";
      }
    ).sort();

  return dirs.join("+");
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
    n: rows.length,
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
      ).toFixed(1) +
      "%";
}

function print(
  name,
  rows
) {
  const s =
    settle(rows);

  console.log(
    [
      name.padEnd(18),
      `N=${String(
        s.n
      ).padStart(2)}`,
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
      ).padStart(6)}`,
    ].join(
      " | "
    )
  );
}

const groups =
  new Map();

for (const r of list) {
  const key =
    directionKey(r);

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
  "HIGH_ODDS TOTAL+TOTAL DIRECTION AUDIT V1"
);

console.log(
  "2LEG / CONF>=60% / EV>=0%"
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
  "\n===== DIRECTION MIX ====="
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
  "\n===== ROWS ====="
);

for (const r of list) {
  console.log(
    r.date,
    "|",
    r.result,
    "|",
    Number(
      r.effectiveOdds ??
      r.odds
    ).toFixed(2),
    "|",
    r.picks
      .map(
        p =>
          `${p.label} ${(Number(p.confidence) * 100).toFixed(1)}%`
      )
      .join(" + ")
  );
}

console.log(
  "\n===== DONE ====="
);

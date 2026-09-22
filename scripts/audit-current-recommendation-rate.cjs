const fs = require("fs");

const raw = JSON.parse(
  fs.readFileSync(
    "data/kbo-backtest-2026-all-candidates-lineup-base.json",
    "utf8"
  )
);

const rows =
  Array.isArray(raw)
    ? raw
    : raw.results || raw.recommendations || [];

const valid =
  rows.filter(
    r =>
      r &&
      ["ML", "HANDICAP", "TOTAL"].includes(r.market) &&
      ["WIN", "LOSS"].includes(r.result)
  );

const byGameMarket =
  new Map();

for (const r of valid) {
  const key =
    `${r.gameId}::${r.market}`;

  const current =
    byGameMarket.get(key);

  if (
    !current ||
    Number(r.confidence) >
      Number(current.confidence)
  ) {
    byGameMarket.set(
      key,
      r
    );
  }
}

const selected =
  [...byGameMarket.values()];

const stats = {
  total: 0,
  recommended: 0,
  blockedEv: 0,
  blockedGrade: 0,
  blockedTotalEdge: 0,
  blockedNoOdds: 0,
};

const marketStats = {};

for (const r of selected) {
  stats.total++;

  const market =
    r.market;

  if (!marketStats[market]) {
    marketStats[market] = {
      total: 0,
      recommended: 0,
      blockedEv: 0,
      blockedGrade: 0,
      blockedTotalEdge: 0,
      blockedNoOdds: 0,
    };
  }

  const m =
    marketStats[market];

  m.total++;

  if (
    !r.odds ||
    Number(r.odds) <= 1
  ) {
    stats.blockedNoOdds++;
    m.blockedNoOdds++;
    continue;
  }

  if (
    r.grade === "C"
  ) {
    stats.blockedGrade++;
    m.blockedGrade++;
    continue;
  }

  if (
    r.ev === null ||
    Number(r.ev) <= 0
  ) {
    stats.blockedEv++;
    m.blockedEv++;
    continue;
  }

  if (
    market === "TOTAL"
  ) {
    const projected =
      Number(r.projectedTotal);

    const line =
      Number(r.totalLine);

    if (
      Number.isFinite(projected) &&
      Number.isFinite(line) &&
      Math.abs(
        projected - line
      ) < 0.8
    ) {
      stats.blockedTotalEdge++;
      m.blockedTotalEdge++;
      continue;
    }
  }

  stats.recommended++;
  m.recommended++;
}

function pct(a, b) {
  return b
    ? (
        a / b * 100
      ).toFixed(2) + "%"
    : "-";
}

console.log(
  "===== CURRENT RECOMMENDATION RATE ====="
);

console.log(
  "TOTAL CANDIDATES =",
  stats.total
);

console.log(
  "RECOMMENDED =",
  stats.recommended,
  pct(
    stats.recommended,
    stats.total
  )
);

console.log(
  "BLOCKED EV =",
  stats.blockedEv
);

console.log(
  "BLOCKED GRADE =",
  stats.blockedGrade
);

console.log(
  "BLOCKED TOTAL EDGE =",
  stats.blockedTotalEdge
);

console.log(
  "BLOCKED NO ODDS =",
  stats.blockedNoOdds
);

console.log(
  "\n===== BY MARKET ====="
);

for (
  const [market, s]
  of Object.entries(
    marketStats
  )
) {
  console.log(
    "\n",
    market
  );

  console.log(
    "TOTAL=",
    s.total
  );

  console.log(
    "RECOMMENDED=",
    s.recommended,
    pct(
      s.recommended,
      s.total
    )
  );

  console.log(
    "BLOCKED_EV=",
    s.blockedEv
  );

  console.log(
    "BLOCKED_GRADE=",
    s.blockedGrade
  );

  console.log(
    "BLOCKED_TOTAL_EDGE=",
    s.blockedTotalEdge
  );

  console.log(
    "BLOCKED_NO_ODDS=",
    s.blockedNoOdds
  );
}

console.log(
  "\n===== DONE ====="
);

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

function num(v) {
  const n = Number(v);

  return Number.isFinite(n)
    ? n
    : null;
}

function confidence(v) {
  let n = num(v);

  if (n === null) {
    return null;
  }

  if (n > 1) {
    n /= 100;
  }

  return n;
}

/*
  현재 운영 등급
  A >= 62%
  B >= 57%
  C < 57%
*/
function currentGrade(conf) {
  if (conf >= 0.62) {
    return "A";
  }

  if (conf >= 0.57) {
    return "B";
  }

  return "C";
}

function currentEv(conf, odds) {
  if (
    conf === null ||
    odds === null ||
    odds <= 1
  ) {
    return null;
  }

  return (
    conf * odds - 1
  );
}

const valid =
  rows.filter(
    r =>
      r &&
      ["ML", "HANDICAP", "TOTAL"]
        .includes(
          String(r.market)
            .toUpperCase()
        ) &&
      ["WIN", "LOSS"]
        .includes(
          String(r.result)
            .toUpperCase()
        )
  );

/*
  현재 화면과 동일하게
  경기 + 시장별 confidence 우세 방향 하나
*/
const byGameMarket =
  new Map();

for (const r of valid) {
  const market =
    String(r.market)
      .toUpperCase();

  const conf =
    confidence(
      r.confidence
    );

  if (conf === null) {
    continue;
  }

  const key =
    `${r.gameId}::${market}`;

  const current =
    byGameMarket.get(key);

  if (
    !current ||
    conf >
      confidence(
        current.confidence
      )
  ) {
    byGameMarket.set(
      key,
      r
    );
  }
}

const selected =
  [...byGameMarket.values()];

function emptyStats() {
  return {
    total: 0,

    gradeA: 0,
    gradeB: 0,
    gradeC: 0,

    evPositive: 0,
    evZeroOrNegative: 0,

    totalEdgePass: 0,
    totalEdgeFail: 0,

    recommended: 0,

    wins: 0,
    losses: 0,
  };
}

const overall =
  emptyStats();

const markets = {
  ML: emptyStats(),
  HANDICAP: emptyStats(),
  TOTAL: emptyStats(),
};

for (const r of selected) {
  const market =
    String(r.market)
      .toUpperCase();

  const conf =
    confidence(
      r.confidence
    );

  const odds =
    num(r.odds);

  if (
    conf === null ||
    !markets[market]
  ) {
    continue;
  }

  const grade =
    currentGrade(conf);

  const ev =
    currentEv(
      conf,
      odds
    );

  const projectedTotal =
    num(
      r.projectedTotal
    );

  const totalLine =
    num(
      r.totalLine
    );

  let totalEdgePass =
    true;

  if (
    market === "TOTAL" &&
    projectedTotal !== null &&
    totalLine !== null
  ) {
    totalEdgePass =
      Math.abs(
        projectedTotal -
        totalLine
      ) >= 0.8;
  }

  const recommended =
    odds !== null &&
    odds > 1 &&
    grade !== "C" &&
    ev !== null &&
    ev > 0 &&
    totalEdgePass;

  for (
    const s of [
      overall,
      markets[market],
    ]
  ) {
    s.total++;

    if (grade === "A") {
      s.gradeA++;
    } else if (
      grade === "B"
    ) {
      s.gradeB++;
    } else {
      s.gradeC++;
    }

    if (
      ev !== null &&
      ev > 0
    ) {
      s.evPositive++;
    } else {
      s.evZeroOrNegative++;
    }

    if (
      market === "TOTAL"
    ) {
      if (totalEdgePass) {
        s.totalEdgePass++;
      } else {
        s.totalEdgeFail++;
      }
    }

    if (recommended) {
      s.recommended++;

      if (
        String(r.result)
          .toUpperCase() ===
        "WIN"
      ) {
        s.wins++;
      } else {
        s.losses++;
      }
    }
  }
}

function pct(a, b) {
  return b
    ? (
        a /
        b *
        100
      ).toFixed(2) + "%"
    : "-";
}

function print(
  name,
  s
) {
  console.log(
    `\n===== ${name} =====`
  );

  console.log(
    "TOTAL =",
    s.total
  );

  console.log(
    "GRADE A =",
    s.gradeA,
    pct(
      s.gradeA,
      s.total
    )
  );

  console.log(
    "GRADE B =",
    s.gradeB,
    pct(
      s.gradeB,
      s.total
    )
  );

  console.log(
    "GRADE C =",
    s.gradeC,
    pct(
      s.gradeC,
      s.total
    )
  );

  console.log(
    "EV POSITIVE =",
    s.evPositive,
    pct(
      s.evPositive,
      s.total
    )
  );

  console.log(
    "EV <= 0 =",
    s.evZeroOrNegative,
    pct(
      s.evZeroOrNegative,
      s.total
    )
  );

  if (
    name === "TOTAL"
  ) {
    console.log(
      "O/U EDGE PASS =",
      s.totalEdgePass
    );

    console.log(
      "O/U EDGE FAIL =",
      s.totalEdgeFail
    );
  }

  console.log(
    "FINAL RECOMMENDED =",
    s.recommended,
    pct(
      s.recommended,
      s.total
    )
  );

  console.log(
    "RECOMMENDED RESULT =",
    `${s.wins}승 ${s.losses}패`,
    pct(
      s.wins,
      s.wins +
        s.losses
    )
  );
}

console.log(
  "===== CURRENT ENGINE RECOMMENDATION AUDIT V2 ====="
);

print(
  "OVERALL",
  overall
);

print(
  "ML",
  markets.ML
);

print(
  "HANDICAP",
  markets.HANDICAP
);

print(
  "TOTAL",
  markets.TOTAL
);

console.log(
  "\n===== DONE ====="
);

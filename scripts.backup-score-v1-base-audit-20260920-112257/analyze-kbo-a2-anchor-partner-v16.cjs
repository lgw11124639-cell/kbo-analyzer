const fs = require("fs");

const FILE =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const DATA =
  JSON.parse(
    fs.readFileSync(FILE, "utf8")
  );

const rows =
  (DATA.results || DATA)
    .filter(
      x =>
        ["WIN","LOSS","VOID"].includes(x.result) &&
        Number.isFinite(Number(x.odds)) &&
        Number(x.odds) > 1 &&
        Number.isFinite(Number(x.ev)) &&
        Number.isFinite(Number(x.confidence))
    )
    .map(x => ({
      ...x,
      odds: Number(x.odds),
      ev: Number(x.ev),
      confidence: Number(x.confidence),
    }));

const TRAIN_START = "2026-03-28";
const TRAIN_END   = "2026-06-30";
const VALID_START = "2026-07-01";

const STAKE = 10000;
const START_BANKROLL = 1000000;

function pct(v) {
  if (!Number.isFinite(v)) return null;
  return Math.abs(v) <= 1 ? v * 100 : v;
}

function evOf(x) {
  return pct(x.ev);
}

function confOf(x) {
  return pct(x.confidence);
}

function side(x) {
  const s =
    String(
      x.label ??
      x.side ??
      ""
    ).toUpperCase();

  if (
    s.includes("OVER") ||
    s.includes("오버")
  ) return "OVER";

  if (
    s.includes("UNDER") ||
    s.includes("언더")
  ) return "UNDER";

  if (
    s.includes("HOME") ||
    s.includes("홈")
  ) return "HOME";

  if (
    s.includes("AWAY") ||
    s.includes("원정")
  ) return "AWAY";

  return s;
}

function pickKey(x) {
  return `${x.gameId}:${x.market}:${x.label}`;
}

function gradeValue(x) {
  const g =
    String(x.grade || "")
      .toUpperCase();

  if (g === "A") return 3;
  if (g === "B") return 2;
  return 1;
}

function pickScore(x) {
  const ev =
    Math.max(
      -30,
      Math.min(
        35,
        evOf(x) ?? -30
      )
    );

  const conf =
    confOf(x) ?? 0;

  return (
    conf * 1.00 +
    ev * 0.90 +
    gradeValue(x) * 2 +
    Math.log(
      Math.max(1.01, x.odds)
    ) * 4
  );
}

function isAnchor(x) {
  const ev = evOf(x);

  return (
    x.market === "TOTAL" &&
    side(x) === "OVER" &&
    ev !== null &&
    ev >= 3 &&
    ev < 10
  );
}

const PARTNER_RULES = [
  {
    name: "ANY_EV3_10",
    fn: x => {
      const ev = evOf(x);
      return ev !== null &&
        ev >= 3 &&
        ev < 10;
    }
  },

  {
    name: "ML_EV3_10",
    fn: x => {
      const ev = evOf(x);
      return (
        x.market === "ML" &&
        ev !== null &&
        ev >= 3 &&
        ev < 10
      );
    }
  },

  {
    name: "HANDICAP_EV3_10",
    fn: x => {
      const ev = evOf(x);
      return (
        x.market === "HANDICAP" &&
        ev !== null &&
        ev >= 3 &&
        ev < 10
      );
    }
  },

  {
    name: "TOTAL_OVER_EV3_10",
    fn: x => {
      const ev = evOf(x);
      return (
        x.market === "TOTAL" &&
        side(x) === "OVER" &&
        ev !== null &&
        ev >= 3 &&
        ev < 10
      );
    }
  },

  {
    name: "TOTAL_ANY_EV3_10",
    fn: x => {
      const ev = evOf(x);
      return (
        x.market === "TOTAL" &&
        ev !== null &&
        ev >= 3 &&
        ev < 10
      );
    }
  },

  {
    name: "EV3_5",
    fn: x => {
      const ev = evOf(x);
      return ev !== null &&
        ev >= 3 &&
        ev < 5;
    }
  },

  {
    name: "EV5_10",
    fn: x => {
      const ev = evOf(x);
      return ev !== null &&
        ev >= 5 &&
        ev < 10;
    }
  },

  {
    name: "CONF55_PLUS",
    fn: x => {
      const c = confOf(x);
      return c !== null &&
        c >= 55;
    }
  },

  {
    name: "ML_CONF50_PLUS",
    fn: x => {
      const c = confOf(x);
      return (
        x.market === "ML" &&
        c !== null &&
        c >= 50
      );
    }
  },

  {
    name: "HANDICAP_ODDS2.5_PLUS",
    fn: x =>
      x.market === "HANDICAP" &&
      x.odds >= 2.5
  },
];

function canPair(a,b) {
  if (
    pickKey(a) ===
    pickKey(b)
  ) {
    return false;
  }

  if (
    a.gameId !==
    b.gameId
  ) {
    return true;
  }

  if (
    a.market ===
    b.market
  ) {
    return false;
  }

  const aSide =
    a.market === "ML" ||
    a.market === "HANDICAP";

  const bSide =
    b.market === "ML" ||
    b.market === "HANDICAP";

  if (aSide && bSide) {
    return false;
  }

  return true;
}

function groupByDate(source) {
  const map = new Map();

  for (const x of source) {
    if (!map.has(x.date)) {
      map.set(x.date, []);
    }

    map.get(x.date).push(x);
  }

  return [...map.entries()]
    .sort(
      (a,b) =>
        a[0].localeCompare(b[0])
    );
}

function makeDailyCombos(
  dayRows,
  rule
) {
  const anchors =
    dayRows
      .filter(isAnchor)
      .sort(
        (a,b) =>
          pickScore(b) -
          pickScore(a)
      );

  const partners =
    dayRows
      .filter(rule.fn)
      .sort(
        (a,b) =>
          pickScore(b) -
          pickScore(a)
      );

  const combos = [];

  for (const a of anchors) {
    for (const b of partners) {
      if (!canPair(a,b)) {
        continue;
      }

      const odds =
        a.odds * b.odds;

      if (
        odds < 2.0 ||
        odds > 6.0
      ) {
        continue;
      }

      const sameGame =
        a.gameId ===
        b.gameId;

      const avgConf =
        (
          (confOf(a) ?? 0) +
          (confOf(b) ?? 0)
        ) / 2;

      const avgEv =
        (
          (evOf(a) ?? 0) +
          (evOf(b) ?? 0)
        ) / 2;

      const score =
        pickScore(a) +
        pickScore(b) +
        avgConf * 0.15 +
        avgEv * 0.25 -
        Math.abs(
          odds - 3.0
        ) * 1.5;

      combos.push({
        a,
        b,
        odds,
        sameGame,
        avgConf,
        avgEv,
        score
      });
    }
  }

  combos.sort(
    (a,b) =>
      b.score-a.score
  );

  return combos;
}

function ticketResult(t) {
  const picks = [
    t.a,
    t.b
  ];

  if (
    picks.some(
      x => x.result === "LOSS"
    )
  ) {
    return {
      result: "LOSS",
      odds: 0
    };
  }

  const effectiveOdds =
    picks.reduce(
      (v,x) =>
        v *
        (
          x.result === "VOID"
            ? 1
            : x.odds
        ),
      1
    );

  const allVoid =
    picks.every(
      x => x.result === "VOID"
    );

  if (allVoid) {
    return {
      result: "VOID",
      odds: 1
    };
  }

  return {
    result: "WIN",
    odds: effectiveOdds
  };
}

function evaluate(
  source,
  rule
) {
  const tickets = [];

  for (
    const [date,dayRows]
    of groupByDate(source)
  ) {
    const combos =
      makeDailyCombos(
        dayRows,
        rule
      );

    if (!combos.length) {
      continue;
    }

    tickets.push({
      date,
      ...combos[0]
    });
  }

  let wins = 0;
  let losses = 0;
  let voids = 0;

  let invested = 0;
  let returned = 0;

  let sameGame = 0;
  let differentGame = 0;

  let oddsSum = 0;

  let loseStreak = 0;
  let maxLoseStreak = 0;

  let bankroll =
    START_BANKROLL;

  let peak =
    bankroll;

  let maxDD = 0;

  const monthly =
    new Map();

  const pairTypes =
    new Map();

  for (const t of tickets) {
    const r =
      ticketResult(t);

    invested += STAKE;
    oddsSum += t.odds;

    if (t.sameGame) {
      sameGame++;
    } else {
      differentGame++;
    }

    const pairName =
      [
        t.a.market === "TOTAL"
          ? side(t.a)
          : t.a.market,
        t.b.market === "TOTAL"
          ? side(t.b)
          : t.b.market
      ]
        .sort()
        .join("+");

    pairTypes.set(
      pairName,
      (
        pairTypes.get(pairName) ||
        0
      ) + 1
    );

    let ret = 0;

    if (r.result === "WIN") {
      wins++;
      ret =
        STAKE * r.odds;
      loseStreak = 0;
    }
    else if (
      r.result === "VOID"
    ) {
      voids++;
      ret = STAKE;
      loseStreak = 0;
    }
    else {
      losses++;
      loseStreak++;

      maxLoseStreak =
        Math.max(
          maxLoseStreak,
          loseStreak
        );
    }

    returned += ret;

    const pnl =
      ret - STAKE;

    bankroll += pnl;

    if (bankroll > peak) {
      peak = bankroll;
    }

    const dd =
      peak > 0
        ? (
            peak -
            bankroll
          ) /
          peak *
          100
        : 0;

    maxDD =
      Math.max(
        maxDD,
        dd
      );

    const month =
      t.date.slice(0,7);

    if (!monthly.has(month)) {
      monthly.set(
        month,
        {
          month,
          bets:0,
          wins:0,
          losses:0,
          voids:0,
          invested:0,
          returned:0
        }
      );
    }

    const m =
      monthly.get(month);

    m.bets++;
    m.invested += STAKE;
    m.returned += ret;

    if (
      r.result === "WIN"
    ) m.wins++;

    if (
      r.result === "LOSS"
    ) m.losses++;

    if (
      r.result === "VOID"
    ) m.voids++;
  }

  const settled =
    wins + losses;

  const profit =
    returned -
    invested;

  const monthRows =
    [...monthly.values()]
      .map(x => {
        const p =
          x.returned -
          x.invested;

        return {
          ...x,
          hitRate:
            (x.wins+x.losses)
              ? +(
                  x.wins /
                  (
                    x.wins +
                    x.losses
                  ) *
                  100
                ).toFixed(2)
              : 0,
          profit:
            Math.round(p),
          roi:
            x.invested
              ? +(
                  p /
                  x.invested *
                  100
                ).toFixed(2)
              : 0
        };
      });

  return {
    bets:
      tickets.length,

    settled,
    wins,
    losses,
    voids,

    hitRate:
      settled
        ? +(
            wins /
            settled *
            100
          ).toFixed(2)
        : 0,

    avgOdds:
      tickets.length
        ? +(
            oddsSum /
            tickets.length
          ).toFixed(3)
        : 0,

    invested:
      Math.round(invested),

    returned:
      Math.round(returned),

    profit:
      Math.round(profit),

    roi:
      invested
        ? +(
            profit /
            invested *
            100
          ).toFixed(2)
        : 0,

    sameGame,
    differentGame,

    maxLoseStreak,

    finalBankroll:
      Math.round(bankroll),

    MDD:
      +maxDD.toFixed(2),

    negativeMonths:
      monthRows.filter(
        x => x.profit < 0
      ).length,

    pairTypes:
      Object.fromEntries(
        [...pairTypes.entries()]
          .sort(
            (a,b) =>
              b[1]-a[1]
          )
      ),

    monthly:
      monthRows,

    tickets
  };
}

const train =
  rows.filter(
    x =>
      x.date >= TRAIN_START &&
      x.date <= TRAIN_END
  );

const valid =
  rows.filter(
    x =>
      x.date >= VALID_START
  );

console.log(
  "============================================================"
);

console.log(
  "KBO A2 ANCHOR + PARTNER V1.6"
);

console.log(
  "ANCHOR = TOTAL OVER / EV 3~10%"
);

console.log(
  "TRAIN:",
  TRAIN_START,
  "~",
  TRAIN_END
);

console.log(
  "VALID:",
  VALID_START,
  "+"
);

console.log(
  "============================================================"
);

const tested =
  PARTNER_RULES.map(
    rule => ({
      rule,
      train:
        evaluate(
          train,
          rule
        )
    })
  );

const ranked =
  [...tested]
    .sort(
      (a,b) => {
        const sa =
          a.train.roi +
          a.train.hitRate*0.35 +
          Math.min(
            25,
            a.train.bets
          )*0.30 -
          a.train.MDD*0.20 -
          a.train.negativeMonths*2;

        const sb =
          b.train.roi +
          b.train.hitRate*0.35 +
          Math.min(
            25,
            b.train.bets
          )*0.30 -
          b.train.MDD*0.20 -
          b.train.negativeMonths*2;

        return sb-sa;
      }
    );

console.log();
console.log(
  "===== ALL TRAIN RANKING ====="
);

console.table(
  ranked.map(
    (x,rank) => ({
      rank:rank+1,
      partner:
        x.rule.name,
      bets:
        x.train.bets,
      wins:
        x.train.wins,
      losses:
        x.train.losses,
      hit:
        x.train.hitRate,
      avgOdds:
        x.train.avgOdds,
      profit:
        x.train.profit,
      roi:
        x.train.roi,
      MDD:
        x.train.MDD,
      lose:
        x.train.maxLoseStreak,
      same:
        x.train.sameGame,
      diff:
        x.train.differentGame,
      negM:
        x.train.negativeMonths
    })
  )
);

const trainQualified =
  ranked.filter(
    x =>
      x.train.bets >= 6 &&
      x.train.roi > 0
  );

console.log();
console.log(
  "TRAIN QUALIFIED:",
  trainQualified.length
);

const frozen =
  trainQualified.map(
    x => ({
      ...x,
      valid:
        evaluate(
          valid,
          x.rule
        )
    })
  );

console.log();
console.log(
  "===== TRAIN QUALIFIED -> VALID FROZEN ====="
);

console.table(
  frozen.map(
    (x,rank) => ({
      rank:rank+1,
      partner:
        x.rule.name,

      TBets:
        x.train.bets,
      THit:
        x.train.hitRate,
      TOdds:
        x.train.avgOdds,
      TROI:
        x.train.roi,
      TProfit:
        x.train.profit,

      VBets:
        x.valid.bets,
      VHit:
        x.valid.hitRate,
      VOdds:
        x.valid.avgOdds,
      VROI:
        x.valid.roi,
      VProfit:
        x.valid.profit,

      TMDD:
        x.train.MDD,
      VMDD:
        x.valid.MDD
    })
  )
);

const robust =
  frozen
    .filter(
      x =>
        x.valid.bets >= 5 &&
        x.valid.roi > 0
    )
    .sort(
      (a,b) =>
        Math.min(
          b.train.roi,
          b.valid.roi
        ) -
        Math.min(
          a.train.roi,
          a.valid.roi
        )
    );

console.log();
console.log(
  "===== ROBUST ====="
);

console.table(
  robust.map(
    (x,rank) => ({
      rank:rank+1,
      partner:
        x.rule.name,

      TBets:
        x.train.bets,
      THit:
        x.train.hitRate,
      TROI:
        x.train.roi,

      VBets:
        x.valid.bets,
      VHit:
        x.valid.hitRate,
      VROI:
        x.valid.roi,

      avgOdds:
        +(
          (
            x.train.avgOdds +
            x.valid.avgOdds
          )/2
        ).toFixed(3),

      TMDD:
        x.train.MDD,
      VMDD:
        x.valid.MDD,

      TNeg:
        x.train.negativeMonths,
      VNeg:
        x.valid.negativeMonths
    })
  )
);

if (robust[0]) {
  const best =
    robust[0];

  console.log();
  console.log(
    "===== BEST ROBUST DETAIL ====="
  );

  console.log(
    "PARTNER:",
    best.rule.name
  );

  console.log(
    "TRAIN PAIRS:",
    best.train.pairTypes
  );

  console.log(
    "VALID PAIRS:",
    best.valid.pairTypes
  );

  console.log();

  console.log(
    "TRAIN MONTHLY"
  );

  console.table(
    best.train.monthly
  );

  console.log(
    "VALID MONTHLY"
  );

  console.table(
    best.valid.monthly
  );

  console.log();

  console.log(
    "===== SAMPLE VALID TICKETS ====="
  );

  console.table(
    best.valid.tickets
      .slice(0,20)
      .map(t => ({
        date:
          t.date,

        A:
          `${t.a.market}:${t.a.label}`,

        Aodds:
          t.a.odds,

        B:
          `${t.b.market}:${t.b.label}`,

        Bodds:
          t.b.odds,

        comboOdds:
          +t.odds.toFixed(3),

        sameGame:
          t.sameGame,

        result:
          ticketResult(t).result
      }))
  );
}

fs.writeFileSync(
  "data/kbo-a2-anchor-partner-v16.json",
  JSON.stringify(
    {
      generatedAt:
        new Date().toISOString(),

      anchor:
        "TOTAL OVER EV 3~10%",

      trainPeriod: {
        start:
          TRAIN_START,
        end:
          TRAIN_END
      },

      validStart:
        VALID_START,

      trainRanking:
        ranked.map(
          x => ({
            rule:
              x.rule.name,
            result:
              x.train
          })
        ),

      frozen:
        frozen.map(
          x => ({
            rule:
              x.rule.name,
            train:
              x.train,
            valid:
              x.valid
          })
        ),

      robust:
        robust.map(
          x => ({
            rule:
              x.rule.name,
            train:
              x.train,
            valid:
              x.valid
          })
        )
    },
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-a2-anchor-partner-v16.json"
);

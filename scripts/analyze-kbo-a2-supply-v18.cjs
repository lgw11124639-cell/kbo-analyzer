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
      ["WIN","LOSS","VOID"].includes(x.result) &&
      Number.isFinite(Number(x.odds)) &&
      Number(x.odds) > 1 &&
      Number.isFinite(Number(x.ev)) &&
      Number.isFinite(Number(x.confidence))
    )
    .map(x => ({
      ...x,
      odds:Number(x.odds),
      ev:Number(x.ev),
      confidence:Number(x.confidence),
    }));

const DISC_START = "2026-03-28";
const DISC_END   = "2026-04-30";

const INTERNAL_START = "2026-05-01";
const INTERNAL_END   = "2026-06-30";

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

function labelOf(x) {
  return String(
    x.label ?? x.side ?? ""
  ).toUpperCase();
}

function isOver(x) {
  const label = labelOf(x);

  return (
    x.market === "TOTAL" &&
    (
      label.includes("OVER") ||
      label.includes("오버")
    )
  );
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
        30,
        evOf(x) ?? -30
      )
    );

  const conf =
    confOf(x) ?? 0;

  return (
    conf * 0.95 +
    ev * 0.85 +
    gradeValue(x) * 2 +
    Math.log(
      Math.max(
        1.01,
        x.odds
      )
    ) * 3
  );
}

/*
  실제 조합 생성 규칙과 동일한 방향.

  같은 경기:
  - TOTAL + ML 허용
  - TOTAL + HANDICAP 허용
  - ML + HANDICAP 불가
  - 같은 market 불가
*/
function canPair(a,b) {
  if (
    pickKey(a) === pickKey(b)
  ) {
    return false;
  }

  if (
    String(a.gameId) !==
    String(b.gameId)
  ) {
    return true;
  }

  if (
    a.market === b.market
  ) {
    return false;
  }

  const aSide =
    a.market === "ML" ||
    a.market === "HANDICAP";

  const bSide =
    b.market === "ML" ||
    b.market === "HANDICAP";

  if (
    aSide &&
    bSide
  ) {
    return false;
  }

  return true;
}

/*
  V1.8 고정 구조

  A:
  TOTAL OVER
  EV 0~10%

  B:
  ML
  confidence >= 50%

  여기서 조건 튜닝하지 않는다.
*/
function isOverAnchor(x) {
  const ev = evOf(x);

  return (
    isOver(x) &&
    ev !== null &&
    ev >= 0 &&
    ev < 10
  );
}

function isMlPartner(x) {
  const conf =
    confOf(x);

  return (
    x.market === "ML" &&
    conf !== null &&
    conf >= 50
  );
}

function groupByDate(source) {
  const map =
    new Map();

  for (const x of source) {
    if (!map.has(x.date)) {
      map.set(
        x.date,
        []
      );
    }

    map.get(x.date)
      .push(x);
  }

  return [...map.entries()]
    .sort(
      (a,b) =>
        a[0].localeCompare(b[0])
    );
}

function buildCandidates(dayRows) {
  const anchors =
    dayRows.filter(isOverAnchor);

  const partners =
    dayRows.filter(isMlPartner);

  const combos = [];

  for (const a of anchors) {
    for (const b of partners) {

      if (!canPair(a,b)) {
        continue;
      }

      const odds =
        a.odds *
        b.odds;

      /*
        A 기본 티켓이므로
        배당 범위를 너무 넓히지 않는다.
      */
      if (
        odds < 2.00 ||
        odds > 3.50
      ) {
        continue;
      }

      const sameGame =
        String(a.gameId) ===
        String(b.gameId);

      const avgEv =
        (
          (evOf(a) ?? 0) +
          (evOf(b) ?? 0)
        ) / 2;

      const avgConf =
        (
          (confOf(a) ?? 0) +
          (confOf(b) ?? 0)
        ) / 2;

      /*
        하루 후보가 여러 개면
        과도하게 고배당을 쫓지 않고
        confidence + EV 중심.
      */
      const score =
        pickScore(a) +
        pickScore(b) +
        avgConf * 0.12 +
        avgEv * 0.20 -
        Math.abs(
          odds - 2.75
        ) * 2.5 -
        (
          sameGame
            ? 1
            : 0
        );

      combos.push({
        a,
        b,
        odds,
        avgEv,
        avgConf,
        sameGame,
        score
      });
    }
  }

  combos.sort(
    (a,b) =>
      b.score -
      a.score
  );

  return combos;
}

function settle(t) {
  if (
    t.a.result === "LOSS" ||
    t.b.result === "LOSS"
  ) {
    return {
      result:"LOSS",
      effectiveOdds:0
    };
  }

  const effectiveOdds =
    (
      t.a.result === "VOID"
        ? 1
        : t.a.odds
    ) *
    (
      t.b.result === "VOID"
        ? 1
        : t.b.odds
    );

  if (
    t.a.result === "VOID" &&
    t.b.result === "VOID"
  ) {
    return {
      result:"VOID",
      effectiveOdds:1
    };
  }

  return {
    result:"WIN",
    effectiveOdds
  };
}

function evaluate(source) {
  const byDate =
    groupByDate(source);

  const tickets = [];

  const supply = {
    gameDays:
      byDate.length,

    anchorDays:0,
    partnerDays:0,
    compatibleDays:0,

    days1Candidate:0,
    days2Candidates:0,
    days3Candidates:0,

    totalCandidates:0
  };

  for (
    const [date,dayRows]
    of byDate
  ) {
    const anchors =
      dayRows.filter(
        isOverAnchor
      );

    const partners =
      dayRows.filter(
        isMlPartner
      );

    if (anchors.length) {
      supply.anchorDays++;
    }

    if (partners.length) {
      supply.partnerDays++;
    }

    const candidates =
      buildCandidates(
        dayRows
      );

    if (
      candidates.length
    ) {
      supply.compatibleDays++;
    }

    if (
      candidates.length >= 1
    ) {
      supply.days1Candidate++;
    }

    if (
      candidates.length >= 2
    ) {
      supply.days2Candidates++;
    }

    if (
      candidates.length >= 3
    ) {
      supply.days3Candidates++;
    }

    supply.totalCandidates +=
      candidates.length;

    if (!candidates.length) {
      continue;
    }

    tickets.push({
      date,
      ...candidates[0]
    });
  }

  supply.avgCandidatesPerActiveDay =
    supply.compatibleDays
      ? +(
          supply.totalCandidates /
          supply.compatibleDays
        ).toFixed(2)
      : 0;

  let wins = 0;
  let losses = 0;
  let voids = 0;

  let invested = 0;
  let returned = 0;

  let sameGame = 0;
  let diffGame = 0;

  let oddsSum = 0;

  let bankroll =
    START_BANKROLL;

  let peak =
    bankroll;

  let maxDD = 0;

  let losingStreak = 0;
  let maxLosingStreak = 0;

  const monthly =
    new Map();

  for (const t of tickets) {
    const r =
      settle(t);

    invested +=
      STAKE;

    oddsSum +=
      t.odds;

    if (
      t.sameGame
    ) {
      sameGame++;
    } else {
      diffGame++;
    }

    let ret = 0;

    if (
      r.result === "WIN"
    ) {
      wins++;

      ret =
        STAKE *
        r.effectiveOdds;

      losingStreak = 0;
    }

    else if (
      r.result === "VOID"
    ) {
      voids++;
      ret = STAKE;

      losingStreak = 0;
    }

    else {
      losses++;
      losingStreak++;

      maxLosingStreak =
        Math.max(
          maxLosingStreak,
          losingStreak
        );
    }

    returned +=
      ret;

    const pnl =
      ret -
      STAKE;

    bankroll +=
      pnl;

    if (
      bankroll >
      peak
    ) {
      peak =
        bankroll;
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
      t.date.slice(
        0,
        7
      );

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

    m.invested +=
      STAKE;

    m.returned +=
      ret;

    if (
      r.result === "WIN"
    ) {
      m.wins++;
    }

    if (
      r.result === "LOSS"
    ) {
      m.losses++;
    }

    if (
      r.result === "VOID"
    ) {
      m.voids++;
    }
  }

  const settled =
    wins +
    losses;

  const profit =
    returned -
    invested;

  const monthlyRows =
    [...monthly.values()]
      .map(x => {
        const profit =
          x.returned -
          x.invested;

        return {
          ...x,

          hitRate:
            (
              x.wins +
              x.losses
            )
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
            Math.round(
              profit
            ),

          roi:
            x.invested
              ? +(
                  profit /
                  x.invested *
                  100
                ).toFixed(2)
              : 0
        };
      });

  return {
    supply,

    bets:
      tickets.length,

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
      Math.round(
        invested
      ),

    returned:
      Math.round(
        returned
      ),

    profit:
      Math.round(
        profit
      ),

    roi:
      invested
        ? +(
            profit /
            invested *
            100
          ).toFixed(2)
        : 0,

    finalBankroll:
      Math.round(
        bankroll
      ),

    MDD:
      +maxDD.toFixed(2),

    maxLosingStreak,

    sameGame,
    diffGame,

    negativeMonths:
      monthlyRows.filter(
        x =>
          x.profit < 0
      ).length,

    monthly:
      monthlyRows,

    tickets
  };
}

const discoveryRows =
  rows.filter(
    x =>
      x.date >= DISC_START &&
      x.date <= DISC_END
  );

const internalRows =
  rows.filter(
    x =>
      x.date >= INTERNAL_START &&
      x.date <= INTERNAL_END
  );

const discovery =
  evaluate(
    discoveryRows
  );

const internal =
  evaluate(
    internalRows
  );

console.log(
  "============================================================"
);

console.log(
  "KBO A2 SUPPLY EXPANSION V1.8"
);

console.log(
  "STRUCTURE: TOTAL OVER EV 0~10% + ML CONF >= 50%"
);

console.log(
  "COMBO ODDS: 2.00 ~ 3.50"
);

console.log(
  "FINAL 07~09: LOCKED / NOT TESTED"
);

console.log(
  "============================================================"
);

console.log();
console.log(
  "===== DISCOVERY SUPPLY 03~04 ====="
);

console.table([
  discovery.supply
]);

console.log();
console.log(
  "===== INTERNAL SUPPLY 05~06 ====="
);

console.table([
  internal.supply
]);

console.log();
console.log(
  "===== PERFORMANCE ====="
);

console.table([
  {
    period:"DISCOVERY 03~04",

    bets:
      discovery.bets,

    wins:
      discovery.wins,

    losses:
      discovery.losses,

    hit:
      discovery.hitRate,

    avgOdds:
      discovery.avgOdds,

    profit:
      discovery.profit,

    roi:
      discovery.roi,

    final:
      discovery.finalBankroll,

    MDD:
      discovery.MDD,

    lose:
      discovery.maxLosingStreak,

    same:
      discovery.sameGame,

    diff:
      discovery.diffGame,

    negM:
      discovery.negativeMonths
  },

  {
    period:"INTERNAL 05~06",

    bets:
      internal.bets,

    wins:
      internal.wins,

    losses:
      internal.losses,

    hit:
      internal.hitRate,

    avgOdds:
      internal.avgOdds,

    profit:
      internal.profit,

    roi:
      internal.roi,

    final:
      internal.finalBankroll,

    MDD:
      internal.MDD,

    lose:
      internal.maxLosingStreak,

    same:
      internal.sameGame,

    diff:
      internal.diffGame,

    negM:
      internal.negativeMonths
  }
]);

console.log();
console.log(
  "===== DISCOVERY MONTHLY ====="
);

console.table(
  discovery.monthly
);

console.log();
console.log(
  "===== INTERNAL MONTHLY ====="
);

console.table(
  internal.monthly
);

/*
  사전에 정한 통과 조건.

  두 기간 각각:
  - 최소 6 bets
  - ROI > 0

  이걸 만족해야만
  다음 버전에서 07~09를 딱 한 번 연다.
*/
const passed =
  discovery.bets >= 6 &&
  internal.bets >= 6 &&
  discovery.roi > 0 &&
  internal.roi > 0;

console.log();
console.log(
  "============================================================"
);

console.log(
  "V1.8 PASS:",
  passed
    ? "YES"
    : "NO"
);

console.log(
  "DISCOVERY BETS:",
  discovery.bets,
  "/ ROI:",
  discovery.roi
);

console.log(
  "INTERNAL BETS:",
  internal.bets,
  "/ ROI:",
  internal.roi
);

console.log(
  "============================================================"
);

console.log();
console.log(
  "===== DISCOVERY TICKETS ====="
);

console.table(
  discovery.tickets.map(
    t => {
      const r =
        settle(t);

      return {
        date:t.date,

        OVER:
          `${t.a.label}`,

        overOdds:
          t.a.odds,

        overEV:
          +(
            evOf(t.a) ?? 0
          ).toFixed(2),

        ML:
          `${t.b.label}`,

        mlOdds:
          t.b.odds,

        mlConf:
          +(
            confOf(t.b) ?? 0
          ).toFixed(2),

        combo:
          +t.odds.toFixed(3),

        same:
          t.sameGame,

        result:
          r.result
      };
    }
  )
);

console.log();
console.log(
  "===== INTERNAL TICKETS ====="
);

console.table(
  internal.tickets.map(
    t => {
      const r =
        settle(t);

      return {
        date:t.date,

        OVER:
          `${t.a.label}`,

        overOdds:
          t.a.odds,

        overEV:
          +(
            evOf(t.a) ?? 0
          ).toFixed(2),

        ML:
          `${t.b.label}`,

        mlOdds:
          t.b.odds,

        mlConf:
          +(
            confOf(t.b) ?? 0
          ).toFixed(2),

        combo:
          +t.odds.toFixed(3),

        same:
          t.sameGame,

        result:
          r.result
      };
    }
  )
);

fs.writeFileSync(
  "data/kbo-a2-supply-v18.json",
  JSON.stringify(
    {
      generatedAt:
        new Date()
          .toISOString(),

      structure:{
        anchor:
          "TOTAL OVER EV 0~10%",
        partner:
          "ML CONF >= 50%",
        comboOdds:[
          2.00,
          3.50
        ]
      },

      periods:{
        discovery:[
          DISC_START,
          DISC_END
        ],

        internal:[
          INTERNAL_START,
          INTERNAL_END
        ],

        final:
          "LOCKED"
      },

      passed,

      discovery,

      internal
    },
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-a2-supply-v18.json"
);

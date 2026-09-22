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
  const s = labelOf(x);

  return (
    x.market === "TOTAL" &&
    (
      s.includes("OVER") ||
      s.includes("오버")
    )
  );
}

function gradeValue(x) {
  const g =
    String(x.grade || "")
      .toUpperCase();

  if (g === "A") return 3;
  if (g === "B") return 2;
  return 1;
}

function pickKey(x) {
  return `${x.gameId}:${x.market}:${x.label}`;
}

/*
  실제 production 동일 방향:
  같은 경기 최대 2픽
  동일 market 불가
  ML + HANDICAP 불가
  TOTAL + ML 허용
  TOTAL + HANDICAP 허용
*/
function canPair(a,b) {
  if (
    pickKey(a) ===
    pickKey(b)
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

/*
  ==========================================
  후보 진입 조건
  ==========================================

  기존 양수 신호 영역 중심.
  너무 넓게 안 잡는다.
*/
function eligible(x) {
  const ev =
    evOf(x);

  const conf =
    confOf(x);

  if (
    ev === null ||
    conf === null
  ) {
    return false;
  }

  /*
    1) TOTAL OVER EV3~10
  */
  if (
    isOver(x) &&
    ev >= 3 &&
    ev < 10
  ) {
    return true;
  }

  /*
    2) HANDICAP EV3~10
  */
  if (
    x.market === "HANDICAP" &&
    ev >= 3 &&
    ev < 10
  ) {
    return true;
  }

  /*
    3) EV 3~5 전체
  */
  if (
    ev >= 3 &&
    ev < 5
  ) {
    return true;
  }

  /*
    4) EV 5~10 전체
  */
  if (
    ev >= 5 &&
    ev < 10
  ) {
    return true;
  }

  /*
    5) 높은 신뢰도 ML
  */
  if (
    x.market === "ML" &&
    conf >= 55 &&
    ev >= 0 &&
    ev < 10
  ) {
    return true;
  }

  return false;
}

/*
  ==========================================
  픽 점수
  ==========================================

  "고배당 우선"이 아니라
  안정성 + EV + 기존 신호에 가산점.
*/
function pickScore(x) {
  const ev =
    evOf(x) ?? -30;

  const conf =
    confOf(x) ?? 0;

  let score =
    conf * 0.95 +
    ev * 1.15 +
    gradeValue(x) * 2;

  /*
    TOTAL OVER EV3~10
  */
  if (
    isOver(x) &&
    ev >= 3 &&
    ev < 10
  ) {
    score += 6;
  }

  /*
    HANDICAP EV3~10
  */
  if (
    x.market === "HANDICAP" &&
    ev >= 3 &&
    ev < 10
  ) {
    score += 5;
  }

  /*
    EV3~5 안정 신호
  */
  if (
    ev >= 3 &&
    ev < 5
  ) {
    score += 4;
  }

  /*
    EV5~10
  */
  if (
    ev >= 5 &&
    ev < 10
  ) {
    score += 3;
  }

  /*
    ML 신뢰도 55+
  */
  if (
    x.market === "ML" &&
    conf >= 55
  ) {
    score += 4;
  }

  /*
    너무 높은 개별 배당 감점
  */
  if (
    x.odds >= 2.50
  ) {
    score -= 4;
  }

  if (
    x.odds >= 3.00
  ) {
    score -= 5;
  }

  return score;
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

/*
  ==========================================
  하루 2폴 후보 생성
  ==========================================
*/
function buildCandidates(dayRows) {
  const pool =
    dayRows
      .filter(eligible)
      .sort(
        (a,b) =>
          pickScore(b) -
          pickScore(a)
      );

  const combos = [];

  for (
    let i=0;
    i<pool.length;
    i++
  ) {
    for (
      let j=i+1;
      j<pool.length;
      j++
    ) {
      const a =
        pool[i];

      const b =
        pool[j];

      if (!canPair(a,b)) {
        continue;
      }

      const odds =
        a.odds *
        b.odds;

      /*
        기본 A 티켓:
        너무 낮거나 너무 높은 조합배당 제외
      */
      if (
        odds < 2.00 ||
        odds > 4.50
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
        2폴 점수:
        개별 픽 강도 우선,
        배당 2.7~3.0 부근 선호,
        같은 경기 약한 감점.
      */
      const score =
        pickScore(a) +
        pickScore(b) +
        avgConf * 0.12 +
        avgEv * 0.20 -
        Math.abs(
          odds - 2.80
        ) * 2.2 -
        (
          sameGame
            ? 1.5
            : 0
        );

      combos.push({
        a,
        b,
        odds,
        sameGame,
        avgEv,
        avgConf,
        score
      });
    }
  }

  combos.sort(
    (a,b) =>
      b.score -
      a.score
  );

  return {
    pool,
    combos
  };
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

function marketName(x) {
  if (
    x.market === "TOTAL"
  ) {
    return isOver(x)
      ? "OVER"
      : "TOTAL";
  }

  if (
    x.market === "HANDICAP"
  ) {
    return "HANDI";
  }

  if (
    x.market === "ML"
  ) {
    return "ML";
  }

  return x.market;
}

function evaluate(source) {
  const tickets = [];

  const byDate =
    groupByDate(source);

  const supply = {
    gameDays:
      byDate.length,

    eligibleDays:0,
    comboDays:0,

    eligiblePicks:0,
    totalComboCandidates:0,

    days2plusPicks:0,
    days3plusPicks:0,
    days4plusPicks:0,
  };

  for (
    const [date,dayRows]
    of byDate
  ) {
    const {
      pool,
      combos
    } =
      buildCandidates(
        dayRows
      );

    if (
      pool.length >= 1
    ) {
      supply.eligibleDays++;
    }

    if (
      pool.length >= 2
    ) {
      supply.days2plusPicks++;
    }

    if (
      pool.length >= 3
    ) {
      supply.days3plusPicks++;
    }

    if (
      pool.length >= 4
    ) {
      supply.days4plusPicks++;
    }

    supply.eligiblePicks +=
      pool.length;

    supply.totalComboCandidates +=
      combos.length;

    if (!combos.length) {
      continue;
    }

    supply.comboDays++;

    tickets.push({
      date,
      ...combos[0]
    });
  }

  supply.avgEligiblePerActiveDay =
    supply.eligibleDays
      ? +(
          supply.eligiblePicks /
          supply.eligibleDays
        ).toFixed(2)
      : 0;

  supply.avgCombosPerComboDay =
    supply.comboDays
      ? +(
          supply.totalComboCandidates /
          supply.comboDays
        ).toFixed(2)
      : 0;

  let wins = 0;
  let losses = 0;
  let voids = 0;

  let invested = 0;
  let returned = 0;

  let oddsSum = 0;

  let bankroll =
    START_BANKROLL;

  let peak =
    bankroll;

  let maxDD = 0;

  let losingStreak = 0;
  let maxLosingStreak = 0;

  let sameGame = 0;
  let diffGame = 0;

  const marketPairs =
    new Map();

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

    const pair =
      [
        marketName(t.a),
        marketName(t.b)
      ]
        .sort()
        .join("+");

    marketPairs.set(
      pair,
      (
        marketPairs.get(pair) ||
        0
      ) + 1
    );

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
    wins +
    losses;

  const profit =
    returned -
    invested;

  const monthlyRows =
    [...monthly.values()]
      .map(x => {
        const p =
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
      monthlyRows
        .filter(
          x =>
            x.profit < 0
        ).length,

    marketPairs:
      Object.fromEntries(
        [...marketPairs.entries()]
          .sort(
            (a,b) =>
              b[1]-a[1]
          )
      ),

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
  "KBO A2 DAILY BEST-2 V1.9"
);

console.log(
  "DISCOVERY:",
  DISC_START,
  "~",
  DISC_END
);

console.log(
  "INTERNAL:",
  INTERNAL_START,
  "~",
  INTERNAL_END
);

console.log(
  "FINAL 07~09: LOCKED"
);

console.log(
  "============================================================"
);

console.log();
console.log(
  "===== DISCOVERY SUPPLY ====="
);

console.table([
  discovery.supply
]);

console.log();
console.log(
  "===== INTERNAL SUPPLY ====="
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
    period:"DISCOVERY",

    bets:
      discovery.bets,

    wins:
      discovery.wins,

    losses:
      discovery.losses,

    hit:
      discovery.hitRate,

    odds:
      discovery.avgOdds,

    profit:
      discovery.profit,

    roi:
      discovery.roi,

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
    period:"INTERNAL",

    bets:
      internal.bets,

    wins:
      internal.wins,

    losses:
      internal.losses,

    hit:
      internal.hitRate,

    odds:
      internal.avgOdds,

    profit:
      internal.profit,

    roi:
      internal.roi,

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
  "DISCOVERY MARKET PAIRS:",
  discovery.marketPairs
);

console.log(
  "INTERNAL MARKET PAIRS:",
  internal.marketPairs
);

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

const passed =
  discovery.bets >= 8 &&
  internal.bets >= 8 &&
  discovery.roi > 0 &&
  internal.roi > 0;

console.log();
console.log(
  "============================================================"
);

console.log(
  "V1.9 PASS:",
  passed
    ? "YES"
    : "NO"
);

console.log(
  "DISCOVERY:",
  discovery.bets,
  "bets / ROI",
  discovery.roi
);

console.log(
  "INTERNAL:",
  internal.bets,
  "bets / ROI",
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
    t => ({
      date:
        t.date,

      A:
        `${marketName(t.a)}:${t.a.label}`,

      Aodds:
        t.a.odds,

      Aev:
        +(evOf(t.a) ?? 0)
          .toFixed(2),

      Aconf:
        +(confOf(t.a) ?? 0)
          .toFixed(2),

      B:
        `${marketName(t.b)}:${t.b.label}`,

      Bodds:
        t.b.odds,

      Bev:
        +(evOf(t.b) ?? 0)
          .toFixed(2),

      Bconf:
        +(confOf(t.b) ?? 0)
          .toFixed(2),

      combo:
        +t.odds
          .toFixed(3),

      same:
        t.sameGame,

      result:
        settle(t).result
    }))
);

console.log();
console.log(
  "===== INTERNAL TICKETS ====="
);

console.table(
  internal.tickets.map(
    t => ({
      date:
        t.date,

      A:
        `${marketName(t.a)}:${t.a.label}`,

      Aodds:
        t.a.odds,

      Aev:
        +(evOf(t.a) ?? 0)
          .toFixed(2),

      Aconf:
        +(confOf(t.a) ?? 0)
          .toFixed(2),

      B:
        `${marketName(t.b)}:${t.b.label}`,

      Bodds:
        t.b.odds,

      Bev:
        +(evOf(t.b) ?? 0)
          .toFixed(2),

      Bconf:
        +(confOf(t.b) ?? 0)
          .toFixed(2),

      combo:
        +t.odds
          .toFixed(3),

      same:
        t.sameGame,

      result:
        settle(t).result
    }))
);

fs.writeFileSync(
  "data/kbo-a2-best2-v19.json",
  JSON.stringify(
    {
      generatedAt:
        new Date()
          .toISOString(),

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

      structure:
        "daily highest-scoring compatible 2 picks",

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
  "SAVED: data/kbo-a2-best2-v19.json"
);

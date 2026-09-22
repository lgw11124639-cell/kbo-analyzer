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

const FINAL_START = "2026-07-01";

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

function isUnder(x) {
  const s = labelOf(x);

  return (
    x.market === "TOTAL" &&
    (
      s.includes("UNDER") ||
      s.includes("언더")
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

function basePickScore(x) {
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
    conf * 0.90 +
    ev * 1.10 +
    gradeValue(x) * 2 +
    Math.log(
      Math.max(1.01, x.odds)
    ) * 3
  );
}

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

function settleCombo(a,b) {
  if (
    a.result === "LOSS" ||
    b.result === "LOSS"
  ) {
    return {
      result:"LOSS",
      effectiveOdds:0
    };
  }

  const effectiveOdds =
    (
      a.result === "VOID"
        ? 1
        : a.odds
    ) *
    (
      b.result === "VOID"
        ? 1
        : b.odds
    );

  if (
    a.result === "VOID" &&
    b.result === "VOID"
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

function evBetween(
  x,
  min,
  max
) {
  const ev = evOf(x);

  return (
    ev !== null &&
    ev >= min &&
    ev < max
  );
}

function confAtLeast(
  x,
  min
) {
  const c = confOf(x);

  return (
    c !== null &&
    c >= min
  );
}

/*
  =====================================================
  역할군
  =====================================================

  너무 많은 조합을 무작정 탐색하지 않고
  기존 백테스트에서 의미 있었던 영역 중심.
*/
const PICK_TYPES = {

  OVER_EV3_10: x =>
    isOver(x) &&
    evBetween(x,3,10),

  OVER_EV0_10: x =>
    isOver(x) &&
    evBetween(x,0,10),

  UNDER_EV3_10: x =>
    isUnder(x) &&
    evBetween(x,3,10),

  ML_EV3_10: x =>
    x.market === "ML" &&
    evBetween(x,3,10),

  ML_EV0_10: x =>
    x.market === "ML" &&
    evBetween(x,0,10),

  ML_CONF50: x =>
    x.market === "ML" &&
    confAtLeast(x,50),

  ML_CONF55: x =>
    x.market === "ML" &&
    confAtLeast(x,55),

  HANDI_EV3_10: x =>
    x.market === "HANDICAP" &&
    evBetween(x,3,10),

  HANDI_EV0_10: x =>
    x.market === "HANDICAP" &&
    evBetween(x,0,10),

  HANDI_ODDS250: x =>
    x.market === "HANDICAP" &&
    x.odds >= 2.50,

  ANY_EV3_5: x =>
    evBetween(x,3,5),

  ANY_EV5_10: x =>
    evBetween(x,5,10),

  ANY_EV3_10: x =>
    evBetween(x,3,10),

  CONF55: x =>
    confAtLeast(x,55),

  CONF60: x =>
    confAtLeast(x,60),
};

/*
  =====================================================
  사전 정의 Pair Matrix
  =====================================================

  좌우 조건을 다르게 준다.
*/
const PAIR_RULES = [

  ["OVER_EV3_10", "ML_EV3_10"],
  ["OVER_EV3_10", "ML_EV0_10"],
  ["OVER_EV3_10", "ML_CONF50"],
  ["OVER_EV3_10", "ML_CONF55"],

  ["OVER_EV3_10", "HANDI_EV3_10"],
  ["OVER_EV3_10", "HANDI_EV0_10"],
  ["OVER_EV3_10", "HANDI_ODDS250"],

  ["OVER_EV3_10", "OVER_EV3_10"],
  ["OVER_EV0_10", "OVER_EV3_10"],

  ["ML_EV3_10", "ML_EV3_10"],
  ["ML_EV0_10", "ML_EV3_10"],
  ["ML_CONF50", "ML_CONF50"],

  ["HANDI_EV3_10", "HANDI_EV3_10"],
  ["HANDI_EV0_10", "HANDI_EV3_10"],

  ["ML_EV3_10", "HANDI_EV3_10"],
  ["ML_EV0_10", "HANDI_EV3_10"],
  ["ML_CONF50", "HANDI_EV3_10"],

  ["ANY_EV3_5", "ANY_EV3_5"],
  ["ANY_EV3_5", "ANY_EV5_10"],
  ["ANY_EV5_10", "ANY_EV5_10"],

  ["OVER_EV3_10", "ANY_EV3_5"],
  ["OVER_EV3_10", "ANY_EV5_10"],

  ["CONF55", "ANY_EV3_10"],
  ["CONF60", "ANY_EV3_10"],
];

/*
  같은 의미의 A+B, B+A 중복 제거.
*/
const UNIQUE_RULES = [];

const seenRuleKeys =
  new Set();

for (const [left,right] of PAIR_RULES) {
  const key =
    [left,right]
      .sort()
      .join("|");

  if (seenRuleKeys.has(key)) {
    continue;
  }

  seenRuleKeys.add(key);

  UNIQUE_RULES.push({
    name:`${left} + ${right}`,
    left,
    right
  });
}

function makeCandidates(
  dayRows,
  rule
) {
  const leftRows =
    dayRows
      .filter(
        PICK_TYPES[rule.left]
      );

  const rightRows =
    dayRows
      .filter(
        PICK_TYPES[rule.right]
      );

  const combos = [];

  for (const a of leftRows) {
    for (const b of rightRows) {

      if (!canPair(a,b)) {
        continue;
      }

      /*
        동일 규칙일 때 순서 중복 제거
      */
      if (
        rule.left === rule.right &&
        pickKey(a) >= pickKey(b)
      ) {
        continue;
      }

      const odds =
        a.odds * b.odds;

      /*
        A 기본 티켓 용도.
        너무 고배당은 배제.
      */
      if (
        odds < 2.00 ||
        odds > 5.50
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
        하루에 하나만 선택할 때
        생산 로직과 너무 동떨어지지 않게
        확률/EV/등급/배당을 섞는다.
      */
      const score =
        basePickScore(a) +
        basePickScore(b) +
        avgEv * 0.25 +
        avgConf * 0.10 -
        Math.abs(
          odds - 3.00
        ) * 2.0 -
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
      b.score - a.score
  );

  return combos;
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
    const candidates =
      makeCandidates(
        dayRows,
        rule
      );

    if (!candidates.length) {
      continue;
    }

    tickets.push({
      date,
      ...candidates[0]
    });
  }

  let wins = 0;
  let losses = 0;
  let voids = 0;

  let invested = 0;
  let returned = 0;

  let oddsSum = 0;

  let sameGame = 0;
  let diffGame = 0;

  let bankroll =
    START_BANKROLL;

  let peak =
    START_BANKROLL;

  let maxDD = 0;

  let losingStreak = 0;
  let maxLosingStreak = 0;

  const monthly =
    new Map();

  for (const t of tickets) {
    const result =
      settleCombo(
        t.a,
        t.b
      );

    invested += STAKE;
    oddsSum += t.odds;

    if (t.sameGame) {
      sameGame++;
    } else {
      diffGame++;
    }

    let ret = 0;

    if (
      result.result === "WIN"
    ) {
      wins++;

      ret =
        STAKE *
        result.effectiveOdds;

      losingStreak = 0;
    }
    else if (
      result.result === "VOID"
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

    returned += ret;

    const pnl =
      ret -
      STAKE;

    bankroll += pnl;

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
      result.result === "WIN"
    ) m.wins++;

    if (
      result.result === "LOSS"
    ) m.losses++;

    if (
      result.result === "VOID"
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
    bets:tickets.length,
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
    diffGame,

    finalBankroll:
      Math.round(bankroll),

    MDD:
      +maxDD.toFixed(2),

    maxLosingStreak,

    negativeMonths:
      monthRows.filter(
        x => x.profit < 0
      ).length,

    monthly:
      monthRows,

    tickets
  };
}

const discovery =
  rows.filter(
    x =>
      x.date >= DISC_START &&
      x.date <= DISC_END
  );

const internal =
  rows.filter(
    x =>
      x.date >= INTERNAL_START &&
      x.date <= INTERNAL_END
  );

const finalRows =
  rows.filter(
    x =>
      x.date >= FINAL_START
  );

console.log(
  "============================================================"
);

console.log(
  "KBO A2 PAIR MATRIX V1.7"
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
  "FINAL:",
  FINAL_START,
  "+"
);

console.log(
  "RULES:",
  UNIQUE_RULES.length
);

console.log(
  "============================================================"
);

/*
  1차: 03~04월
*/
const discoveryResults =
  UNIQUE_RULES.map(
    rule => ({
      rule,
      discovery:
        evaluate(
          discovery,
          rule
        )
    })
  );

/*
  샘플 너무 작은 것까지
  ROI만 보고 상위로 올라가는 걸 막는다.
*/
const discoveryRanked =
  discoveryResults
    .filter(
      x =>
        x.discovery.bets >= 4
    )
    .sort(
      (a,b) => {
        const da =
          a.discovery;

        const db =
          b.discovery;

        const sa =
          da.roi +
          da.hitRate * 0.35 +
          Math.min(
            15,
            da.bets
          ) * 0.50 -
          da.MDD * 0.30 -
          da.negativeMonths * 2;

        const sb =
          db.roi +
          db.hitRate * 0.35 +
          Math.min(
            15,
            db.bets
          ) * 0.50 -
          db.MDD * 0.30 -
          db.negativeMonths * 2;

        return sb-sa;
      }
    );

console.log();
console.log(
  "===== DISCOVERY RANKING ====="
);

console.table(
  discoveryRanked.map(
    (x,rank) => ({
      rank:rank+1,

      pair:
        x.rule.name,

      bets:
        x.discovery.bets,

      wins:
        x.discovery.wins,

      losses:
        x.discovery.losses,

      hit:
        x.discovery.hitRate,

      avgOdds:
        x.discovery.avgOdds,

      profit:
        x.discovery.profit,

      roi:
        x.discovery.roi,

      MDD:
        x.discovery.MDD,

      lose:
        x.discovery.maxLosingStreak,

      same:
        x.discovery.sameGame,

      diff:
        x.discovery.diffGame
    })
  )
);

/*
  Discovery 통과:
  최소 4회 + ROI 양수.

  여기까지만 보고 다음 기간으로 넘긴다.
*/
const stage1 =
  discoveryRanked.filter(
    x =>
      x.discovery.roi > 0
  );

console.log();
console.log(
  "DISCOVERY QUALIFIED:",
  stage1.length
);

/*
  2차: 05~06월 동결 검증
*/
const stage2 =
  stage1.map(
    x => ({
      ...x,

      internal:
        evaluate(
          internal,
          x.rule
        )
    })
  );

console.log();
console.log(
  "===== DISCOVERY -> INTERNAL FROZEN ====="
);

console.table(
  stage2.map(
    (x,rank) => ({
      rank:rank+1,

      pair:
        x.rule.name,

      DBets:
        x.discovery.bets,

      DHit:
        x.discovery.hitRate,

      DROI:
        x.discovery.roi,

      IBets:
        x.internal.bets,

      IHit:
        x.internal.hitRate,

      IROI:
        x.internal.roi,

      DOdds:
        x.discovery.avgOdds,

      IOdds:
        x.internal.avgOdds,

      DMDD:
        x.discovery.MDD,

      IMDD:
        x.internal.MDD
    })
  )
);

/*
  두 기간 모두 플러스여야
  07~09월을 본다.
*/
const internalPassed =
  stage2.filter(
    x =>
      x.internal.bets >= 4 &&
      x.internal.roi > 0 &&
      x.discovery.roi > 0
  );

console.log();
console.log(
  "INTERNAL PASSED:",
  internalPassed.length
);

/*
  3차: 07~09월 최종 확인.
  여기서 조건 재조정 금지.
*/
const finalists =
  internalPassed.map(
    x => ({
      ...x,

      final:
        evaluate(
          finalRows,
          x.rule
        )
    })
  );

console.log();
console.log(
  "===== FINAL CHECK 07~09 ====="
);

console.table(
  finalists.map(
    (x,rank) => ({
      rank:rank+1,

      pair:
        x.rule.name,

      DBets:
        x.discovery.bets,

      DROI:
        x.discovery.roi,

      IBets:
        x.internal.bets,

      IROI:
        x.internal.roi,

      FBets:
        x.final.bets,

      FHit:
        x.final.hitRate,

      FOdds:
        x.final.avgOdds,

      FROI:
        x.final.roi,

      FProfit:
        x.final.profit,

      FMDD:
        x.final.MDD,

      FLose:
        x.final.maxLosingStreak
    })
  )
);

const robust =
  finalists
    .filter(
      x =>
        x.final.bets >= 5 &&
        x.final.roi > 0
    )
    .sort(
      (a,b) => {
        const aMin =
          Math.min(
            a.discovery.roi,
            a.internal.roi,
            a.final.roi
          );

        const bMin =
          Math.min(
            b.discovery.roi,
            b.internal.roi,
            b.final.roi
          );

        return bMin-aMin;
      }
    );

console.log();
console.log(
  "===== ROBUST 3-STAGE ====="
);

console.table(
  robust.map(
    (x,rank) => ({
      rank:rank+1,

      pair:
        x.rule.name,

      DBets:
        x.discovery.bets,
      DROI:
        x.discovery.roi,

      IBets:
        x.internal.bets,
      IROI:
        x.internal.roi,

      FBets:
        x.final.bets,
      FROI:
        x.final.roi,

      totalBets:
        x.discovery.bets +
        x.internal.bets +
        x.final.bets,

      minROI:
        +Math.min(
          x.discovery.roi,
          x.internal.roi,
          x.final.roi
        ).toFixed(2)
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
    "PAIR:",
    best.rule.name
  );

  console.log();
  console.log(
    "DISCOVERY MONTHLY"
  );

  console.table(
    best.discovery.monthly
  );

  console.log();
  console.log(
    "INTERNAL MONTHLY"
  );

  console.table(
    best.internal.monthly
  );

  console.log();
  console.log(
    "FINAL MONTHLY"
  );

  console.table(
    best.final.monthly
  );

  console.log();
  console.log(
    "===== FINAL TICKETS ====="
  );

  console.table(
    best.final.tickets.map(
      t => {
        const r =
          settleCombo(
            t.a,
            t.b
          );

        return {
          date:t.date,

          A:
            `${t.a.market}:${t.a.label}`,

          AOdds:
            t.a.odds,

          B:
            `${t.b.market}:${t.b.label}`,

          BOdds:
            t.b.odds,

          comboOdds:
            +t.odds.toFixed(3),

          sameGame:
            t.sameGame,

          result:
            r.result
        };
      }
    )
  );
}

fs.writeFileSync(
  "data/kbo-a2-pair-matrix-v17.json",
  JSON.stringify(
    {
      generatedAt:
        new Date().toISOString(),

      periods:{
        discovery:[
          DISC_START,
          DISC_END
        ],

        internal:[
          INTERNAL_START,
          INTERNAL_END
        ],

        final:[
          FINAL_START,
          null
        ]
      },

      rules:
        UNIQUE_RULES.map(
          x => x.name
        ),

      discoveryRanking:
        discoveryRanked.map(
          x => ({
            rule:x.rule.name,
            discovery:x.discovery
          })
        ),

      internal:
        stage2.map(
          x => ({
            rule:x.rule.name,
            discovery:x.discovery,
            internal:x.internal
          })
        ),

      finalists:
        finalists.map(
          x => ({
            rule:x.rule.name,
            discovery:x.discovery,
            internal:x.internal,
            final:x.final
          })
        ),

      robust:
        robust.map(
          x => ({
            rule:x.rule.name,
            discovery:x.discovery,
            internal:x.internal,
            final:x.final
          })
        )
    },
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-a2-pair-matrix-v17.json"
);

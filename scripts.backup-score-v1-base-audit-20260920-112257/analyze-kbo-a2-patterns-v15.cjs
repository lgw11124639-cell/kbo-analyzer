const fs = require("fs");

const INPUT =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw =
  JSON.parse(
    fs.readFileSync(INPUT,"utf8")
  );

const rows =
  (raw.results || raw)
    .filter(x =>
      ["WIN","LOSS","VOID"].includes(x.result) &&
      Number.isFinite(Number(x.odds)) &&
      Number(x.odds) > 1 &&
      Number.isFinite(Number(x.confidence)) &&
      Number.isFinite(Number(x.ev))
    )
    .map(x => ({
      ...x,
      odds:Number(x.odds),
      confidence:Number(x.confidence),
      ev:Number(x.ev),
    }));

const TRAIN_START = "2026-03-28";
const TRAIN_END   = "2026-06-30";
const VALID_START = "2026-07-01";

const STAKE = 10000;

/*
  너무 넓게 무작정 찾지 않고
  지금까지 신호가 있었던 범위를 중심으로 탐색.
*/
const EV_RANGES = [
  [0.00,0.10],
  [0.02,0.10],
  [0.03,0.10],
  [0.03,0.08],
  [0.04,0.10],
  [0.05,0.10],
];

const CONF_MINS = [
  0.40,
  0.45,
  0.50,
  0.55,
];

const ODDS_RANGES = [
  [1.20,1.80],
  [1.20,2.00],
  [1.30,2.00],
  [1.40,2.10],
  [1.50,2.20],
  [1.60,2.30],
];

const MARKET_GROUPS = [
  {
    name:"ALL",
    test:x => true
  },
  {
    name:"TOTAL_OVER",
    test:x =>
      x.market === "TOTAL" &&
      String(x.label || "")
        .toUpperCase()
        .includes("OVER")
  },
  {
    name:"HANDICAP",
    test:x =>
      x.market === "HANDICAP"
  },
  {
    name:"ML",
    test:x =>
      x.market === "ML"
  },
  {
    name:"OVER_OR_HANDICAP",
    test:x =>
      (
        x.market === "HANDICAP"
      ) ||
      (
        x.market === "TOTAL" &&
        String(x.label || "")
          .toUpperCase()
          .includes("OVER")
      )
  }
];

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
      -0.30,
      Math.min(0.35,x.ev)
    );

  return (
    x.confidence*0.72 +
    ev*0.18 +
    gradeValue(x)*0.035
  );
}

function pickKey(x) {
  return `${x.gameId}:${x.market}:${x.label}`;
}

/*
  현재 analyzer 동일경기 규칙.
*/
function canAdd(a,b) {
  if (a.gameId !== b.gameId) {
    return true;
  }

  if (a.market === b.market) {
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
      map.set(x.date,[]);
    }

    map.get(x.date).push(x);
  }

  return [...map.entries()]
    .sort(
      (a,b) =>
        a[0].localeCompare(b[0])
    );
}

function comboResult(A) {
  if (
    A.some(
      x => x.result === "LOSS"
    )
  ) {
    return {
      win:false,
      odds:0
    };
  }

  const odds =
    A.reduce(
      (v,x) =>
        v *
        (
          x.result === "VOID"
            ? 1
            : x.odds
        ),
      1
    );

  return {
    win:true,
    odds
  };
}

function buildDailyA(
  dayRows,
  rule
) {
  /*
    경기별 상위 3개 시장만 유지.
  */
  const filtered =
    dayRows
      .filter(x =>
        x.ev >= rule.evMin &&
        x.ev <= rule.evMax &&
        x.confidence >= rule.confMin &&
        x.odds >= rule.oddsMin &&
        x.odds <= rule.oddsMax &&
        rule.market.test(x)
      )
      .sort(
        (a,b) =>
          pickScore(b)-pickScore(a)
      );

  const gameCount =
    new Map();

  const pool = [];

  for (const x of filtered) {
    const n =
      gameCount.get(x.gameId) || 0;

    if (n < 3) {
      pool.push(x);
      gameCount.set(
        x.gameId,
        n+1
      );
    }
  }

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
      const a = pool[i];
      const b = pool[j];

      if (!canAdd(a,b)) {
        continue;
      }

      const odds =
        a.odds*b.odds;

      /*
        A는 방어용이므로
        지나친 고배당 2폴 제거.
      */
      if (
        odds < 2.0 ||
        odds > 3.5
      ) {
        continue;
      }

      const probability =
        a.confidence *
        b.confidence;

      const avgConf =
        (a.confidence+b.confidence)/2;

      const avgEv =
        (a.ev+b.ev)/2;

      const score =
        probability*120 +
        avgConf*45 +
        avgEv*12 +
        (
          gradeValue(a) +
          gradeValue(b)
        )*1.5;

      combos.push({
        picks:[a,b],
        odds,
        probability,
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

  return combos[0] || null;
}

function evaluate(
  source,
  rule
) {
  let bets = 0;
  let wins = 0;
  let losses = 0;
  let voids = 0;

  let invested = 0;
  let returned = 0;

  let oddsSum = 0;
  let confSum = 0;
  let evSum = 0;

  let sameGame = 0;
  let differentGame = 0;

  let maxLoseStreak = 0;
  let loseStreak = 0;

  const months =
    new Map();

  const marketPairs =
    new Map();

  for (
    const [date,dayRows]
    of groupByDate(source)
  ) {
    const A =
      buildDailyA(
        dayRows,
        rule
      );

    if (!A) continue;

    bets++;
    invested += STAKE;

    oddsSum += A.odds;
    confSum += A.avgConf;
    evSum += A.avgEv;

    if (
      A.picks[0].gameId ===
      A.picks[1].gameId
    ) {
      sameGame++;
    } else {
      differentGame++;
    }

    const pairName =
      A.picks
        .map(x => {
          if (
            x.market === "TOTAL"
          ) {
            const label =
              String(
                x.label || ""
              ).toUpperCase();

            if (
              label.includes("OVER")
            ) {
              return "OVER";
            }

            if (
              label.includes("UNDER")
            ) {
              return "UNDER";
            }

            return "TOTAL";
          }

          return x.market;
        })
        .sort()
        .join("+");

    marketPairs.set(
      pairName,
      (
        marketPairs.get(pairName) ||
        0
      ) + 1
    );

    const result =
      comboResult(A.picks);

    /*
      두 픽 모두 VOID면 실질 VOID.
      하나 VOID + 하나 WIN은 단폴 적중으로 정산.
    */
    const allVoid =
      A.picks.every(
        x => x.result === "VOID"
      );

    if (allVoid) {
      voids++;
      returned += STAKE;
      loseStreak = 0;
    }
    else if (result.win) {
      wins++;
      returned +=
        STAKE*result.odds;

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

    const month =
      date.slice(0,7);

    if (!months.has(month)) {
      months.set(
        month,
        {
          bets:0,
          invested:0,
          returned:0
        }
      );
    }

    const m =
      months.get(month);

    m.bets++;
    m.invested += STAKE;

    if (allVoid) {
      m.returned += STAKE;
    }
    else if (result.win) {
      m.returned +=
        STAKE*result.odds;
    }
  }

  const profit =
    returned-invested;

  const settled =
    wins+losses;

  const monthly =
    [...months.entries()]
      .map(
        ([month,x]) => {
          const p =
            x.returned -
            x.invested;

          return {
            month,
            bets:x.bets,
            profit:
              Math.round(p),
            roi:
              +(
                p /
                x.invested *
                100
              ).toFixed(2)
          };
        }
      );

  return {
    bets,
    settled,
    wins,
    losses,
    voids,

    hitRate:
      settled
        ? +(
            wins/
            settled*
            100
          ).toFixed(2)
        : 0,

    avgOdds:
      bets
        ? +(oddsSum/bets)
            .toFixed(3)
        : 0,

    avgConf:
      bets
        ? +(confSum/bets)
            .toFixed(4)
        : 0,

    avgEv:
      bets
        ? +(evSum/bets)
            .toFixed(4)
        : 0,

    sameGame,
    differentGame,

    invested:
      Math.round(invested),

    returned:
      Math.round(returned),

    profit:
      Math.round(profit),

    roi:
      invested
        ? +(
            profit/
            invested*
            100
          ).toFixed(2)
        : 0,

    maxLoseStreak,

    negativeMonths:
      monthly.filter(
        x => x.profit < 0
      ).length,

    marketPairs:
      Object.fromEntries(
        [...marketPairs.entries()]
          .sort(
            (a,b) =>
              b[1]-a[1]
          )
      ),

    monthly
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

const rules = [];

for (
  const [evMin,evMax]
  of EV_RANGES
) {
  for (
    const confMin
    of CONF_MINS
  ) {
    for (
      const [oddsMin,oddsMax]
      of ODDS_RANGES
    ) {
      for (
        const market
        of MARKET_GROUPS
      ) {
        rules.push({
          evMin,
          evMax,
          confMin,
          oddsMin,
          oddsMax,
          market
        });
      }
    }
  }
}

console.log(
  "============================================================"
);

console.log(
  "KBO A-2LEG PATTERN SEARCH V1.5"
);

console.log(
  "Rules:",
  rules.length
);

console.log(
  "A combo odds target: 2.00 ~ 3.50"
);

console.log(
  "============================================================"
);

const tested =
  rules.map(
    (rule,index) => {
      const tr =
        evaluate(
          train,
          rule
        );

      return {
        index,
        rule,
        train:tr
      };
    }
  );

/*
  TRAIN 필터:
  최소 15회 이상.
  ROI 양수.
  적중률 45% 이상.

  VALID 결과는 여기서 절대 사용하지 않는다.
*/
const trainQualified =
  tested
    .filter(x =>
      x.train.bets >= 15 &&
      x.train.roi > 0 &&
      x.train.hitRate >= 45
    )
    .sort(
      (a,b) => {
        /*
          표본 + ROI + 적중률 균형.
        */
        const sa =
          a.train.roi +
          a.train.hitRate*0.35 +
          Math.min(
            30,
            a.train.bets
          )*0.25 -
          a.train.negativeMonths*2;

        const sb =
          b.train.roi +
          b.train.hitRate*0.35 +
          Math.min(
            30,
            b.train.bets
          )*0.25 -
          b.train.negativeMonths*2;

        return sb-sa;
      }
    );

/*
  유사 규칙이 수백 개 나올 수 있으므로
  TRAIN 상위 20개만 VALID에 동결 검증.
*/
const finalists =
  trainQualified
    .slice(0,20)
    .map(x => ({
      ...x,
      valid:
        evaluate(
          valid,
          x.rule
        )
    }));

console.log();
console.log(
  "TRAIN QUALIFIED:",
  trainQualified.length
);

console.log();
console.log(
  "===== TOP 20 TRAIN -> VALID FROZEN ====="
);

console.table(
  finalists.map(
    (x,rank) => ({
      rank:rank+1,

      market:
        x.rule.market.name,

      EV:
        `${Math.round(x.rule.evMin*100)}~${Math.round(x.rule.evMax*100)}%`,

      conf:
        `${Math.round(x.rule.confMin*100)}%+`,

      pickOdds:
        `${x.rule.oddsMin.toFixed(1)}~${x.rule.oddsMax.toFixed(1)}`,

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
        x.valid.profit
    })
  )
);

console.log();
console.log(
  "===== ROBUST CANDIDATES ====="
);

/*
  VALID은 최종 확인용.
  여기서는 재튜닝하지 않고
  양쪽 모두 플러스인 규칙만 표시.
*/
const robust =
  finalists
    .filter(x =>
      x.valid.bets >= 8 &&
      x.valid.roi > 0 &&
      x.train.roi > 0
    )
    .sort(
      (a,b) =>
        (
          Math.min(
            b.train.roi,
            b.valid.roi
          )
        ) -
        (
          Math.min(
            a.train.roi,
            a.valid.roi
          )
        )
    );

console.table(
  robust.map(
    (x,rank) => ({
      rank:rank+1,

      market:
        x.rule.market.name,

      EV:
        `${Math.round(x.rule.evMin*100)}~${Math.round(x.rule.evMax*100)}%`,

      conf:
        `${Math.round(x.rule.confMin*100)}%+`,

      pickOdds:
        `${x.rule.oddsMin.toFixed(1)}~${x.rule.oddsMax.toFixed(1)}`,

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

      TNegM:
        x.train.negativeMonths,

      VNegM:
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

  console.log({
    market:
      best.rule.market.name,

    ev:
      [
        best.rule.evMin,
        best.rule.evMax
      ],

    confidenceMin:
      best.rule.confMin,

    pickOdds:
      [
        best.rule.oddsMin,
        best.rule.oddsMax
      ]
  });

  console.log(
    "TRAIN MARKET PAIRS:",
    best.train.marketPairs
  );

  console.log(
    "VALID MARKET PAIRS:",
    best.valid.marketPairs
  );

  console.log(
    "TRAIN MONTHLY:"
  );

  console.table(
    best.train.monthly
  );

  console.log(
    "VALID MONTHLY:"
  );

  console.table(
    best.valid.monthly
  );
}

fs.writeFileSync(
  "data/kbo-a2-patterns-v15.json",
  JSON.stringify(
    {
      generatedAt:
        new Date().toISOString(),

      totalRules:
        rules.length,

      trainQualified:
        trainQualified.length,

      finalists,

      robust
    },
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-a2-patterns-v15.json"
);

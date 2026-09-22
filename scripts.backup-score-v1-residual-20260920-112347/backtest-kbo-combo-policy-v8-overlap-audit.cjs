const fs = require("fs");

const DATA =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const STAKE = 10000;
const START_BANKROLL = 1000000;

const root =
  JSON.parse(
    fs.readFileSync(DATA, "utf8")
  );

const rows =
  Array.isArray(root)
    ? root
    : root.results ?? [];


/* ==================================================
   BASIC
================================================== */

function validNumber(v) {
  return (
    typeof v === "number" &&
    Number.isFinite(v)
  );
}

function resultType(row) {
  const x =
    String(row.result ?? "")
      .trim()
      .toUpperCase();

  if (
    x === "WIN" ||
    x === "WON" ||
    x === "HIT"
  ) {
    return "WIN";
  }

  if (
    x === "LOSS" ||
    x === "LOSE" ||
    x === "LOST"
  ) {
    return "LOSS";
  }

  if (
    x === "PUSH" ||
    x === "VOID" ||
    x === "RETURN" ||
    x === "CANCEL" ||
    x === "CANCELED" ||
    x === "CANCELLED"
  ) {
    return "PUSH";
  }

  return "UNKNOWN";
}

function splitOf(date) {
  const month =
    String(date).slice(0, 7);

  if (
    month === "2026-03" ||
    month === "2026-04"
  ) {
    return "DISCOVERY";
  }

  if (
    month === "2026-05" ||
    month === "2026-06"
  ) {
    return "INTERNAL";
  }

  return "FINAL";
}

function validPick(row) {
  return (
    validNumber(row.odds) &&
    row.odds > 1 &&
    validNumber(row.confidence) &&
    validNumber(row.ev) &&
    resultType(row) !== "UNKNOWN"
  );
}

function gradeValue(grade) {
  if (grade === "A") return 3;
  if (grade === "B") return 2;
  return 1;
}


/* ==================================================
   COMBO RULES
================================================== */

function canAdd(
  selected,
  next
) {
  const sameGame =
    selected.filter(
      p =>
        p.gameId ===
        next.gameId
    );

  if (
    sameGame.length >= 2
  ) {
    return false;
  }

  /*
    같은 경기 같은 시장 금지.
  */
  if (
    sameGame.some(
      p =>
        p.market ===
        next.market
    )
  ) {
    return false;
  }

  /*
    ML + HANDICAP 동시 금지.
  */
  const nextSide =
    next.market === "ML" ||
    next.market === "HANDICAP";

  const hasSide =
    sameGame.some(
      p =>
        p.market === "ML" ||
        p.market === "HANDICAP"
    );

  if (
    nextSide &&
    hasSide
  ) {
    return false;
  }

  return true;
}


/* ==================================================
   COMBO METRICS
================================================== */

function comboProbability(picks) {
  return picks.reduce(
    (v, p) =>
      v * p.confidence,
    1
  );
}

function comboOdds(picks) {
  return picks.reduce(
    (v, p) =>
      v * p.odds,
    1
  );
}

function averageConfidence(picks) {
  return (
    picks.reduce(
      (s, p) =>
        s + p.confidence,
      0
    ) /
    picks.length
  );
}

function averageEv(picks) {
  return (
    picks.reduce(
      (s, p) =>
        s + p.ev,
      0
    ) /
    picks.length
  );
}


/*
  기존 VALUE 점수 유지.
*/
function valueScore(picks) {
  return (
    comboProbability(picks) *
      75 +

    averageConfidence(picks) *
      42 +

    averageEv(picks) *
      30 +

    Math.log(
      Math.max(
        1,
        comboOdds(picks)
      )
    ) *
      5 +

    picks.reduce(
      (sum, p) =>
        sum +
        gradeValue(p.grade),
      0
    )
  );
}

function comboKey(picks) {
  return [...picks]
    .map(
      p =>
        `${p.gameId}:${p.market}:${p.label}`
    )
    .sort()
    .join("|");
}


/* ==================================================
   SETTLEMENT
================================================== */

function settle(picks) {
  const results =
    picks.map(resultType);

  if (
    results.includes("LOSS")
  ) {
    return {
      result: "LOSS",
      payout: 0,
      profit: -STAKE,
    };
  }

  const winners =
    picks.filter(
      p =>
        resultType(p) === "WIN"
    );

  /*
    전부 PUSH
  */
  if (!winners.length) {
    return {
      result: "PUSH",
      payout: STAKE,
      profit: 0,
    };
  }

  /*
    PUSH는 1.00배 처리.
  */
  const effectiveOdds =
    winners.reduce(
      (v, p) =>
        v * p.odds,
      1
    );

  const payout =
    STAKE *
    effectiveOdds;

  return {
    result: "WIN",
    payout,
    profit:
      payout - STAKE,
  };
}


/* ==================================================
   ENUMERATE ALL
================================================== */

function buildAllCombos(
  dateRows,
  legs
) {
  const combos = [];
  const selected = [];

  function visit(index) {
    if (
      selected.length === legs
    ) {
      const picks =
        [...selected];

      combos.push({
        key:
          comboKey(picks),

        picks,

        probability:
          comboProbability(picks),

        odds:
          comboOdds(picks),

        averageConfidence:
          averageConfidence(picks),

        averageEv:
          averageEv(picks),

        value:
          valueScore(picks),
      });

      return;
    }

    if (
      index >=
      dateRows.length
    ) {
      return;
    }

    const needed =
      legs -
      selected.length;

    const remaining =
      dateRows.length -
      index;

    if (
      remaining <
      needed
    ) {
      return;
    }

    const next =
      dateRows[index];

    if (
      canAdd(
        selected,
        next
      )
    ) {
      selected.push(next);

      visit(index + 1);

      selected.pop();
    }

    visit(index + 1);
  }

  visit(0);

  return combos;
}


/* ==================================================
   SELECT 3 PER LEG
================================================== */

function selectThree(combos) {
  if (!combos.length) {
    return [];
  }

  const selected = [];
  const used =
    new Set();


  /*
    1. DEFENSE
    모델 조합 승률 최고
  */
  const defense =
    [...combos]
      .sort(
        (a, b) => {
          if (
            b.probability !==
            a.probability
          ) {
            return (
              b.probability -
              a.probability
            );
          }

          return (
            b.value -
            a.value
          );
        }
      )[0];

  if (defense) {
    used.add(defense.key);

    selected.push({
      type: "DEFENSE",
      ...defense,
    });
  }


  /*
    2. VALUE
    기존 VALUE 점수 최고
    방어 조합과 중복 제외
  */
  const value =
    [...combos]
      .filter(
        x =>
          !used.has(x.key)
      )
      .sort(
        (a, b) =>
          b.value -
          a.value
      )[0];

  if (value) {
    used.add(value.key);

    selected.push({
      type: "VALUE",
      ...value,
    });
  }


  /*
    3. HIGH ODDS

    전체 조합에서 배당 상위 25%를
    고배당 후보군으로 정의.

    그 후보들 중 모델 승률 최고.
  */
  const oddsSorted =
    [...combos]
      .sort(
        (a, b) =>
          b.odds -
          a.odds
      );

  const highCount =
    Math.max(
      1,
      Math.ceil(
        oddsSorted.length *
        0.25
      )
    );

  const highPool =
    oddsSorted
      .slice(
        0,
        highCount
      )
      .filter(
        x =>
          !used.has(x.key)
      );

  const highOdds =
    highPool
      .sort(
        (a, b) => {
          if (
            b.probability !==
            a.probability
          ) {
            return (
              b.probability -
              a.probability
            );
          }

          return (
            b.odds -
            a.odds
          );
        }
      )[0];

  if (highOdds) {
    selected.push({
      type: "HIGH_ODDS",
      ...highOdds,
    });
  }

  return selected;
}



console.log();
console.log("==================================================");
console.log("V6 VALUE EDGE — BEST 2/3/4/5 LEG DAILY");
console.log("EDGE = MODEL_P - BREAK_EVEN_P(1/ODDS)");
console.log("==================================================");

const V6_DAILY_BUDGET = 30000;
const V6_INDIVIDUAL_STAKE = 10000;
const V6_WEIGHTS = {
  2: 0.60,
  3: 0.25,
  4: 0.10,
  5: 0.05,
};

function V6_edge(combo) {
  return combo.probability - (1 / combo.odds);
}

function V6_breakEven(combo) {
  return 1 / combo.odds;
}

function V6_profit(record, stake) {
  return record.unitProfit * stake;
}

const V6_validRows =
  rows.filter(validPick);

const V6_byDate =
  new Map();

for (const row of V6_validRows) {
  const date =
    String(row.date);

  if (!V6_byDate.has(date)) {
    V6_byDate.set(
      date,
      []
    );
  }

  V6_byDate
    .get(date)
    .push(row);
}

const V6_dates =
  [...V6_byDate.keys()]
    .sort();

const V6_records = [];
const V6_daily = [];

for (const date of V6_dates) {
  const dateRows =
    V6_byDate.get(date);

  const picks = [];

  console.log(
    `PROCESS ${date}`
  );

  for (const leg of [2,3,4,5]) {
    const combos =
      buildAllCombos(
        dateRows,
        leg
      );

    if (!combos.length) {
      continue;
    }

    const best =
      combos
        .map(
          combo => ({
            ...combo,
            breakEven:
              V6_breakEven(
                combo
              ),
            edge:
              V6_edge(
                combo
              ),
          })
        )
        .sort(
          (a, b) => {
            if (
              Math.abs(
                b.edge -
                a.edge
              ) >
              1e-12
            ) {
              return (
                b.edge -
                a.edge
              );
            }

            if (
              Math.abs(
                b.probability -
                a.probability
              ) >
              1e-12
            ) {
              return (
                b.probability -
                a.probability
              );
            }

            return (
              b.odds -
              a.odds
            );
          }
        )[0];

    const settlement =
      settle(
        best.picks
      );

    const record = {
      date,
      split:
        splitOf(date),

      leg,

      key:
        best.key,

      picks:
        best.picks,

      probability:
        best.probability,

      odds:
        best.odds,

      breakEven:
        best.breakEven,

      edge:
        best.edge,

      result:
        settlement.result,

      unitProfit:
        settlement.profit /
        STAKE,
    };

    V6_records.push(
      record
    );

    picks.push(
      record
    );
  }

  V6_daily.push({
    date,
    split:
      splitOf(date),
    picks,
  });
}

function V6_pct(x) {
  return (
    x * 100
  ).toFixed(1) + "%";
}

function V6_money(x) {
  return (
    Math.round(x)
      .toLocaleString("ko-KR") +
    "원"
  );
}

function V6_summary(records) {
  if (!records.length) {
    return null;
  }

  const wins =
    records.filter(
      x =>
        x.result ===
        "WIN"
    ).length;

  const losses =
    records.filter(
      x =>
        x.result ===
        "LOSS"
    ).length;

  const pushes =
    records.length -
    wins -
    losses;

  const decided =
    wins +
    losses;

  const actualProfitUnits =
    records.reduce(
      (sum, x) =>
        sum +
        x.unitProfit,
      0
    );

  return {
    n:
      records.length,

    wins,
    losses,
    pushes,

    hit:
      decided
        ? wins / decided
        : 0,

    avgOdds:
      records.reduce(
        (sum, x) =>
          sum +
          x.odds,
        0
      ) /
      records.length,

    avgP:
      records.reduce(
        (sum, x) =>
          sum +
          x.probability,
        0
      ) /
      records.length,

    avgBreakEven:
      records.reduce(
        (sum, x) =>
          sum +
          x.breakEven,
        0
      ) /
      records.length,

    avgEdge:
      records.reduce(
        (sum, x) =>
          sum +
          x.edge,
        0
      ) /
      records.length,

    roi:
      actualProfitUnits /
      records.length,

    profit10k:
      actualProfitUnits *
      V6_INDIVIDUAL_STAKE,
  };
}

function V6_print(
  label,
  records
) {
  const s =
    V6_summary(
      records
    );

  if (!s) {
    console.log(
      label,
      "N=0"
    );
    return;
  }

  console.log(
    label,
    `N=${s.n}`,
    `W=${s.wins}`,
    `L=${s.losses}`,
    `PUSH=${s.pushes}`,
    `HIT=${V6_pct(s.hit)}`,
    `AVG_ODDS=${s.avgOdds.toFixed(3)}`,
    `MODEL_P=${V6_pct(s.avgP)}`,
    `BE=${V6_pct(s.avgBreakEven)}`,
    `EDGE=${V6_pct(s.avgEdge)}`,
    `ACTUAL_ROI=${V6_pct(s.roi)}`,
    `PROFIT_10K=${V6_money(s.profit10k)}`
  );
}

console.log();
console.log(
  "===== V6 BEST VALUE EDGE BY LEG ====="
);

for (const leg of [2,3,4,5]) {
  V6_print(
    `${leg}LEG`,
    V6_records.filter(
      x =>
        x.leg === leg
    )
  );
}

console.log();
console.log(
  "===== V6 BY SPLIT ====="
);

for (
  const split
  of [
    "DISCOVERY",
    "INTERNAL",
    "FINAL",
  ]
) {
  console.log();
  console.log(
    `### ${split}`
  );

  for (
    const leg
    of [2,3,4,5]
  ) {
    V6_print(
      `${leg}LEG`,
      V6_records.filter(
        x =>
          x.split ===
            split &&
          x.leg ===
            leg
      )
    );
  }
}

function V6_simulate(
  stakeFn,
  legFilter = null
) {
  let bankroll =
    START_BANKROLL;

  let peak =
    bankroll;

  let maxDrawdown = 0;

  let totalStake = 0;
  let totalProfit = 0;

  let winDays = 0;
  let loseDays = 0;
  let flatDays = 0;

  let completedDays = 0;
  let ruinDate = null;

  for (
    const day
    of V6_daily
  ) {
    const bets =
      day.picks.filter(
        x =>
          legFilter === null ||
          x.leg ===
            legFilter
      );

    if (!bets.length) {
      continue;
    }

    const dayStake =
      bets.reduce(
        (sum, x) =>
          sum +
          stakeFn(x),
        0
      );

    if (
      bankroll <
      dayStake
    ) {
      ruinDate =
        day.date;
      break;
    }

    let dayProfit = 0;

    for (
      const bet
      of bets
    ) {
      const stake =
        stakeFn(bet);

      const profit =
        V6_profit(
          bet,
          stake
        );

      totalStake +=
        stake;

      totalProfit +=
        profit;

      dayProfit +=
        profit;
    }

    bankroll +=
      dayProfit;

    peak =
      Math.max(
        peak,
        bankroll
      );

    maxDrawdown =
      Math.max(
        maxDrawdown,
        peak -
        bankroll
      );

    completedDays++;

    if (
      dayProfit > 0
    ) {
      winDays++;
    } else if (
      dayProfit < 0
    ) {
      loseDays++;
    } else {
      flatDays++;
    }
  }

  return {
    bankroll,
    totalStake,
    totalProfit,

    roi:
      totalStake
        ? totalProfit /
          totalStake
        : 0,

    maxDrawdown,

    completedDays,
    winDays,
    loseDays,
    flatDays,
    ruinDate,
  };
}

function V6_moneyPrint(
  label,
  r
) {
  console.log();
  console.log(
    `===== ${label} =====`
  );

  console.log(
    "총 베팅금:",
    V6_money(
      r.totalStake
    )
  );

  console.log(
    "총 손익:",
    V6_money(
      r.totalProfit
    )
  );

  console.log(
    "ROI:",
    V6_pct(
      r.roi
    )
  );

  console.log(
    "최종 잔고:",
    V6_money(
      r.bankroll
    )
  );

  console.log(
    "최대 낙폭:",
    V6_money(
      r.maxDrawdown
    )
  );

  console.log(
    "완주일:",
    `${r.completedDays}/${V6_daily.length}`
  );

  console.log(
    "수익일:",
    r.winDays
  );

  console.log(
    "손실일:",
    r.loseDays
  );

  console.log(
    "무승부일:",
    r.flatDays
  );

  console.log(
    "파산/베팅중단:",
    r.ruinDate ??
      "없음"
  );
}

/*
  포트폴리오:
  하루 30,000원
  2폴 60%
  3폴 25%
  4폴 10%
  5폴 5%
*/
const V6_weighted =
  V6_simulate(
    bet =>
      V6_DAILY_BUDGET *
      V6_WEIGHTS[
        bet.leg
      ]
  );

V6_moneyPrint(
  "V6 PORTFOLIO — 60 / 25 / 10 / 5",
  V6_weighted
);

/*
  비괐:
  하루 30,000원 균등
*/
const V6_equal =
  V6_simulate(
    () =>
      V6_DAILY_BUDGET /
      4
  );

V6_moneyPrint(
  "V6 CONTROL — 25 / 25 / 25 / 25",
  V6_equal
);

/*
  사용자 추가 요청:
  매일 각 추천을 하나만 단독 베팅했을 때.
  각각 독립 시작자금 1,000,000원.
  매일 10,000원.
*/
console.log();
console.log(
  "=================================================="
);
console.log(
  "V6 INDIVIDUAL DAILY BET — ONE RECOMMENDATION ONLY"
);
console.log(
  "START 1,000,000 / BET 10,000 PER DAY"
);
console.log(
  "=================================================="
);

for (
  const leg
  of [2,3,4,5]
) {
  const sim =
    V6_simulate(
      () =>
        V6_INDIVIDUAL_STAKE,
      leg
    );

  V6_moneyPrint(
    `V6 ${leg}LEG ONLY — 10,000/DAY`,
    sim
  );
}

/*
  참고:
  네 추천 4개를 모두 각 1만원씩
  = 하루 최대 40,000원.
*/
const V6_all4TenK =
  V6_simulate(
    () =>
      V6_INDIVIDUAL_STAKE
  );

V6_moneyPrint(
  "V6 ALL4 — 10,000 EACH / MAX 40,000 DAY",
  V6_all4TenK
);

console.log();
console.log(
  "===== V6 RULE ====="
);

console.log(
  "ONE PICK PER LEG PER DAY"
);

console.log(
  "SELECT = MAX(MODEL_P - 1/ODDS)"
);

console.log(
  "2LEG / 3LEG / 4LEG / 5LEG FORCED"
);

console.log(
  "PORTFOLIO = 60 / 25 / 10 / 5"
);

console.log(
  "INDIVIDUAL TEST = EACH LEG ALONE 10,000/DAY"
);

console.log(
  "NO SCORE MODEL RETUNING"
);

console.log(
  "NO POST-RESULT THRESHOLD TUNING"
);

console.log();
console.log("==================================================");
console.log("V8 — 2LEG80 + 4LEG20 OVERLAP / DIVERSIFICATION AUDIT");
console.log("V6 SELECTION LOGIC UNCHANGED");
console.log("2LEG STAKE 24,000 / 4LEG STAKE 6,000");
console.log("==================================================");

const V8_TWO_STAKE = 24000;
const V8_FOUR_STAKE = 6000;
const V8_DAY_STAKE = V8_TWO_STAKE + V8_FOUR_STAKE;

function V8_pickKey(p) {
  return `${p.gameId}:${p.market}:${p.label}`;
}

function V8_gameKey(p) {
  return String(p.gameId);
}

function V8_intersectionCount(a, b) {
  let n = 0;
  for (const x of a) {
    if (b.has(x)) n++;
  }
  return n;
}

function V8_pct(x) {
  return (x * 100).toFixed(1) + "%";
}

function V8_money(x) {
  return Math.round(x).toLocaleString("ko-KR") + "원";
}

function V8_corr(rows) {
  const xs = [];
  const ys = [];

  for (const r of rows) {
    if (
      !["WIN", "LOSS"].includes(r.twoResult) ||
      !["WIN", "LOSS"].includes(r.fourResult)
    ) {
      continue;
    }

    xs.push(r.twoResult === "WIN" ? 1 : 0);
    ys.push(r.fourResult === "WIN" ? 1 : 0);
  }

  if (xs.length < 2) return null;

  const mx = xs.reduce((s,x)=>s+x,0) / xs.length;
  const my = ys.reduce((s,x)=>s+x,0) / ys.length;

  let num = 0;
  let dx = 0;
  let dy = 0;

  for (let i = 0; i < xs.length; i++) {
    const ax = xs[i] - mx;
    const ay = ys[i] - my;
    num += ax * ay;
    dx += ax * ax;
    dy += ay * ay;
  }

  if (dx <= 0 || dy <= 0) return null;
  return num / Math.sqrt(dx * dy);
}

function V8_outcome(r) {
  if (r.twoResult === "WIN" && r.fourResult === "WIN") {
    return "BOTH_WIN";
  }

  if (r.twoResult === "WIN" && r.fourResult === "LOSS") {
    return "2WIN_4LOSS";
  }

  if (r.twoResult === "LOSS" && r.fourResult === "WIN") {
    return "2LOSS_4WIN";
  }

  if (r.twoResult === "LOSS" && r.fourResult === "LOSS") {
    return "BOTH_LOSS";
  }

  return `${r.twoResult}_${r.fourResult}`;
}

const V8_rows = [];

for (const day of V6_daily) {
  const two = day.picks.find(x => x.leg === 2);
  const four = day.picks.find(x => x.leg === 4);

  if (!two || !four) continue;

  const twoPickKeys = new Set(
    two.picks.map(V8_pickKey)
  );

  const fourPickKeys = new Set(
    four.picks.map(V8_pickKey)
  );

  const twoGameKeys = new Set(
    two.picks.map(V8_gameKey)
  );

  const fourGameKeys = new Set(
    four.picks.map(V8_gameKey)
  );

  const sharedPicks =
    V8_intersectionCount(
      twoPickKeys,
      fourPickKeys
    );

  const sharedGames =
    V8_intersectionCount(
      twoGameKeys,
      fourGameKeys
    );

  const fullContainment =
    [...twoPickKeys].every(
      x => fourPickKeys.has(x)
    );

  const profit2 =
    V6_profit(two, V8_TWO_STAKE);

  const profit4 =
    V6_profit(four, V8_FOUR_STAKE);

  V8_rows.push({
    date: day.date,
    split: day.split,

    sharedPicks,
    sharedGames,
    fullContainment,

    twoResult: two.result,
    fourResult: four.result,

    twoOdds: two.odds,
    fourOdds: four.odds,

    profit2,
    profit4,
    dayProfit: profit2 + profit4,
  });
}

function V8_summary(rows) {
  if (!rows.length) return null;

  const profit =
    rows.reduce(
      (s,r) => s + r.dayProfit,
      0
    );

  const avgSharedPicks =
    rows.reduce(
      (s,r) => s + r.sharedPicks,
      0
    ) / rows.length;

  const avgSharedGames =
    rows.reduce(
      (s,r) => s + r.sharedGames,
      0
    ) / rows.length;

  const contained =
    rows.filter(
      r => r.fullContainment
    ).length;

  const bothWin =
    rows.filter(
      r => V8_outcome(r) === "BOTH_WIN"
    ).length;

  const twoOnly =
    rows.filter(
      r => V8_outcome(r) === "2WIN_4LOSS"
    ).length;

  const fourOnly =
    rows.filter(
      r => V8_outcome(r) === "2LOSS_4WIN"
    ).length;

  const bothLoss =
    rows.filter(
      r => V8_outcome(r) === "BOTH_LOSS"
    ).length;

  return {
    n: rows.length,
    profit,
    roi:
      profit /
      (rows.length * V8_DAY_STAKE),

    avgSharedPicks,
    avgSharedGames,

    contained,
    containedRate:
      contained / rows.length,

    bothWin,
    bothWinRate:
      bothWin / rows.length,

    twoOnly,
    twoOnlyRate:
      twoOnly / rows.length,

    fourOnly,
    fourOnlyRate:
      fourOnly / rows.length,

    bothLoss,
    bothLossRate:
      bothLoss / rows.length,

    corr:
      V8_corr(rows),
  };
}

function V8_printSummary(label, rows) {
  const s = V8_summary(rows);

  if (!s) {
    console.log(label, "N=0");
    return;
  }

  console.log(
    label,
    `N=${s.n}`,
    `AVG_SHARED_PICK=${s.avgSharedPicks.toFixed(3)}`,
    `AVG_SHARED_GAME=${s.avgSharedGames.toFixed(3)}`,
    `FULL_CONTAIN=${V8_pct(s.containedRate)}`,
    `BOTH_WIN=${V8_pct(s.bothWinRate)}`,
    `2ONLY=${V8_pct(s.twoOnlyRate)}`,
    `4ONLY=${V8_pct(s.fourOnlyRate)}`,
    `BOTH_LOSS=${V8_pct(s.bothLossRate)}`,
    `WIN_CORR=${
      s.corr === null
        ? "NA"
        : s.corr.toFixed(3)
    }`,
    `PROFIT=${V8_money(s.profit)}`,
    `ROI=${V8_pct(s.roi)}`
  );
}

console.log();
console.log("===== V8 OVERALL =====");
V8_printSummary("ALL", V8_rows);

console.log();
console.log("===== V8 EXACT PICK OVERLAP DISTRIBUTION =====");

for (const n of [0,1,2]) {
  const xs =
    V8_rows.filter(
      r => r.sharedPicks === n
    );

  const profit =
    xs.reduce(
      (s,r) => s + r.dayProfit,
      0
    );

  console.log(
    `SHARED_PICK_${n}`,
    `N=${xs.length}`,
    `RATE=${
      V8_rows.length
        ? V8_pct(xs.length / V8_rows.length)
        : "0.0%"
    }`,
    `PROFIT=${V8_money(profit)}`,
    `ROI=${
      xs.length
        ? V8_pct(
            profit /
            (xs.length * V8_DAY_STAKE)
          )
        : "0.0%"
    }`
  );
}

console.log();
console.log("===== V8 SAME-GAME OVERLAP DISTRIBUTION =====");

for (const n of [0,1,2]) {
  const xs =
    V8_rows.filter(
      r => r.sharedGames === n
    );

  const profit =
    xs.reduce(
      (s,r) => s + r.dayProfit,
      0
    );

  console.log(
    `SHARED_GAME_${n}`,
    `N=${xs.length}`,
    `RATE=${
      V8_rows.length
        ? V8_pct(xs.length / V8_rows.length)
        : "0.0%"
    }`,
    `PROFIT=${V8_money(profit)}`,
    `ROI=${
      xs.length
        ? V8_pct(
            profit /
            (xs.length * V8_DAY_STAKE)
          )
        : "0.0%"
    }`
  );
}

console.log();
console.log("===== V8 FULL CONTAINMENT =====");

for (const flag of [true, false]) {
  const xs =
    V8_rows.filter(
      r => r.fullContainment === flag
    );

  const profit =
    xs.reduce(
      (s,r) => s + r.dayProfit,
      0
    );

  console.log(
    flag
      ? "2LEG_FULLY_INSIDE_4LEG"
      : "NOT_FULLY_CONTAINED",
    `N=${xs.length}`,
    `RATE=${
      V8_rows.length
        ? V8_pct(xs.length / V8_rows.length)
        : "0.0%"
    }`,
    `PROFIT=${V8_money(profit)}`,
    `ROI=${
      xs.length
        ? V8_pct(
            profit /
            (xs.length * V8_DAY_STAKE)
          )
        : "0.0%"
    }`
  );
}

console.log();
console.log("===== V8 OUTCOME / MONEY =====");

const V8_outcomes = [
  "BOTH_WIN",
  "2WIN_4LOSS",
  "2LOSS_4WIN",
  "BOTH_LOSS",
];

for (const outcome of V8_outcomes) {
  const xs =
    V8_rows.filter(
      r => V8_outcome(r) === outcome
    );

  const profit =
    xs.reduce(
      (s,r) => s + r.dayProfit,
      0
    );

  console.log(
    outcome,
    `N=${xs.length}`,
    `RATE=${
      V8_rows.length
        ? V8_pct(xs.length / V8_rows.length)
        : "0.0%"
    }`,
    `TOTAL_PROFIT=${V8_money(profit)}`,
    `AVG_DAY_PROFIT=${
      xs.length
        ? V8_money(profit / xs.length)
        : V8_money(0)
    }`
  );
}

const V8_other =
  V8_rows.filter(
    r => !V8_outcomes.includes(
      V8_outcome(r)
    )
  );

if (V8_other.length) {
  const profit =
    V8_other.reduce(
      (s,r) => s + r.dayProfit,
      0
    );

  console.log(
    "PUSH_OR_OTHER",
    `N=${V8_other.length}`,
    `RATE=${V8_pct(
      V8_other.length / V8_rows.length
    )}`,
    `TOTAL_PROFIT=${V8_money(profit)}`,
    `AVG_DAY_PROFIT=${V8_money(
      profit / V8_other.length
    )}`
  );
}

console.log();
console.log("===== V8 BY SPLIT =====");

for (
  const split
  of [
    "DISCOVERY",
    "INTERNAL",
    "FINAL",
  ]
) {
  V8_printSummary(
    split,
    V8_rows.filter(
      r => r.split === split
    )
  );
}

console.log();
console.log("===== V8 RULE =====");
console.log("V6 VALUE-EDGE PICKS UNCHANGED");
console.log("2LEG = 24,000 / 4LEG = 6,000");
console.log("NO NEW THRESHOLD");
console.log("NO SCORE MODEL RETUNING");
console.log("OVERLAP = EXACT gameId:market:label");
console.log("GAME OVERLAP = SHARED gameId");

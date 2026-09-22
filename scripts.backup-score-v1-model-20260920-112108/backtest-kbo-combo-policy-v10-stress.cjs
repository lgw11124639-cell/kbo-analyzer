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
console.log("V9 - 4LEG DIVERSIFICATION TEST");
console.log("2LEG FIXED / 4LEG RESELECTED");
console.log("A CURRENT / B NO EXACT PICK / C NO SAME GAME");
console.log("2LEG 24,000 / 4LEG 6,000");
console.log("==================================================");

const V9_START_BANKROLL = 1000000;
const V9_TWO_STAKE = 24000;
const V9_FOUR_STAKE = 6000;

function V9_pickKey(p) {
  return `${p.gameId}:${p.market}:${p.label}`;
}

function V9_edge(c) {
  return c.probability - (1 / c.odds);
}

function V9_profit(record, stake) {
  return record.unitProfit * stake;
}

function V9_record(date, combo) {
  const s = settle(combo.picks);
  return {
    date,
    split: splitOf(date),
    leg: 4,
    key: combo.key,
    picks: combo.picks,
    probability: combo.probability,
    odds: combo.odds,
    edge: V9_edge(combo),
    result: s.result,
    unitProfit: s.profit / STAKE,
  };
}

function V9_bestFour(dateRows, two, mode) {
  const twoPickKeys = new Set(two.picks.map(V9_pickKey));
  const twoGames = new Set(two.picks.map(p => String(p.gameId)));

  let best = null;

  for (const c of buildAllCombos(dateRows, 4)) {
    if (mode === "NO_EXACT") {
      if (c.picks.some(p => twoPickKeys.has(V9_pickKey(p)))) continue;
    } else if (mode === "NO_GAME") {
      if (c.picks.some(p => twoGames.has(String(p.gameId)))) continue;
    }

    const edge = V9_edge(c);

    if (
      best === null ||
      edge > best.edge + 1e-12 ||
      (
        Math.abs(edge - best.edge) <= 1e-12 &&
        (
          c.probability > best.probability + 1e-12 ||
          (
            Math.abs(c.probability - best.probability) <= 1e-12 &&
            c.odds > best.odds
          )
        )
      )
    ) {
      best = { ...c, edge };
    }
  }

  return best;
}

const V9_MODES = [
  ["A_CURRENT", "CURRENT"],
  ["B_NO_EXACT", "NO_EXACT"],
  ["C_NO_SAME_GAME", "NO_GAME"],
];

const V9_rows = [];

for (const day of V6_daily) {
  const two = day.picks.find(x => x.leg === 2);
  if (!two) continue;

  const dateRows = V6_byDate.get(day.date) ?? [];

  for (const [strategy, mode] of V9_MODES) {
    let four;

    if (mode === "CURRENT") {
      four = day.picks.find(x => x.leg === 4) ?? null;
    } else {
      const c = V9_bestFour(dateRows, two, mode);
      four = c ? V9_record(day.date, c) : null;
    }

    V9_rows.push({
      strategy,
      date: day.date,
      split: day.split,
      two,
      four,
    });
  }
}

function V9_eval(strategy, split = null) {
  const days = V9_rows.filter(
    x => x.strategy === strategy && (split === null || x.split === split)
  );

  let bankroll = V9_START_BANKROLL;
  let peak = bankroll;
  let maxDD = 0;
  let totalStake = 0;
  let totalProfit = 0;

  let bothWin = 0;
  let twoOnly = 0;
  let fourOnly = 0;
  let bothLoss = 0;
  let other = 0;

  let fourDays = 0;
  let fourStake = 0;
  let fourProfit = 0;
  let fourWins = 0;
  let fourLosses = 0;
  let fourPushes = 0;

  for (const day of days) {
    let dayStake = V9_TWO_STAKE;
    let dayProfit = V9_profit(day.two, V9_TWO_STAKE);

    if (day.four) {
      const fp = V9_profit(day.four, V9_FOUR_STAKE);

      dayStake += V9_FOUR_STAKE;
      dayProfit += fp;

      fourDays++;
      fourStake += V9_FOUR_STAKE;
      fourProfit += fp;

      if (day.four.result === "WIN") fourWins++;
      else if (day.four.result === "LOSS") fourLosses++;
      else fourPushes++;

      if (day.two.result === "WIN" && day.four.result === "WIN") bothWin++;
      else if (day.two.result === "WIN" && day.four.result === "LOSS") twoOnly++;
      else if (day.two.result === "LOSS" && day.four.result === "WIN") fourOnly++;
      else if (day.two.result === "LOSS" && day.four.result === "LOSS") bothLoss++;
      else other++;
    } else {
      other++;
    }

    totalStake += dayStake;
    totalProfit += dayProfit;
    bankroll += dayProfit;
    peak = Math.max(peak, bankroll);
    maxDD = Math.max(maxDD, peak - bankroll);
  }

  return {
    days: days.length,
    fourDays,
    totalStake,
    totalProfit,
    roi: totalStake ? totalProfit / totalStake : 0,
    bankroll,
    maxDD,
    bothWin,
    twoOnly,
    fourOnly,
    bothLoss,
    other,
    fourStake,
    fourProfit,
    fourRoi: fourStake ? fourProfit / fourStake : 0,
    fourWins,
    fourLosses,
    fourPushes,
    fourHit: (fourWins + fourLosses) ? fourWins / (fourWins + fourLosses) : 0,
  };
}

function V9_pct(x) {
  return (x * 100).toFixed(1) + "%";
}

function V9_money(x) {
  return Math.round(x).toLocaleString("ko-KR") + "won";
}

function V9_print(label, r) {
  const d = r.fourDays || 1;
  console.log(
    label,
    `DAYS=${r.days}`,
    `4LEG_DAYS=${r.fourDays}`,
    `BET=${V9_money(r.totalStake)}`,
    `PROFIT=${V9_money(r.totalProfit)}`,
    `ROI=${V9_pct(r.roi)}`,
    `END=${V9_money(r.bankroll)}`,
    `MAX_DD=${V9_money(r.maxDD)}`,
    `BOTH_WIN=${V9_pct(r.bothWin / d)}`,
    `2ONLY=${V9_pct(r.twoOnly / d)}`,
    `4ONLY=${V9_pct(r.fourOnly / d)}`,
    `BOTH_LOSS=${V9_pct(r.bothLoss / d)}`,
    `4LEG_HIT=${V9_pct(r.fourHit)}`,
    `4LEG_ROI=${V9_pct(r.fourRoi)}`,
    `4W=${r.fourWins}`,
    `4L=${r.fourLosses}`,
    `4P=${r.fourPushes}`
  );
}

console.log();
console.log("===== V9 OVERALL =====");
for (const [name] of V9_MODES) {
  V9_print(name, V9_eval(name));
}

console.log();
console.log("===== V9 BY SPLIT =====");
for (const split of ["DISCOVERY", "INTERNAL", "FINAL"]) {
  console.log();
  console.log(`### ${split}`);
  for (const [name] of V9_MODES) {
    V9_print(name, V9_eval(name, split));
  }
}

console.log();
console.log("===== V9 4LEG AVAILABILITY =====");
for (const [name] of V9_MODES) {
  const r = V9_eval(name);
  console.log(
    name,
    `4LEG=${r.fourDays}/${r.days}`,
    `RATE=${V9_pct(r.days ? r.fourDays / r.days : 0)}`
  );
}

console.log();
console.log("===== V9 RULE =====");
console.log("2LEG = V6 VALUE-EDGE PICK UNCHANGED");
console.log("A_CURRENT = V6 CURRENT 4LEG");
console.log("B_NO_EXACT = FORBID BOTH EXACT 2LEG PICKS FROM 4LEG");
console.log("C_NO_SAME_GAME = FORBID ALL 2LEG GAMES FROM 4LEG");
console.log("IF NO 4LEG EXISTS, 2LEG 24,000 STILL BET");
console.log("NO NEW THRESHOLD");
console.log("NO SCORE MODEL RETUNING");

console.log();
console.log("==================================================");
console.log("V10 - B_NO_EXACT PROFIT CONCENTRATION / STRESS TEST");
console.log("B_NO_EXACT LOGIC UNCHANGED");
console.log("2LEG 24,000 / 4LEG 6,000");
console.log("==================================================");

const V10_TWO_STAKE = 24000;
const V10_FOUR_STAKE = 6000;
const V10_START_BANKROLL = 1000000;

const V10_days =
  V9_rows
    .filter(
      x =>
        x.strategy ===
        "B_NO_EXACT"
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(
          b.date
        )
    )
    .map(day => {
      const twoProfit =
        V9_profit(
          day.two,
          V10_TWO_STAKE
        );

      const fourProfit =
        day.four
          ? V9_profit(
              day.four,
              V10_FOUR_STAKE
            )
          : 0;

      const stake =
        V10_TWO_STAKE +
        (
          day.four
            ? V10_FOUR_STAKE
            : 0
        );

      return {
        ...day,
        twoProfit,
        fourProfit,
        stake,
        dayProfit:
          twoProfit +
          fourProfit,
      };
    });

function V10_pct(x) {
  return (
    x * 100
  ).toFixed(1) + "%";
}

function V10_money(x) {
  return (
    Math.round(x)
      .toLocaleString(
        "ko-KR"
      ) + "won"
  );
}

function V10_calc(days) {
  let bankroll =
    V10_START_BANKROLL;

  let peak =
    bankroll;

  let maxDD = 0;

  let totalStake = 0;
  let totalProfit = 0;

  let currentLossStreak = 0;
  let maxLossStreak = 0;
  let streakStart = null;
  let maxStreakStart = null;
  let maxStreakEnd = null;

  for (
    const day
    of days
  ) {
    totalStake +=
      day.stake;

    totalProfit +=
      day.dayProfit;

    bankroll +=
      day.dayProfit;

    peak =
      Math.max(
        peak,
        bankroll
      );

    maxDD =
      Math.max(
        maxDD,
        peak -
        bankroll
      );

    if (
      day.dayProfit < 0
    ) {
      if (
        currentLossStreak === 0
      ) {
        streakStart =
          day.date;
      }

      currentLossStreak++;

      if (
        currentLossStreak >
        maxLossStreak
      ) {
        maxLossStreak =
          currentLossStreak;

        maxStreakStart =
          streakStart;

        maxStreakEnd =
          day.date;
      }
    } else {
      currentLossStreak = 0;
      streakStart = null;
    }
  }

  return {
    totalStake,
    totalProfit,
    roi:
      totalStake
        ? totalProfit /
          totalStake
        : 0,
    bankroll,
    maxDD,
    maxLossStreak,
    maxStreakStart,
    maxStreakEnd,
  };
}

const V10_base =
  V10_calc(
    V10_days
  );

console.log();
console.log(
  "===== V10 BASE B_NO_EXACT ====="
);

console.log(
  `DAYS=${V10_days.length}`,
  `BET=${V10_money(V10_base.totalStake)}`,
  `PROFIT=${V10_money(V10_base.totalProfit)}`,
  `ROI=${V10_pct(V10_base.roi)}`,
  `END=${V10_money(V10_base.bankroll)}`,
  `MAX_DD=${V10_money(V10_base.maxDD)}`,
  `MAX_LOSS_STREAK=${V10_base.maxLossStreak}`,
  `STREAK=${V10_base.maxStreakStart ?? "NONE"}~${V10_base.maxStreakEnd ?? "NONE"}`
);

const V10_fourWins =
  V10_days
    .filter(
      x =>
        x.four &&
        x.four.result ===
        "WIN"
    )
    .map(x => ({
      date:
        x.date,

      split:
        x.split,

      odds:
        x.four.odds,

      probability:
        x.four.probability,

      breakEven:
        1 /
        x.four.odds,

      edge:
        x.four.edge,

      fourProfit:
        x.fourProfit,

      twoResult:
        x.two.result,

      dayProfit:
        x.dayProfit,
    }))
    .sort(
      (a, b) =>
        b.fourProfit -
        a.fourProfit
    );

console.log();
console.log(
  "===== V10 4LEG WINNERS — ALL ====="
);

V10_fourWins.forEach(
  (x, i) => {
    console.log(
      `#${i + 1}`,
      x.date,
      x.split,
      `ODDS=${x.odds.toFixed(3)}`,
      `MODEL_P=${V10_pct(x.probability)}`,
      `BE=${V10_pct(x.breakEven)}`,
      `EDGE=${V10_pct(x.edge)}`,
      `4LEG_PROFIT=${V10_money(x.fourProfit)}`,
      `2LEG=${x.twoResult}`,
      `DAY_PROFIT=${V10_money(x.dayProfit)}`
    );
  }
);

const V10_fourGrossWinProfit =
  V10_fourWins.reduce(
    (s, x) =>
      s +
      x.fourProfit,
    0
  );

console.log();
console.log(
  "===== V10 PROFIT CONCENTRATION ====="
);

console.log(
  "4LEG_GROSS_WIN_PROFIT",
  V10_money(
    V10_fourGrossWinProfit
  )
);

for (
  const k
  of [1, 2, 3, 5]
) {
  const topProfit =
    V10_fourWins
      .slice(0, k)
      .reduce(
        (s, x) =>
          s +
          x.fourProfit,
        0
      );

  console.log(
    `TOP_${k}`,
    `PROFIT=${V10_money(topProfit)}`,
    `SHARE_OF_4LEG_GROSS=${V10_pct(
      V10_fourGrossWinProfit
        ? topProfit /
          V10_fourGrossWinProfit
        : 0
    )}`,
    `VS_PORTFOLIO_NET=${V10_base.totalProfit !== 0
      ? V10_pct(
          topProfit /
          Math.abs(
            V10_base.totalProfit
          )
        )
      : "NA"}`
  );
}

function V10_stress(k) {
  const targetDates =
    new Set(
      V10_fourWins
        .slice(0, k)
        .map(
          x =>
            x.date
        )
    );

  const adjusted =
    V10_days.map(day => {
      if (
        !targetDates.has(
          day.date
        ) ||
        !day.four
      ) {
        return {
          ...day,
        };
      }

      const stressedFourProfit =
        -V10_FOUR_STAKE;

      return {
        ...day,

        fourProfit:
          stressedFourProfit,

        dayProfit:
          day.twoProfit +
          stressedFourProfit,
      };
    });

  return V10_calc(
    adjusted
  );
}

console.log();
console.log(
  "===== V10 STRESS — TOP 4LEG WINS FORCED TO LOSS ====="
);

console.log(
  "BASE",
  `PROFIT=${V10_money(V10_base.totalProfit)}`,
  `ROI=${V10_pct(V10_base.roi)}`,
  `END=${V10_money(V10_base.bankroll)}`,
  `MAX_DD=${V10_money(V10_base.maxDD)}`
);

for (
  const k
  of [1, 2, 3]
) {
  const s =
    V10_stress(k);

  console.log(
    `TOP_${k}_WIN_TO_LOSS`,
    `PROFIT=${V10_money(s.totalProfit)}`,
    `ROI=${V10_pct(s.roi)}`,
    `END=${V10_money(s.bankroll)}`,
    `MAX_DD=${V10_money(s.maxDD)}`,
    `MAX_LOSS_STREAK=${s.maxLossStreak}`,
    `STREAK=${s.maxStreakStart ?? "NONE"}~${s.maxStreakEnd ?? "NONE"}`
  );
}

const V10_months =
  new Map();

for (
  const day
  of V10_days
) {
  const month =
    day.date.slice(
      0,
      7
    );

  if (
    !V10_months.has(
      month
    )
  ) {
    V10_months.set(
      month,
      []
    );
  }

  V10_months
    .get(month)
    .push(day);
}

console.log();
console.log(
  "===== V10 MONTHLY ====="
);

for (
  const [
    month,
    days
  ]
  of V10_months
) {
  const totalStake =
    days.reduce(
      (s, x) =>
        s +
        x.stake,
      0
    );

  const twoProfit =
    days.reduce(
      (s, x) =>
        s +
        x.twoProfit,
      0
    );

  const fourProfit =
    days.reduce(
      (s, x) =>
        s +
        x.fourProfit,
      0
    );

  const totalProfit =
    twoProfit +
    fourProfit;

  const fourWins =
    days.filter(
      x =>
        x.four &&
        x.four.result ===
        "WIN"
    ).length;

  const fourDays =
    days.filter(
      x =>
        x.four
    ).length;

  console.log(
    month,
    `DAYS=${days.length}`,
    `BET=${V10_money(totalStake)}`,
    `2LEG_PROFIT=${V10_money(twoProfit)}`,
    `4LEG_PROFIT=${V10_money(fourProfit)}`,
    `TOTAL_PROFIT=${V10_money(totalProfit)}`,
    `ROI=${V10_pct(
      totalStake
        ? totalProfit /
          totalStake
        : 0
    )}`,
    `4LEG_W=${fourWins}/${fourDays}`
  );
}

console.log();
console.log(
  "===== V10 LOSS-STREAK DETAIL ====="
);

console.log(
  `MAX_CONSECUTIVE_LOSS_DAYS=${V10_base.maxLossStreak}`,
  `FROM=${V10_base.maxStreakStart ?? "NONE"}`,
  `TO=${V10_base.maxStreakEnd ?? "NONE"}`
);

console.log();
console.log(
  "===== V10 RULE ====="
);

console.log(
  "B_NO_EXACT UNCHANGED"
);

console.log(
  "2LEG = 24,000 / 4LEG = 6,000"
);

console.log(
  "STRESS = TOP 4LEG WIN RESULT CHANGED TO LOSS"
);

console.log(
  "STAKE KEPT CONSTANT DURING STRESS"
);

console.log(
  "NO NEW THRESHOLD"
);

console.log(
  "NO SCORE MODEL RETUNING"
);

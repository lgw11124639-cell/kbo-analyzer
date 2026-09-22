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


/* ==================================================
   DAILY SELECTIONS
================================================== */

const validRows =
  rows.filter(validPick);

const byDate =
  new Map();

for (
  const row
  of validRows
) {
  const date =
    String(row.date);

  if (
    !byDate.has(date)
  ) {
    byDate.set(
      date,
      []
    );
  }

  byDate
    .get(date)
    .push(row);
}

const dates =
  [...byDate.keys()]
    .sort();

const allSelections = [];
const dailyRecords = [];


/* ==================================================
   RUN
================================================== */

for (
  const date
  of dates
) {
  const dateRows =
    byDate.get(date);

  const daySelections = [];

  console.log(
    `PROCESS ${date}`
  );

  for (
    const leg
    of [
      2,
      3,
      4,
      5,
    ]
  ) {
    const combos =
      buildAllCombos(
        dateRows,
        leg
      );

    const chosen =
      selectThree(
        combos
      );

    for (
      const item
      of chosen
    ) {
      const settlement =
        settle(
          item.picks
        );

      const record = {
        date,
        split:
          splitOf(date),

        leg,

        type:
          item.type,

        key:
          item.key,

        probability:
          item.probability,

        odds:
          item.odds,

        value:
          item.value,

        result:
          settlement.result,

        payout:
          settlement.payout,

        profit:
          settlement.profit,
      };

      allSelections.push(
        record
      );

      daySelections.push(
        record
      );
    }
  }


  /* ==================================================
     TOP 3 REPRESENTATIVE
  ================================================== */

  const usedTop =
    new Set();

  const top = [];


  /*
    1. 최고 승률
  */
  const winTop =
    [...daySelections]
      .sort(
        (a, b) =>
          b.probability -
          a.probability
      )[0];

  if (winTop) {
    usedTop.add(
      winTop.key
    );

    top.push({
      slot:
        "TOP_WIN",
      ...winTop,
    });
  }


  /*
    2. 최고 가치
  */
  const valueTop =
    [...daySelections]
      .filter(
        x =>
          !usedTop.has(
            x.key
          )
      )
      .sort(
        (a, b) =>
          b.value -
          a.value
      )[0];

  if (valueTop) {
    usedTop.add(
      valueTop.key
    );

    top.push({
      slot:
        "TOP_VALUE",
      ...valueTop,
    });
  }


  /*
    3. 고배당 추천 4개 중
       모델 승률 가장 높은 것
  */
  const highTop =
    [...daySelections]
      .filter(
        x =>
          x.type ===
            "HIGH_ODDS" &&
          !usedTop.has(
            x.key
          )
      )
      .sort(
        (a, b) =>
          b.probability -
          a.probability
      )[0];

  if (highTop) {
    top.push({
      slot:
        "TOP_HIGH_ODDS",
      ...highTop,
    });
  }


  dailyRecords.push({
    date,
    split:
      splitOf(date),

    all12:
      daySelections,

    top3:
      top,
  });
}


/* ==================================================
   SUMMARY HELPERS
================================================== */

function pct(x) {
  return (
    x * 100
  ).toFixed(1) + "%";
}

function won(
  record
) {
  return (
    record.result ===
    "WIN"
  );
}

function summarize(
  records
) {
  if (!records.length) {
    return null;
  }

  const wins =
    records.filter(won)
      .length;

  const losses =
    records.filter(
      x =>
        x.result ===
        "LOSS"
    ).length;

  const pushes =
    records.filter(
      x =>
        x.result ===
        "PUSH"
    ).length;

  const stake =
    records.length *
    STAKE;

  const profit =
    records.reduce(
      (s, x) =>
        s + x.profit,
      0
    );

  const payout =
    stake +
    profit;

  return {
    n:
      records.length,

    wins,
    losses,
    pushes,

    hitRate:
      wins /
      Math.max(
        1,
        wins + losses
      ),

    avgOdds:
      records.reduce(
        (s, x) =>
          s + x.odds,
        0
      ) /
      records.length,

    avgP:
      records.reduce(
        (s, x) =>
          s +
          x.probability,
        0
      ) /
      records.length,

    stake,
    payout,
    profit,

    roi:
      profit /
      stake,
  };
}

function money(n) {
  return (
    Math.round(n)
      .toLocaleString(
        "ko-KR"
      ) +
    "원"
  );
}

function print(
  name,
  records
) {
  const x =
    summarize(records);

  if (!x) {
    console.log(
      name,
      "N=0"
    );

    return;
  }

  console.log(
    name,
    `N=${x.n}`,
    `W=${x.wins}`,
    `L=${x.losses}`,
    `PUSH=${x.pushes}`,
    `HIT=${pct(x.hitRate)}`,
    `MODEL_P=${pct(x.avgP)}`,
    `AVG_ODDS=${x.avgOdds.toFixed(3)}`,
    `BET=${money(x.stake)}`,
    `PROFIT=${money(x.profit)}`,
    `ROI=${pct(x.roi)}`
  );
}


/* ==================================================
   MONEY SIMULATION
================================================== */

function simulateDaily(
  key
) {
  let bankroll =
    START_BANKROLL;

  let peak =
    bankroll;

  let maxDrawdown = 0;

  let minCash =
    bankroll;

  let totalStake = 0;
  let totalProfit = 0;

  let profitableDays = 0;
  let losingDays = 0;
  let flatDays = 0;

  for (
    const day
    of dailyRecords
  ) {
    const bets =
      day[key];

    if (!bets.length) {
      continue;
    }

    const dayStake =
      bets.length *
      STAKE;

    /*
      경기 시작 전 모든 베팅금 차감
    */
    bankroll -=
      dayStake;

    minCash =
      Math.min(
        minCash,
        bankroll
      );

    let dayReturn = 0;

    for (
      const bet
      of bets
    ) {
      dayReturn +=
        bet.payout;
    }

    bankroll +=
      dayReturn;

    const dayProfit =
      dayReturn -
      dayStake;

    totalStake +=
      dayStake;

    totalProfit +=
      dayProfit;

    if (
      dayProfit > 0
    ) {
      profitableDays++;
    } else if (
      dayProfit < 0
    ) {
      losingDays++;
    } else {
      flatDays++;
    }

    peak =
      Math.max(
        peak,
        bankroll
      );

    const drawdown =
      peak -
      bankroll;

    maxDrawdown =
      Math.max(
        maxDrawdown,
        drawdown
      );
  }

  return {
    bankroll,
    totalStake,
    totalProfit,
    roi:
      totalProfit /
      totalStake,

    minCash,

    maxDrawdown,

    profitableDays,
    losingDays,
    flatDays,

    totalDays:
      profitableDays +
      losingDays +
      flatDays,
  };
}


/* ==================================================
   OUTPUT
================================================== */

console.log();
console.log(
  "=================================================="
);

console.log(
  "POLICY RESULT"
);

console.log(
  "STAKE PER COMBO =",
  money(STAKE)
);

console.log(
  "START BANKROLL =",
  money(
    START_BANKROLL
  )
);

console.log(
  "=================================================="
);


/* ==================================================
   2 / 3 / 4 / 5 LEG
================================================== */

console.log();
console.log(
  "===== LEG / STYLE ====="
);

for (
  const leg
  of [
    2,
    3,
    4,
    5,
  ]
) {
  console.log();
  console.log(
    `### ${leg}LEG`
  );

  for (
    const type
    of [
      "DEFENSE",
      "VALUE",
      "HIGH_ODDS",
    ]
  ) {
    print(
      type,
      allSelections.filter(
        x =>
          x.leg === leg &&
          x.type === type
      )
    );
  }
}


/* ==================================================
   TEMPORAL
================================================== */

console.log();
console.log(
  "===== TEMPORAL STABILITY ====="
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

  print(
    "ALL12",
    allSelections.filter(
      x =>
        x.split ===
        split
    )
  );

  for (
    const leg
    of [
      2,
      3,
      4,
      5,
    ]
  ) {
    print(
      `${leg}LEG`,
      allSelections.filter(
        x =>
          x.split ===
            split &&
          x.leg ===
            leg
      )
    );
  }
}


/* ==================================================
   TOP3 REPRESENTATIVES
================================================== */

const top3Records =
  dailyRecords.flatMap(
    x =>
      x.top3
  );

console.log();
console.log(
  "===== TOP 3 REPRESENTATIVE ====="
);

for (
  const slot
  of [
    "TOP_WIN",
    "TOP_VALUE",
    "TOP_HIGH_ODDS",
  ]
) {
  print(
    slot,
    top3Records.filter(
      x =>
        x.slot ===
        slot
    )
  );
}

console.log();
console.log(
  "===== TOP3 BY SPLIT ====="
);

for (
  const split
  of [
    "DISCOVERY",
    "INTERNAL",
    "FINAL",
  ]
) {
  print(
    split,
    top3Records.filter(
      x =>
        x.split ===
        split
    )
  );
}


/* ==================================================
   DAILY MONEY — ALL 12
================================================== */

console.log();
console.log(
  "=================================================="
);

console.log(
  "MONEY SIMULATION — ALL 12"
);

console.log(
  "=================================================="
);

const all12Money =
  simulateDaily(
    "all12"
  );

console.log(
  "총 베팅금:",
  money(
    all12Money.totalStake
  )
);

console.log(
  "총 손익:",
  money(
    all12Money.totalProfit
  )
);

console.log(
  "ROI:",
  pct(
    all12Money.roi
  )
);

console.log(
  "최종 잔고:",
  money(
    all12Money.bankroll
  )
);

console.log(
  "최대 낙폭:",
  money(
    all12Money.maxDrawdown
  )
);

console.log(
  "최저 현금잔고:",
  money(
    all12Money.minCash
  )
);

console.log(
  "수익일:",
  `${all12Money.profitableDays}/${all12Money.totalDays}`
);

console.log(
  "손실일:",
  `${all12Money.losingDays}/${all12Money.totalDays}`
);


/* ==================================================
   DAILY MONEY — TOP 3
================================================== */

console.log();
console.log(
  "=================================================="
);

console.log(
  "MONEY SIMULATION — TOP 3 ONLY"
);

console.log(
  "=================================================="
);

const top3Money =
  simulateDaily(
    "top3"
  );

console.log(
  "총 베팅금:",
  money(
    top3Money.totalStake
  )
);

console.log(
  "총 손익:",
  money(
    top3Money.totalProfit
  )
);

console.log(
  "ROI:",
  pct(
    top3Money.roi
  )
);

console.log(
  "최종 잔고:",
  money(
    top3Money.bankroll
  )
);

console.log(
  "최대 낙폭:",
  money(
    top3Money.maxDrawdown
  )
);

console.log(
  "최저 현금잔고:",
  money(
    top3Money.minCash
  )
);

console.log(
  "수익일:",
  `${top3Money.profitableDays}/${top3Money.totalDays}`
);

console.log(
  "손실일:",
  `${top3Money.losingDays}/${top3Money.totalDays}`
);


/* ==================================================
   POLICY
================================================== */

console.log();
console.log(
  "===== POLICY ====="
);

console.log(
  "2/3/4/5 LEG = DEFENSE 1 + VALUE 1 + HIGH_ODDS 1"
);

console.log(
  "DEFENSE = HIGHEST MODEL COMBO PROBABILITY"
);

console.log(
  "VALUE = HIGHEST EXISTING VALUE SCORE"
);

console.log(
  "HIGH_ODDS = TOP 25% ODDS GROUP -> HIGHEST MODEL PROBABILITY"
);

console.log(
  "TOP_WIN = HIGHEST PROBABILITY AMONG 12"
);

console.log(
  "TOP_VALUE = HIGHEST VALUE AMONG 12"
);

console.log(
  "TOP_HIGH_ODDS = HIGHEST PROBABILITY AMONG HIGH_ODDS PICKS"
);

console.log(
  "FLAT STAKE =", STAKE
);

console.log(
  "NO PARAMETER TUNING"
);

console.log("\n==================================================");
console.log("V3 FAIR REPRESENTATIVE");
console.log("==================================================");

const V3_adjP = x => Math.pow(Math.max(1e-9, x.probability), 1 / x.leg);
const V3_ev = x => x.probability * x.odds - 1;
const V3_days = new Map();

for (const x of allSelections) {
  if (!V3_days.has(x.date)) V3_days.set(x.date, []);
  V3_days.get(x.date).push(x);
}

const V3_daily = [];

for (const [date, xs] of [...V3_days.entries()].sort((a,b)=>a[0].localeCompare(b[0]))) {
  const best = (type, mode) => xs
    .filter(x => x.type === type)
    .map(x => ({...x, adjP: V3_adjP(x), comboEv: V3_ev(x)}))
    .sort((a,b) => {
      if (mode === "ADJP") return (b.adjP-a.adjP) || (b.comboEv-a.comboEv);
      return (b.comboEv-a.comboEv) || (b.adjP-a.adjP);
    })[0] || null;

  const stability = best("DEFENSE", "ADJP");
  const value = best("VALUE", "EV");
  const high = best("HIGH_ODDS", "EV");

  const reps = [];
  if (stability) reps.push({...stability, slot:"TOP_STABILITY"});
  if (value) reps.push({...value, slot:"TOP_VALUE"});
  if (high) reps.push({...high, slot:"TOP_HIGH_ODDS"});

  V3_daily.push({date, split: splitOf(date), reps});
}

const V3_rows = V3_daily.flatMap(d => d.reps.map(x => ({...x, split:d.split})));

function V3_stat(rows) {
  if (!rows.length) return null;
  const w = rows.filter(x=>x.result==="WIN").length;
  const l = rows.filter(x=>x.result==="LOSS").length;
  const p = rows.length-w-l;
  const avg = key => rows.reduce((s,x)=>s+x[key],0)/rows.length;
  return {
    n:rows.length,w,l,p,
    hit:w/Math.max(1,w+l),
    odds:avg("odds"),
    model:avg("probability"),
    adj:rows.reduce((s,x)=>s+V3_adjP(x),0)/rows.length,
    ev:rows.reduce((s,x)=>s+V3_ev(x),0)/rows.length
  };
}

function V3_print(label, rows) {
  const s = V3_stat(rows);
  if (!s) return console.log(label,"N=0");
  console.log(
    label,
    `N=${s.n}`,
    `W=${s.w}`,
    `L=${s.l}`,
    `PUSH=${s.p}`,
    `HIT=${pct(s.hit)}`,
    `AVG_ODDS=${s.odds.toFixed(3)}`,
    `MODEL_P=${pct(s.model)}`,
    `LEG_ADJ_P=${pct(s.adj)}`,
    `COMBO_EV=${pct(s.ev)}`
  );
}

console.log("\n===== V3 TOP3 RESULT =====");
for (const slot of ["TOP_STABILITY","TOP_VALUE","TOP_HIGH_ODDS"]) {
  V3_print(slot, V3_rows.filter(x=>x.slot===slot));
}

console.log("\n===== V3 LEG DISTRIBUTION =====");
for (const slot of ["TOP_STABILITY","TOP_VALUE","TOP_HIGH_ODDS"]) {
  const rs = V3_rows.filter(x=>x.slot===slot);
  console.log(`### ${slot}`);
  for (const leg of [2,3,4,5]) {
    const n = rs.filter(x=>x.leg===leg).length;
    console.log(`${leg}LEG`, n, rs.length ? pct(n/rs.length) : "0.0%");
  }
}

console.log("\n===== V3 BY SPLIT =====");
for (const split of ["DISCOVERY","INTERNAL","FINAL"]) {
  console.log(`### ${split}`);
  const rs = V3_rows.filter(x=>x.split===split);
  V3_print("ALL_TOP3",rs);
  for (const slot of ["TOP_STABILITY","TOP_VALUE","TOP_HIGH_ODDS"]) {
    V3_print(slot,rs.filter(x=>x.slot===slot));
  }
}

function V3_profit(x, stake) {
  if (x.result==="WIN") return stake*(x.odds-1);
  if (x.result==="LOSS") return -stake;
  return 0;
}

function V3_money(stakeFn) {
  let bank=START_BANKROLL, peak=bank, dd=0, stake=0, profit=0, winDays=0, loseDays=0, flatDays=0, done=0, ruin=null;
  for (const d of V3_daily) {
    if (!d.reps.length) continue;
    const dayStake=d.reps.reduce((s,x)=>s+stakeFn(x),0);
    if (bank < dayStake) { ruin=d.date; break; }
    let dayProfit=0;
    for (const x of d.reps) {
      const st=stakeFn(x);
      const pr=V3_profit(x,st);
      stake += st;
      profit += pr;
      dayProfit += pr;
    }
    bank += dayProfit;
    peak=Math.max(peak,bank);
    dd=Math.max(dd,peak-bank);
    done++;
    if(dayProfit>0) winDays++; else if(dayProfit<0) loseDays++; else flatDays++;
  }
  return {bank,peak,dd,stake,profit,roi:stake?profit/stake:0,winDays,loseDays,flatDays,done,ruin};
}

function V3_moneyPrint(label, fn) {
  const x=V3_money(fn);
  console.log(`\n===== ${label} =====`);
  console.log("총 베팅금:",money(x.stake));
  console.log("총 손익:",money(x.profit));
  console.log("ROI:",pct(x.roi));
  console.log("최종 잔고:",money(x.bank));
  console.log("최대 낙폭:",money(x.dd));
  console.log("완주일:",`${x.done}/${V3_daily.length}`);
  console.log("수익일:",x.winDays);
  console.log("손실일:",x.loseDays);
  console.log("파산/베팅중단:",x.ruin ?? "없음");
}

V3_moneyPrint("V3 MONEY EQUAL 10,000 x 3", () => 10000);
V3_moneyPrint(
  "V3 MONEY 50/30/20",
  x => x.slot==="TOP_STABILITY" ? 15000 : x.slot==="TOP_VALUE" ? 9000 : 6000
);

console.log("\n===== V3 RULE =====");
console.log("TOP_STABILITY = max(PROBABILITY^(1/LEG)) among DEFENSE 2/3/4/5");
console.log("TOP_VALUE = max(PROBABILITY*ODDS-1) among VALUE 2/3/4/5");
console.log("TOP_HIGH_ODDS = max(PROBABILITY*ODDS-1) among HIGH_ODDS 2/3/4/5");
console.log("BASE 12 RECOMMENDATIONS UNCHANGED");
console.log("NO V0.8 SCORE MODEL RETUNING");

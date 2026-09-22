const fs = require("fs");

const INPUT =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw = JSON.parse(fs.readFileSync(INPUT, "utf8"));

const rows = (raw.results || raw)
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

const INITIAL_BANKROLL = 1000000;
const DAILY_INVESTMENT = 50000;

function gradeValue(x) {
  const g = String(x.grade || "").toUpperCase();
  if (g === "A") return 3;
  if (g === "B") return 2;
  return 1;
}

function eligible(x) {
  return (
    x.ev >= -0.03 &&
    x.ev <= 0.15 &&
    x.confidence >= 0.40 &&
    x.odds >= 1.20
  );
}

function pickScore(x) {
  const ev =
    Math.max(-0.30, Math.min(0.35, x.ev));

  return (
    x.confidence * 0.72 +
    ev * 0.18 +
    gradeValue(x) * 0.035
  );
}

function pickKey(x) {
  return `${x.gameId}:${x.market}:${x.label}`;
}

function canAdd(selected,next) {
  const same =
    selected.filter(
      x => x.gameId === next.gameId
    );

  if (same.length >= 2) return false;

  if (
    same.some(
      x => x.market === next.market
    )
  ) {
    return false;
  }

  const nextSide =
    next.market === "ML" ||
    next.market === "HANDICAP";

  const hasSide =
    same.some(
      x =>
        x.market === "ML" ||
        x.market === "HANDICAP"
    );

  if (nextSide && hasSide) {
    return false;
  }

  return true;
}

function productOdds(picks) {
  return picks.reduce(
    (v,x) => v*x.odds,
    1
  );
}

function productProb(picks) {
  return picks.reduce(
    (v,x) => v*x.confidence,
    1
  );
}

function avgConf(picks) {
  return picks.reduce(
    (v,x) => v+x.confidence,
    0
  ) / picks.length;
}

function avgEv(picks) {
  return picks.reduce(
    (v,x) => v+x.ev,
    0
  ) / picks.length;
}

function scoreA(picks) {
  return (
    productProb(picks)*120 +
    avgConf(picks)*45 +
    avgEv(picks)*12 +
    picks.reduce(
      (s,x) =>
        s + gradeValue(x)*1.5,
      0
    )
  );
}

function extraScore(x) {
  return (
    x.confidence*100*0.70 +
    x.ev*100*0.55 +
    Math.log(
      Math.max(1,x.odds)
    )*8 +
    gradeValue(x)*2
  );
}

function getPool(dayRows) {
  const sorted =
    dayRows
      .filter(eligible)
      .sort(
        (a,b) =>
          pickScore(b)-pickScore(a)
      );

  // 실제 analyzer처럼 경기당 상위 3개
  const count = new Map();
  const pool = [];

  for (const x of sorted) {
    const n =
      count.get(x.gameId) || 0;

    if (n < 3) {
      pool.push(x);
      count.set(x.gameId,n+1);
    }
  }

  return pool;
}

function buildTwo(pool) {
  const out = [];

  for (let i=0;i<pool.length;i++) {
    for (let j=i+1;j<pool.length;j++) {
      if (
        canAdd(
          [pool[i]],
          pool[j]
        )
      ) {
        out.push([
          pool[i],
          pool[j]
        ]);
      }
    }
  }

  return out;
}

function marketSet(picks) {
  return picks
    .map(x => x.market)
    .sort()
    .join("+");
}

function templateAllowed(
  template,
  A,
  extra
) {
  const markets =
    A.map(x => x.market);

  const hasTotal =
    markets.includes("TOTAL");

  const hasML =
    markets.includes("ML");

  const hasHandicap =
    markets.includes("HANDICAP");

  if (template === "ANY") {
    return true;
  }

  /*
    TOTAL + ML 베이스
  */
  if (template === "TOTAL_ML") {
    return (
      hasTotal &&
      hasML
    );
  }

  /*
    TOTAL + HANDICAP 베이스
  */
  if (template === "TOTAL_HANDICAP") {
    return (
      hasTotal &&
      hasHandicap
    );
  }

  /*
    서로 다른 경기 ML + ML
    베이스에 TOTAL 추가
  */
  if (template === "ML_ML_TOTAL") {
    if (
      !(
        markets.length === 2 &&
        markets.every(
          x => x === "ML"
        )
      )
    ) {
      return false;
    }

    return extra.market === "TOTAL";
  }

  return true;
}

function chooseNested(
  dayRows,
  template
) {
  const pool =
    getPool(dayRows);

  const two =
    buildTwo(pool)
      .filter(A => {
        if (
          template === "TOTAL_ML"
        ) {
          return (
            A.some(x => x.market==="TOTAL") &&
            A.some(x => x.market==="ML")
          );
        }

        if (
          template === "TOTAL_HANDICAP"
        ) {
          return (
            A.some(x => x.market==="TOTAL") &&
            A.some(x => x.market==="HANDICAP")
          );
        }

        if (
          template === "ML_ML_TOTAL"
        ) {
          return (
            A.every(x => x.market==="ML") &&
            A[0].gameId !== A[1].gameId
          );
        }

        return true;
      })
      .sort(
        (a,b) =>
          scoreA(b)-scoreA(a)
      );

  if (!two.length) {
    return null;
  }

  /*
    A를 무조건 첫 조합으로 고정하지 않고
    상위 50개 A를 살펴본다.

    그래야 최고 A가 추가픽을 붙일 수 없는
    경우 때문에 날짜가 사라지는 현상을 줄인다.
  */
  const aCandidates =
    two.slice(0,50);

  let best = null;

  for (const A of aCandidates) {
    const aKeys =
      new Set(A.map(pickKey));

    let extras =
      pool
        .filter(x =>
          !aKeys.has(pickKey(x))
        )
        .filter(x =>
          canAdd(A,x)
        )
        .filter(x =>
          templateAllowed(
            template,
            A,
            x
          )
        );

    /*
      TOTAL_ML의 확장픽은 우선 HANDICAP을
      선호하되, 같은 경기 ML+HANDICAP 금지
      규칙 때문에 다른 경기 HANDICAP이어야 함.
    */
    if (template === "TOTAL_ML") {
      const handi =
        extras.filter(
          x => x.market === "HANDICAP"
        );

      if (handi.length) {
        extras = handi;
      }
    }

    /*
      TOTAL_HANDICAP 베이스는
      확장픽 ML을 우선.
    */
    if (
      template ===
      "TOTAL_HANDICAP"
    ) {
      const ml =
        extras.filter(
          x => x.market === "ML"
        );

      if (ml.length) {
        extras = ml;
      }
    }

    extras.sort(
      (a,b) =>
        extraScore(b) -
        extraScore(a)
    );

    if (!extras.length) {
      continue;
    }

    const extra =
      extras[0];

    const B =
      [...A,extra];

    const combinedScore =
      scoreA(A) +
      extraScore(extra)*0.20;

    if (
      !best ||
      combinedScore >
        best.combinedScore
    ) {
      best = {
        A,
        B,
        extra,
        combinedScore,
      };
    }
  }

  return best;
}

function comboResult(picks) {
  if (
    picks.some(
      x => x.result === "LOSS"
    )
  ) {
    return {
      win:false,
      odds:0
    };
  }

  const odds =
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

  return {
    win:true,
    odds
  };
}

function groupByDate(source) {
  const m = new Map();

  for (const x of source) {
    if (!m.has(x.date)) {
      m.set(x.date,[]);
    }

    m.get(x.date).push(x);
  }

  return [...m.entries()]
    .sort(
      (a,b) =>
        a[0].localeCompare(b[0])
    );
}

function stakeRatio(
  mode,
  A
) {
  if (
    typeof mode === "number"
  ) {
    return mode;
  }

  /*
    A만 적중해도 전체 투자금 원금 회수 목표.

    stakeA * A_odds >= total stake

    stakeA share >= 1/A_odds

    너무 극단적인 비율은 막기 위해
    40~90% 범위.
  */
  if (mode === "RECOVERY") {
    const aOdds =
      productOdds(A);

    return Math.max(
      0.40,
      Math.min(
        0.90,
        1/aOdds
      )
    );
  }

  throw new Error(
    "Unknown ratio mode"
  );
}

function simulate(
  source,
  template,
  ratioMode
) {
  let bankroll =
    INITIAL_BANKROLL;

  let peak =
    INITIAL_BANKROLL;

  let maxDD = 0;

  let invested = 0;
  let returned = 0;

  let activeDays = 0;

  let both = 0;
  let onlyA = 0;
  let neither = 0;

  let aOnlyBreakEven = 0;

  let totalAOnlyRecovery = 0;

  let loseStreak = 0;
  let maxLoseStreak = 0;

  let totalARatio = 0;
  let totalAOdds = 0;
  let totalBOdds = 0;

  const months =
    new Map();

  for (
    const [date,dayRows]
    of groupByDate(source)
  ) {
    const pair =
      chooseNested(
        dayRows,
        template
      );

    if (!pair) continue;

    const totalStake =
      Math.min(
        DAILY_INVESTMENT,
        bankroll
      );

    if (totalStake <= 0) {
      break;
    }

    activeDays++;

    const r =
      stakeRatio(
        ratioMode,
        pair.A
      );

    totalARatio += r;

    const stakeA =
      Math.round(
        totalStake*r
      );

    const stakeB =
      totalStake-stakeA;

    const ra =
      comboResult(pair.A);

    const rb =
      comboResult(pair.B);

    const returnA =
      ra.win
        ? stakeA*ra.odds
        : 0;

    const returnB =
      rb.win
        ? stakeB*rb.odds
        : 0;

    const dayReturn =
      returnA+returnB;

    const net =
      dayReturn-totalStake;

    invested += totalStake;
    returned += dayReturn;

    bankroll += net;

    totalAOdds +=
      productOdds(pair.A);

    totalBOdds +=
      productOdds(pair.B);

    /*
      Nested 구조라 B만 단독 적중은
      논리적으로 발생할 수 없다.
    */
    if (ra.win && rb.win) {
      both++;
    }
    else if (ra.win) {
      onlyA++;

      const recovery =
        returnA/totalStake;

      totalAOnlyRecovery +=
        recovery;

      if (recovery >= 1) {
        aOnlyBreakEven++;
      }
    }
    else {
      neither++;
    }

    if (net < 0) {
      loseStreak++;

      maxLoseStreak =
        Math.max(
          maxLoseStreak,
          loseStreak
        );
    }
    else {
      loseStreak = 0;
    }

    peak =
      Math.max(
        peak,
        bankroll
      );

    const dd =
      peak > 0
        ? (peak-bankroll)/peak
        : 0;

    maxDD =
      Math.max(
        maxDD,
        dd
      );

    const month =
      date.slice(0,7);

    if (!months.has(month)) {
      months.set(
        month,
        {
          days:0,
          invested:0,
          returned:0,
          profit:0
        }
      );
    }

    const m =
      months.get(month);

    m.days++;
    m.invested += totalStake;
    m.returned += dayReturn;
    m.profit += net;
  }

  const monthly =
    [...months.entries()]
      .map(
        ([month,x]) => ({
          month,
          days:x.days,
          invested:
            Math.round(
              x.invested
            ),
          returned:
            Math.round(
              x.returned
            ),
          profit:
            Math.round(
              x.profit
            ),
          roi:
            x.invested
              ? +(
                  x.profit/
                  x.invested*
                  100
                ).toFixed(2)
              : 0
        })
      );

  return {
    template,

    ratioMode:
      typeof ratioMode === "number"
        ? `${Math.round(ratioMode*100)}:${Math.round((1-ratioMode)*100)}`
        : ratioMode,

    activeDays,

    both,
    onlyA,
    neither,

    avgARatio:
      activeDays
        ? +(
            totalARatio/
            activeDays*
            100
          ).toFixed(1)
        : 0,

    avgAOdds:
      activeDays
        ? +(
            totalAOdds/
            activeDays
          ).toFixed(3)
        : 0,

    avgBOdds:
      activeDays
        ? +(
            totalBOdds/
            activeDays
          ).toFixed(3)
        : 0,

    aOnlyAvgRecoveryPct:
      onlyA
        ? +(
            totalAOnlyRecovery/
            onlyA*
            100
          ).toFixed(1)
        : 0,

    aOnlyBreakEvenPct:
      onlyA
        ? +(
            aOnlyBreakEven/
            onlyA*
            100
          ).toFixed(1)
        : 0,

    invested:
      Math.round(invested),

    returned:
      Math.round(returned),

    profit:
      Math.round(
        returned-invested
      ),

    roi:
      invested
        ? +(
            (returned-invested)/
            invested*
            100
          ).toFixed(2)
        : 0,

    finalBankroll:
      Math.round(bankroll),

    MDD:
      +(maxDD*100)
        .toFixed(2),

    maxLoseStreak,

    negativeMonths:
      monthly.filter(
        x => x.profit < 0
      ).length,

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

const templates = [
  "TOTAL_ML",
  "TOTAL_HANDICAP",
  "ML_ML_TOTAL",
  "ANY"
];

const fixedRatios = [];

for (
  let p=30;
  p<=90;
  p+=5
) {
  fixedRatios.push(p/100);
}

function objective(x) {
  if (x.activeDays < 10) {
    return -999999;
  }

  return (
    x.roi -
    x.MDD*0.35 -
    x.negativeMonths*2
  );
}

const output = [];

console.log(
  "============================================================"
);

console.log(
  "KBO NESTED TWO-TICKET V1.4"
);

console.log(
  "A=2 legs / B=A same 2 legs + 1 extra"
);

console.log(
  "Initial:",
  INITIAL_BANKROLL,
  "/ Daily:",
  DAILY_INVESTMENT
);

console.log(
  "============================================================"
);

for (const template of templates) {

  /*
    고정 비율은 TRAIN에서만 최적화
  */
  const fixedTrain =
    fixedRatios
      .map(r =>
        simulate(
          train,
          template,
          r
        )
      )
      .sort(
        (a,b) =>
          objective(b) -
          objective(a)
      );

  const bestFixed =
    fixedTrain[0];

  const fixedRatio =
    Number(
      bestFixed
        .ratioMode
        .split(":")[0]
    )/100;

  const fixedValid =
    simulate(
      valid,
      template,
      fixedRatio
    );

  /*
    RECOVERY는 공식 자체를
    TRAIN/VALID 동일하게 적용.
  */
  const recoveryTrain =
    simulate(
      train,
      template,
      "RECOVERY"
    );

  const recoveryValid =
    simulate(
      valid,
      template,
      "RECOVERY"
    );

  console.log();
  console.log(
    `===== ${template} =====`
  );

  console.log(
    "TRAIN BEST FIXED"
  );

  console.table([{
    ratio:
      bestFixed.ratioMode,
    days:
      bestFixed.activeDays,
    both:
      bestFixed.both,
    onlyA:
      bestFixed.onlyA,
    fail:
      bestFixed.neither,
    avgAOdds:
      bestFixed.avgAOdds,
    avgBOdds:
      bestFixed.avgBOdds,
    AonlyRecovery:
      bestFixed.aOnlyAvgRecoveryPct,
    AonlyBE:
      bestFixed.aOnlyBreakEvenPct,
    profit:
      bestFixed.profit,
    roi:
      bestFixed.roi,
    final:
      bestFixed.finalBankroll,
    MDD:
      bestFixed.MDD,
    loseStreak:
      bestFixed.maxLoseStreak,
    negMonths:
      bestFixed.negativeMonths
  }]);

  console.log(
    "VALID FIXED / FROZEN"
  );

  console.table([{
    ratio:
      fixedValid.ratioMode,
    days:
      fixedValid.activeDays,
    both:
      fixedValid.both,
    onlyA:
      fixedValid.onlyA,
    fail:
      fixedValid.neither,
    avgAOdds:
      fixedValid.avgAOdds,
    avgBOdds:
      fixedValid.avgBOdds,
    AonlyRecovery:
      fixedValid.aOnlyAvgRecoveryPct,
    AonlyBE:
      fixedValid.aOnlyBreakEvenPct,
    profit:
      fixedValid.profit,
    roi:
      fixedValid.roi,
    final:
      fixedValid.finalBankroll,
    MDD:
      fixedValid.MDD,
    loseStreak:
      fixedValid.maxLoseStreak,
    negMonths:
      fixedValid.negativeMonths
  }]);

  console.log(
    "TRAIN RECOVERY"
  );

  console.table([{
    avgRatio:
      `${recoveryTrain.avgARatio}% A`,
    days:
      recoveryTrain.activeDays,
    both:
      recoveryTrain.both,
    onlyA:
      recoveryTrain.onlyA,
    fail:
      recoveryTrain.neither,
    avgAOdds:
      recoveryTrain.avgAOdds,
    avgBOdds:
      recoveryTrain.avgBOdds,
    AonlyRecovery:
      recoveryTrain.aOnlyAvgRecoveryPct,
    AonlyBE:
      recoveryTrain.aOnlyBreakEvenPct,
    profit:
      recoveryTrain.profit,
    roi:
      recoveryTrain.roi,
    final:
      recoveryTrain.finalBankroll,
    MDD:
      recoveryTrain.MDD
  }]);

  console.log(
    "VALID RECOVERY"
  );

  console.table([{
    avgRatio:
      `${recoveryValid.avgARatio}% A`,
    days:
      recoveryValid.activeDays,
    both:
      recoveryValid.both,
    onlyA:
      recoveryValid.onlyA,
    fail:
      recoveryValid.neither,
    avgAOdds:
      recoveryValid.avgAOdds,
    avgBOdds:
      recoveryValid.avgBOdds,
    AonlyRecovery:
      recoveryValid.aOnlyAvgRecoveryPct,
    AonlyBE:
      recoveryValid.aOnlyBreakEvenPct,
    profit:
      recoveryValid.profit,
    roi:
      recoveryValid.roi,
    final:
      recoveryValid.finalBankroll,
    MDD:
      recoveryValid.MDD
  }]);

  console.log(
    "VALID MONTHLY - RECOVERY"
  );

  console.table(
    recoveryValid.monthly
  );

  output.push({
    template,
    bestFixedTrain:
      bestFixed,
    fixedValidation:
      fixedValid,
    recoveryTrain,
    recoveryValidation:
      recoveryValid
  });
}

fs.writeFileSync(
  "data/kbo-nested-v14.json",
  JSON.stringify(
    {
      generatedAt:
        new Date().toISOString(),
      initialBankroll:
        INITIAL_BANKROLL,
      dailyInvestment:
        DAILY_INVESTMENT,
      structure:
        "A=2 / B=A+1",
      output
    },
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-nested-v14.json"
);

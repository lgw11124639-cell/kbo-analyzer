const fs = require("fs");

const INPUT =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw = JSON.parse(
  fs.readFileSync(INPUT, "utf8")
);

const rows = (raw.results || raw)
  .filter(x =>
    ["WIN", "LOSS", "VOID"].includes(x.result) &&
    Number.isFinite(Number(x.odds)) &&
    Number(x.odds) > 1 &&
    Number.isFinite(Number(x.confidence)) &&
    Number.isFinite(Number(x.ev))
  )
  .map(x => ({
    ...x,
    odds: Number(x.odds),
    confidence: Number(x.confidence),
    ev: Number(x.ev),
  }));

const TRAIN_END = "2026-06-30";
const VALID_START = "2026-07-01";

const INITIAL_BANKROLL = 1000000;

/*
  우선 하루 총 투자금은 시작자금의 5% = 50,000원으로 고정.
  비율 비교가 목적.

  이후 결과가 괜찮으면
  bankroll 연동 % staking을 따로 돌린다.
*/
const DAILY_INVESTMENT = 50000;

/*
  V1.3 후보 범위.
  이전 role-supply 실험에서 공급량을 확보했던 범위를 사용하되
  조합 자체의 점수로 순위를 정한다.
*/
function eligible(x) {
  return (
    x.ev >= -0.03 &&
    x.ev <= 0.15 &&
    x.confidence >= 0.40 &&
    x.odds >= 1.20
  );
}

function gradeValue(x) {
  const g = String(x.grade || "").toUpperCase();
  if (g === "A") return 3;
  if (g === "B") return 2;
  return 1;
}

function pickScore(x) {
  const ev = Math.max(-0.30, Math.min(0.35, x.ev));

  return (
    x.confidence * 0.72 +
    ev * 0.18 +
    gradeValue(x) * 0.035
  );
}

function pickKey(x) {
  return `${x.gameId}:${x.market}:${x.label}`;
}

function samePick(a,b) {
  return pickKey(a) === pickKey(b);
}

/*
  실제 analyzer의 동일경기 규칙 재현.

  허용:
  ML + TOTAL
  HANDICAP + TOTAL

  금지:
  ML + HANDICAP
  동일 시장 2개
  한 경기 3픽
*/
function canAdd(selected, next) {
  const sameGame =
    selected.filter(x => x.gameId === next.gameId);

  if (sameGame.length >= 2) return false;

  if (
    sameGame.some(x => x.market === next.market)
  ) {
    return false;
  }

  const nextSide =
    next.market === "ML" ||
    next.market === "HANDICAP";

  const hasSide =
    sameGame.some(x =>
      x.market === "ML" ||
      x.market === "HANDICAP"
    );

  if (nextSide && hasSide) return false;

  return true;
}

function productOdds(picks) {
  return picks.reduce(
    (v,x) => v * x.odds,
    1
  );
}

function productProbability(picks) {
  return picks.reduce(
    (v,x) => v * x.confidence,
    1
  );
}

function averageConfidence(picks) {
  return picks.reduce(
    (v,x) => v + x.confidence,
    0
  ) / picks.length;
}

function averageEv(picks) {
  return picks.reduce(
    (v,x) => v + x.ev,
    0
  ) / picks.length;
}

/*
  A = 기본 회수용 2폴.
  기존 safeScore 계열.
*/
function scoreA(picks) {
  return (
    productProbability(picks) * 120 +
    averageConfidence(picks) * 45 +
    averageEv(picks) * 12 +
    picks.reduce(
      (s,x) => s + gradeValue(x) * 1.5,
      0
    )
  );
}

/*
  B는 폴 수가 늘어날수록 단순 확률만 보면
  항상 짧은/저배당 조합으로 쏠릴 수 있으므로
  확률 + 신뢰도 + EV + 실제 조합배당을 같이 평가.
*/
function scoreB(picks) {
  return (
    productProbability(picks) * 75 +
    averageConfidence(picks) * 42 +
    averageEv(picks) * 30 +
    Math.log(
      Math.max(1, productOdds(picks))
    ) * 5 +
    picks.reduce(
      (s,x) => s + gradeValue(x),
      0
    )
  );
}

function buildCombos(dayRows, legs) {
  /*
    실제 analyzer처럼 한 경기에서 상위 3개 시장만.
  */
  const sorted =
    dayRows
      .filter(eligible)
      .sort((a,b) => pickScore(b) - pickScore(a));

  const gameCount = new Map();
  const pool = [];

  for (const x of sorted) {
    const n = gameCount.get(x.gameId) || 0;

    if (n < 3) {
      pool.push(x);
      gameCount.set(x.gameId, n + 1);
    }
  }

  const out = [];
  const MAX = 15000;

  function visit(index, selected) {
    if (out.length >= MAX) return;

    if (selected.length === legs) {
      out.push([...selected]);
      return;
    }

    if (index >= pool.length) return;

    if (
      pool.length - index <
      legs - selected.length
    ) {
      return;
    }

    const next = pool[index];

    if (canAdd(selected,next)) {
      selected.push(next);
      visit(index + 1, selected);
      selected.pop();
    }

    visit(index + 1, selected);
  }

  visit(0,[]);

  const unique = new Map();

  for (const picks of out) {
    const key =
      picks
        .map(pickKey)
        .sort()
        .join("|");

    unique.set(key,picks);
  }

  return [...unique.values()];
}

function overlapCount(a,b) {
  const keys =
    new Set(a.map(pickKey));

  return b.filter(x =>
    keys.has(pickKey(x))
  ).length;
}

function comboResult(picks) {
  /*
    VOID는 배당 1로 처리.
    LOSS 하나라도 있으면 조합 실패.
  */
  if (
    picks.some(x => x.result === "LOSS")
  ) {
    return {
      win:false,
      effectiveOdds:0,
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

  return {
    win:true,
    effectiveOdds,
  };
}

function choosePair(
  dayRows,
  bLegs,
  overlapMode
) {
  const aCombos =
    buildCombos(dayRows,2)
      .sort(
        (a,b) =>
          scoreA(b) - scoreA(a)
      );

  const bCombos =
    buildCombos(dayRows,bLegs)
      .sort(
        (a,b) =>
          scoreB(b) - scoreB(a)
      );

  if (!aCombos.length || !bCombos.length) {
    return null;
  }

  /*
    A는 가장 강한 2폴.
  */
  const A = aCombos[0];

  const aKey =
    A.map(pickKey)
      .sort()
      .join("|");

  let candidates =
    bCombos.filter(B => {
      const bKey =
        B.map(pickKey)
          .sort()
          .join("|");

      /*
        안전형 2+2에서 완전히 같은 조합 방지.
      */
      return bKey !== aKey;
    });

  if (!candidates.length) return null;

  if (overlapMode === "ZERO_OVERLAP") {
    candidates =
      candidates.filter(
        B => overlapCount(A,B) === 0
      );

    if (!candidates.length) return null;

    return {
      A,
      B:candidates[0],
    };
  }

  /*
    MIN_OVERLAP:
    중복 픽 수가 가장 적은 조합 우선,
    동률이면 B score.
  */
  candidates.sort((x,y) => {
    const ox = overlapCount(A,x);
    const oy = overlapCount(A,y);

    if (ox !== oy) return ox - oy;

    return scoreB(y) - scoreB(x);
  });

  return {
    A,
    B:candidates[0],
  };
}

function groupByDate(rows) {
  const m = new Map();

  for (const x of rows) {
    if (!m.has(x.date)) {
      m.set(x.date,[]);
    }

    m.get(x.date).push(x);
  }

  return [...m.entries()]
    .sort((a,b) =>
      a[0].localeCompare(b[0])
    );
}

function simulate(
  sourceRows,
  profile,
  overlapMode,
  aRatio
) {
  const bLegs =
    profile === "SAFE"
      ? 2
      : profile === "BALANCED"
        ? 3
        : 4;

  let bankroll =
    INITIAL_BANKROLL;

  let peak = bankroll;
  let maxDD = 0;

  let invested = 0;
  let returned = 0;

  let activeDays = 0;

  let bothWin = 0;
  let onlyA = 0;
  let onlyB = 0;
  let bothLose = 0;

  let losingStreak = 0;
  let maxLosingStreak = 0;

  let totalOverlap = 0;

  const months = new Map();

  for (const [date,dayRows] of groupByDate(sourceRows)) {
    const pair =
      choosePair(
        dayRows,
        bLegs,
        overlapMode
      );

    if (!pair) continue;

    activeDays++;

    const availableStake =
      Math.min(
        DAILY_INVESTMENT,
        bankroll
      );

    if (availableStake <= 0) break;

    const stakeA =
      Math.round(
        availableStake * aRatio
      );

    const stakeB =
      availableStake - stakeA;

    const ra =
      comboResult(pair.A);

    const rb =
      comboResult(pair.B);

    const returnA =
      ra.win
        ? stakeA * ra.effectiveOdds
        : 0;

    const returnB =
      rb.win
        ? stakeB * rb.effectiveOdds
        : 0;

    const dayReturn =
      returnA + returnB;

    const dayNet =
      dayReturn -
      availableStake;

    bankroll += dayNet;

    invested += availableStake;
    returned += dayReturn;

    totalOverlap +=
      overlapCount(pair.A,pair.B);

    if (ra.win && rb.win) {
      bothWin++;
    } else if (ra.win) {
      onlyA++;
    } else if (rb.win) {
      onlyB++;
    } else {
      bothLose++;
    }

    if (dayNet < 0) {
      losingStreak++;
      maxLosingStreak =
        Math.max(
          maxLosingStreak,
          losingStreak
        );
    } else {
      losingStreak = 0;
    }

    peak =
      Math.max(peak,bankroll);

    const dd =
      peak > 0
        ? (peak-bankroll)/peak
        : 0;

    maxDD =
      Math.max(maxDD,dd);

    const month =
      date.slice(0,7);

    if (!months.has(month)) {
      months.set(
        month,
        {
          invested:0,
          returned:0,
          profit:0,
          days:0,
        }
      );
    }

    const mm = months.get(month);

    mm.invested += availableStake;
    mm.returned += dayReturn;
    mm.profit += dayNet;
    mm.days++;
  }

  const monthly =
    [...months.entries()]
      .map(([month,x]) => ({
        month,
        days:x.days,
        invested:Math.round(x.invested),
        returned:Math.round(x.returned),
        profit:Math.round(x.profit),
        roi:
          x.invested
            ? +(
                x.profit /
                x.invested *
                100
              ).toFixed(2)
            : 0,
      }));

  const negativeMonths =
    monthly.filter(
      x => x.profit < 0
    ).length;

  /*
    한쪽만 적중한 날 중
    하루 전체 투자금 이상 회수한 비율.
  */
  let oneHitDays =
    onlyA + onlyB;

  /*
    상세 recovery는 아래 별도 재시뮬레이션에서 계산.
  */
  return {
    profile,
    overlapMode,
    aRatio:+(aRatio*100).toFixed(0),
    bRatio:+((1-aRatio)*100).toFixed(0),

    activeDays,

    bothWin,
    onlyA,
    onlyB,
    bothLose,

    oneHitDays,

    avgOverlap:
      activeDays
        ? +(totalOverlap/activeDays)
            .toFixed(2)
        : 0,

    invested:
      Math.round(invested),

    returned:
      Math.round(returned),

    profit:
      Math.round(returned-invested),

    roi:
      invested
        ? +(
            (returned-invested) /
            invested *
            100
          ).toFixed(2)
        : 0,

    finalBankroll:
      Math.round(bankroll),

    maxDD:
      +(maxDD*100).toFixed(2),

    maxLosingStreak,

    negativeMonths,

    monthly,
  };
}

/*
  TRAIN / VALID 분리
*/
const train =
  rows.filter(
    x =>
      x.date >= "2026-03-28" &&
      x.date <= TRAIN_END
  );

const valid =
  rows.filter(
    x => x.date >= VALID_START
  );

const profiles =
  ["SAFE","BALANCED","AGGRESSIVE"];

const modes =
  ["MIN_OVERLAP","ZERO_OVERLAP"];

const ratios = [];

for (let p=10; p<=90; p+=5) {
  ratios.push(p/100);
}

/*
  TRAIN에서만 비율 선택.

  단순 ROI 최고 하나가 아니라
  ROI - MDD 패널티 - 음수월 패널티를 사용.
*/
function objective(x) {
  if (x.activeDays < 10) {
    return -999999;
  }

  return (
    x.roi
    - x.maxDD * 0.35
    - x.negativeMonths * 2
  );
}

const chosen = [];

console.log(
  "============================================================"
);
console.log(
  "KBO TWO-COMBO PORTFOLIO V1.3"
);
console.log(
  "SAFE=2+2 / BALANCED=2+3 / AGGRESSIVE=2+4"
);
console.log(
  "Initial bankroll:",
  INITIAL_BANKROLL
);
console.log(
  "Daily investment:",
  DAILY_INVESTMENT
);
console.log(
  "============================================================"
);

for (const profile of profiles) {
  for (const mode of modes) {
    const trainRuns =
      ratios.map(r =>
        simulate(
          train,
          profile,
          mode,
          r
        )
      );

    trainRuns.sort(
      (a,b) =>
        objective(b) -
        objective(a)
    );

    const best =
      trainRuns[0];

    const validation =
      simulate(
        valid,
        profile,
        mode,
        best.aRatio/100
      );

    chosen.push({
      profile,
      mode,
      train:best,
      validation,
    });

    console.log();
    console.log(
      `===== ${profile} / ${mode} =====`
    );

    console.log();
    console.log("TRAIN BEST");
    console.table([{
      A_B:
        `${best.aRatio}:${best.bRatio}`,
      days:best.activeDays,
      both:best.bothWin,
      onlyA:best.onlyA,
      onlyB:best.onlyB,
      fail:best.bothLose,
      overlap:best.avgOverlap,
      profit:best.profit,
      roi:best.roi,
      final:best.finalBankroll,
      MDD:best.maxDD,
      loseStreak:best.maxLosingStreak,
      negMonths:best.negativeMonths,
    }]);

    console.log("VALIDATION FROZEN");
    console.table([{
      A_B:
        `${validation.aRatio}:${validation.bRatio}`,
      days:validation.activeDays,
      both:validation.bothWin,
      onlyA:validation.onlyA,
      onlyB:validation.onlyB,
      fail:validation.bothLose,
      overlap:validation.avgOverlap,
      profit:validation.profit,
      roi:validation.roi,
      final:validation.finalBankroll,
      MDD:validation.maxDD,
      loseStreak:
        validation.maxLosingStreak,
      negMonths:
        validation.negativeMonths,
    }]);

    console.log("VALIDATION MONTHLY");
    console.table(
      validation.monthly
    );
  }
}

fs.writeFileSync(
  "data/kbo-two-combo-v13.json",
  JSON.stringify(
    {
      generatedAt:
        new Date().toISOString(),
      initialBankroll:
        INITIAL_BANKROLL,
      dailyInvestment:
        DAILY_INVESTMENT,
      chosen,
    },
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-two-combo-v13.json"
);

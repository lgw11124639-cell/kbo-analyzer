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

function gradeValue(x) {
  const g =
    String(x.grade || "")
      .toUpperCase();

  if (g === "A") return 3;
  if (g === "B") return 2;
  return 1;
}

/*
  ==========================================================
  후보군
  ==========================================================

  이번엔 UNDER를 양수 EV라는 이유만으로 자동 포함하지 않는다.

  지금까지 상대적으로 볼 가치가 있었던:
  - OVER EV 3~10
  - HANDICAP EV 3~10
  - ML EV 3~10
  - ML confidence 55+ + EV >= 0
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

  if (
    isOver(x) &&
    ev >= 3 &&
    ev < 10
  ) {
    return true;
  }

  if (
    x.market === "HANDICAP" &&
    ev >= 3 &&
    ev < 10
  ) {
    return true;
  }

  if (
    x.market === "ML" &&
    ev >= 3 &&
    ev < 10
  ) {
    return true;
  }

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
  과거 결과를 직접 점수에 넣지 않는다.

  confidence 중심 +
  EV 보조 +
  grade 보조 +
  검증된 영역 약한 보너스.
*/
function score(x) {
  const ev =
    evOf(x) ?? -30;

  const conf =
    confOf(x) ?? 0;

  let s =
    conf * 1.00 +
    ev * 0.75 +
    gradeValue(x) * 2;

  if (
    isOver(x) &&
    ev >= 3 &&
    ev < 10
  ) {
    s += 4;
  }

  if (
    x.market === "HANDICAP" &&
    ev >= 3 &&
    ev < 10
  ) {
    s += 2;
  }

  if (
    x.market === "ML" &&
    conf >= 55
  ) {
    s += 2;
  }

  /*
    고배당을 무조건 상위로 올리지 않음.
  */
  if (x.odds > 2.20) {
    s -=
      (x.odds - 2.20) * 4;
  }

  return s;
}

function groupByDate(source) {
  const map =
    new Map();

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

function settleSingle(x) {
  if (x.result === "WIN") {
    return STAKE * x.odds;
  }

  if (x.result === "VOID") {
    return STAKE;
  }

  return 0;
}

function stat(list) {
  let wins = 0;
  let losses = 0;
  let voids = 0;

  let returned = 0;
  let oddsSum = 0;

  let loseStreak = 0;
  let maxLoseStreak = 0;

  const monthly =
    new Map();

  for (const x of list) {
    const ret =
      settleSingle(x);

    returned += ret;
    oddsSum += x.odds;

    if (x.result === "WIN") {
      wins++;
      loseStreak = 0;
    }
    else if (x.result === "VOID") {
      voids++;
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
      x.date.slice(0,7);

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

    if (x.result === "WIN") m.wins++;
    if (x.result === "LOSS") m.losses++;
    if (x.result === "VOID") m.voids++;
  }

  const invested =
    list.length *
    STAKE;

  const profit =
    returned -
    invested;

  const settled =
    wins +
    losses;

  const monthlyRows =
    [...monthly.values()]
      .map(m => {
        const p =
          m.returned -
          m.invested;

        return {
          ...m,

          hit:
            m.wins + m.losses
              ? +(
                  m.wins /
                  (m.wins + m.losses) *
                  100
                ).toFixed(2)
              : 0,

          profit:
            Math.round(p),

          roi:
            m.invested
              ? +(
                  p /
                  m.invested *
                  100
                ).toFixed(2)
              : 0
        };
      });

  return {
    bets:
      list.length,

    wins,
    losses,
    voids,

    hit:
      settled
        ? +(
            wins /
            settled *
            100
          ).toFixed(2)
        : 0,

    avgOdds:
      list.length
        ? +(
            oddsSum /
            list.length
          ).toFixed(3)
        : 0,

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

    maxLoseStreak,

    negativeMonths:
      monthlyRows.filter(
        x => x.profit < 0
      ).length,

    monthly:
      monthlyRows
  };
}

/*
  rank=1 => 하루 TOP1
  rank=2 => 하루 두 번째 픽만
  topN=2 => 하루 TOP1 + TOP2 모두 단일 베팅
*/
function selectRank(source,rank) {
  const out = [];

  for (
    const [,dayRows]
    of groupByDate(source)
  ) {
    const pool =
      dayRows
        .filter(eligible)
        .sort(
          (a,b) =>
            score(b) -
            score(a)
        );

    if (
      pool.length >= rank
    ) {
      out.push(
        pool[rank-1]
      );
    }
  }

  return out;
}

function selectTopN(source,n) {
  const out = [];

  for (
    const [,dayRows]
    of groupByDate(source)
  ) {
    const pool =
      dayRows
        .filter(eligible)
        .sort(
          (a,b) =>
            score(b) -
            score(a)
        );

    out.push(
      ...pool.slice(0,n)
    );
  }

  return out;
}

function marketLabel(x) {
  if (isOver(x)) {
    return "OVER";
  }

  if (isUnder(x)) {
    return "UNDER";
  }

  if (x.market === "HANDICAP") {
    return "HANDI";
  }

  return x.market;
}

function evaluatePeriod(source) {
  const top1 =
    selectRank(
      source,
      1
    );

  const rank2 =
    selectRank(
      source,
      2
    );

  const top2All =
    selectTopN(
      source,
      2
    );

  const top3All =
    selectTopN(
      source,
      3
    );

  return {
    top1:{
      stat:stat(top1),
      picks:top1
    },

    rank2:{
      stat:stat(rank2),
      picks:rank2
    },

    top2All:{
      stat:stat(top2All),
      picks:top2All
    },

    top3All:{
      stat:stat(top3All),
      picks:top3All
    }
  };
}

const discRows =
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
  evaluatePeriod(
    discRows
  );

const internal =
  evaluatePeriod(
    internalRows
  );

console.log(
  "============================================================"
);

console.log(
  "KBO SINGLE PICK SELECTOR V2.0"
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

function row(
  period,
  name,
  x
) {
  return {
    period,
    selector:name,

    bets:
      x.bets,

    wins:
      x.wins,

    losses:
      x.losses,

    hit:
      x.hit,

    odds:
      x.avgOdds,

    profit:
      x.profit,

    roi:
      x.roi,

    lose:
      x.maxLoseStreak,

    negM:
      x.negativeMonths
  };
}

console.log();
console.log(
  "===== SELECTOR PERFORMANCE ====="
);

console.table([
  row(
    "DISCOVERY",
    "TOP1",
    discovery.top1.stat
  ),

  row(
    "DISCOVERY",
    "RANK2",
    discovery.rank2.stat
  ),

  row(
    "DISCOVERY",
    "TOP1+2 singles",
    discovery.top2All.stat
  ),

  row(
    "DISCOVERY",
    "TOP1+2+3 singles",
    discovery.top3All.stat
  ),

  row(
    "INTERNAL",
    "TOP1",
    internal.top1.stat
  ),

  row(
    "INTERNAL",
    "RANK2",
    internal.rank2.stat
  ),

  row(
    "INTERNAL",
    "TOP1+2 singles",
    internal.top2All.stat
  ),

  row(
    "INTERNAL",
    "TOP1+2+3 singles",
    internal.top3All.stat
  )
]);

console.log();
console.log(
  "===== TOP1 MONTHLY ====="
);

console.log(
  "DISCOVERY"
);

console.table(
  discovery.top1.stat.monthly
);

console.log(
  "INTERNAL"
);

console.table(
  internal.top1.stat.monthly
);

console.log();
console.log(
  "===== RANK2 MONTHLY ====="
);

console.log(
  "DISCOVERY"
);

console.table(
  discovery.rank2.stat.monthly
);

console.log(
  "INTERNAL"
);

console.table(
  internal.rank2.stat.monthly
);

/*
  TOP1, RANK2 둘 다
  각 기간에서 플러스여야
  2폴 조합의 재료로 볼 가치가 있음.
*/
const passed =
  discovery.top1.stat.bets >= 8 &&
  internal.top1.stat.bets >= 8 &&

  discovery.rank2.stat.bets >= 4 &&
  internal.rank2.stat.bets >= 4 &&

  discovery.top1.stat.roi > 0 &&
  internal.top1.stat.roi > 0 &&

  discovery.rank2.stat.roi > 0 &&
  internal.rank2.stat.roi > 0;

console.log();
console.log(
  "============================================================"
);

console.log(
  "V2.0 SELECTOR PASS:",
  passed
    ? "YES"
    : "NO"
);

console.log(
  "DISC TOP1:",
  discovery.top1.stat.bets,
  "ROI",
  discovery.top1.stat.roi
);

console.log(
  "INT TOP1:",
  internal.top1.stat.bets,
  "ROI",
  internal.top1.stat.roi
);

console.log(
  "DISC RANK2:",
  discovery.rank2.stat.bets,
  "ROI",
  discovery.rank2.stat.roi
);

console.log(
  "INT RANK2:",
  internal.rank2.stat.bets,
  "ROI",
  internal.rank2.stat.roi
);

console.log(
  "============================================================"
);

console.log();
console.log(
  "===== INTERNAL TOP1 PICKS ====="
);

console.table(
  internal.top1.picks
    .map(x => ({
      date:
        x.date,

      market:
        marketLabel(x),

      pick:
        x.label,

      odds:
        x.odds,

      ev:
        +(evOf(x) ?? 0)
          .toFixed(2),

      conf:
        +(confOf(x) ?? 0)
          .toFixed(2),

      grade:
        x.grade,

      score:
        +score(x)
          .toFixed(2),

      result:
        x.result
    }))
);

console.log();
console.log(
  "===== INTERNAL RANK2 PICKS ====="
);

console.table(
  internal.rank2.picks
    .map(x => ({
      date:
        x.date,

      market:
        marketLabel(x),

      pick:
        x.label,

      odds:
        x.odds,

      ev:
        +(evOf(x) ?? 0)
          .toFixed(2),

      conf:
        +(confOf(x) ?? 0)
          .toFixed(2),

      grade:
        x.grade,

      score:
        +score(x)
          .toFixed(2),

      result:
        x.result
    }))
);

fs.writeFileSync(
  "data/kbo-single-selector-v20.json",
  JSON.stringify(
    {
      generatedAt:
        new Date()
          .toISOString(),

      final:
        "LOCKED",

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
  "SAVED: data/kbo-single-selector-v20.json"
);

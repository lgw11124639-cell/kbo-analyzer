const fs = require("fs");

const FILE =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const j = JSON.parse(
  fs.readFileSync(FILE, "utf8")
);

const rows = j.results.filter(
  x =>
    (x.result === "WIN" || x.result === "LOSS") &&
    Number.isFinite(x.odds) &&
    x.odds > 1 &&
    Number.isFinite(x.confidence) &&
    Number.isFinite(x.ev)
);

const TRAIN_END = "2026-06-30";
const VALID_START = "2026-07-01";

function splitRows(list) {
  return {
    TRAIN: list.filter(x => x.date <= TRAIN_END),
    VALID: list.filter(x => x.date >= VALID_START),
  };
}

function label(x) {
  return String(x.label ?? "").toUpperCase();
}

function isOver(x) {
  return (
    x.market === "TOTAL" &&
    (
      label(x).includes("OVER") ||
      label(x).includes("오버")
    )
  );
}

/*
  V1.3에서는 하드 역할필터가 아니라
  "넓은 입장조건 + 역할 점수" 방식으로 테스트.

  결과를 보고 조정할 것이므로
  production analyzer에는 절대 반영하지 않는다.
*/

function eligibleDefense(x) {
  return (
    x.ev >= -0.03 &&
    x.ev <= 0.10 &&
    x.confidence >= 0.50 &&
    x.odds >= 1.20 &&
    x.odds <= 2.20
  );
}

function defenseScore(x) {
  let score = 0;

  score += x.confidence * 100 * 1.20;
  score += x.ev * 100 * 0.35;

  /*
    너무 낮은 배당도,
    너무 높은 배당도 방어에서는 감점.
    1.70 부근을 중심으로 본다.
  */
  score -= Math.abs(x.odds - 1.70) * 10;

  if (isOver(x)) {
    score += 5;
  }

  return score;
}

function eligibleBalance(x) {
  return (
    x.ev >= 0 &&
    x.ev <= 0.10 &&
    x.confidence >= 0.48 &&
    x.odds >= 1.40 &&
    x.odds <= 2.50
  );
}

function balanceScore(x) {
  let score = 0;

  score += x.confidence * 100 * 0.75;
  score += x.ev * 100 * 0.80;

  score -= Math.abs(x.odds - 1.90) * 5;

  return score;
}

function eligibleAttack(x) {
  return (
    x.ev >= 0.03 &&
    x.ev <= 0.15 &&
    x.confidence >= 0.40 &&
    x.odds >= 1.70
  );
}

function attackScore(x) {
  let score = 0;

  score += x.ev * 100 * 0.90;
  score += x.confidence * 100 * 0.40;
  score += Math.log(Math.max(1, x.odds)) * 12;

  if (x.market === "HANDICAP") {
    score += 4;
  }

  if (x.odds >= 2.50) {
    score += 4;
  }

  return score;
}

const roles = {
  DEFENSE: {
    eligible: eligibleDefense,
    score: defenseScore,
  },

  BALANCE: {
    eligible: eligibleBalance,
    score: balanceScore,
  },

  ATTACK: {
    eligible: eligibleAttack,
    score: attackScore,
  },
};

function stat(list) {
  const wins =
    list.filter(x => x.result === "WIN").length;

  const stake = list.length * 10000;

  const returned =
    list.reduce(
      (sum, x) =>
        sum +
        (
          x.result === "WIN"
            ? 10000 * x.odds
            : 0
        ),
      0
    );

  const profit = returned - stake;

  return {
    bets: list.length,

    wins,

    losses:
      list.length - wins,

    hitRate:
      list.length
        ? Number(
            (
              wins /
              list.length *
              100
            ).toFixed(2)
          )
        : 0,

    avgOdds:
      list.length
        ? Number(
            (
              list.reduce(
                (s, x) => s + x.odds,
                0
              ) /
              list.length
            ).toFixed(3)
          )
        : 0,

    profit:
      Math.round(profit),

    roi:
      stake
        ? Number(
            (
              profit /
              stake *
              100
            ).toFixed(2)
          )
        : 0,
  };
}

function groupDates(list) {
  const map = new Map();

  for (const x of list) {
    if (!map.has(x.date)) {
      map.set(x.date, []);
    }

    map.get(x.date).push(x);
  }

  return map;
}

function supply(roleRows, allPeriodRows) {
  const byDate = groupDates(roleRows);

  const allDates =
    [...new Set(
      allPeriodRows.map(x => x.date)
    )];

  let d1 = 0;
  let d2 = 0;
  let d3 = 0;

  let totalCandidates = 0;

  for (const date of allDates) {
    const count =
      byDate.get(date)?.length ?? 0;

    totalCandidates += count;

    if (count >= 1) d1++;
    if (count >= 2) d2++;
    if (count >= 3) d3++;
  }

  return {
    gameDays: allDates.length,

    days1plus: d1,
    days2plus: d2,
    days3plus: d3,

    avgCandidatesPerDay:
      allDates.length
        ? Number(
            (
              totalCandidates /
              allDates.length
            ).toFixed(2)
          )
        : 0,
  };
}

function topPerDay(list, role, limit = 3) {
  const byDate = groupDates(list);
  const out = [];

  for (const [, dayRows] of byDate) {
    dayRows.sort(
      (a, b) =>
        roles[role].score(b) -
        roles[role].score(a)
    );

    out.push(
      ...dayRows.slice(0, limit)
    );
  }

  return out;
}

for (const [role, cfg] of Object.entries(roles)) {
  console.log();
  console.log(
    `================ ${role} ================`
  );

  const eligible =
    rows.filter(cfg.eligible);

  const split = splitRows(eligible);

  const allSplit = splitRows(rows);

  for (const period of ["TRAIN", "VALID"]) {
    const periodRows = split[period];

    console.log();
    console.log(`--- ${period} SUPPLY ---`);

    console.table([
      supply(
        periodRows,
        allSplit[period]
      ),
    ]);

    console.log(
      `--- ${period} ALL ELIGIBLE ---`
    );

    console.table([
      stat(periodRows),
    ]);

    /*
      실제 조합 생성에서는 점수 상위 후보가
      중요하므로 날짜별 TOP 1/2/3도 따로 확인.
    */

    for (const n of [1, 2, 3]) {
      const selected =
        topPerDay(
          periodRows,
          role,
          n
        );

      console.log(
        `--- ${period} TOP ${n}/DAY ---`
      );

      console.table([
        stat(selected),
      ]);
    }
  }
}

/*
  역할 간 중복 공급 확인
*/

function key(x) {
  return `${x.gameId}:${x.market}:${x.label}`;
}

console.log();
console.log(
  "================ ROLE OVERLAP ================"
);

for (const period of ["TRAIN", "VALID"]) {
  const periodRows =
    splitRows(rows)[period];

  const sets = {};

  for (const [role, cfg] of Object.entries(roles)) {
    sets[role] =
      new Set(
        periodRows
          .filter(cfg.eligible)
          .map(key)
      );
  }

  function overlap(a, b) {
    let n = 0;

    for (const k of sets[a]) {
      if (sets[b].has(k)) n++;
    }

    return n;
  }

  console.table([
    {
      period,
      defense:
        sets.DEFENSE.size,
      balance:
        sets.BALANCE.size,
      attack:
        sets.ATTACK.size,

      defense_balance:
        overlap(
          "DEFENSE",
          "BALANCE"
        ),

      defense_attack:
        overlap(
          "DEFENSE",
          "ATTACK"
        ),

      balance_attack:
        overlap(
          "BALANCE",
          "ATTACK"
        ),
    },
  ]);
}

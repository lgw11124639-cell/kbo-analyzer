const fs = require("fs");

const FILE =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const j =
  JSON.parse(
    fs.readFileSync(FILE, "utf8")
  );

const all =
  j.results.filter(
    x =>
      x.result === "WIN" ||
      x.result === "LOSS"
  );

const STAKE = 10000;

function pct(v) {
  if (
    typeof v !== "number" ||
    !Number.isFinite(v)
  ) {
    return null;
  }

  return Math.abs(v) <= 1
    ? v * 100
    : v;
}

function evOf(x) {
  return pct(x.ev);
}

function confOf(x) {
  return pct(x.confidence);
}

function isBase(x) {
  const ev = evOf(x);

  return (
    ev !== null &&
    ev >= 3 &&
    ev < 10 &&
    typeof x.odds === "number" &&
    x.odds > 1
  );
}

function isOver(x) {
  if (x.market !== "TOTAL")
    return false;

  const label =
    String(x.label ?? "")
      .toUpperCase();

  return (
    label.includes("OVER") ||
    label.includes("오버")
  );
}

function isDefense(x) {
  return (
    isBase(x) &&
    isOver(x)
  );
}

function isAttack(x) {
  return (
    isBase(x) &&
    (
      x.market === "HANDICAP" ||
      x.odds >= 2.5
    )
  );
}

function isBalance(x) {
  return (
    isBase(x) &&
    !isDefense(x) &&
    !isAttack(x) &&
    x.odds >= 1.6 &&
    x.odds < 2.5
  );
}

/*
  역할별 정렬 점수.

  방어:
  적중 가능성과 과도하지 않은 배당 중심.

  균형:
  확률 + EV + 배당을 고르게.

  공격:
  EV + 고배당 중심.
*/
function defenseScore(x) {
  const conf =
    confOf(x) ?? 0;

  const ev =
    evOf(x) ?? 0;

  return (
    conf * 1.00 +
    ev * 0.35 -
    Math.abs(
      x.odds - 1.80
    ) * 8
  );
}

function balanceScore(x) {
  const conf =
    confOf(x) ?? 0;

  const ev =
    evOf(x) ?? 0;

  return (
    conf * 0.70 +
    ev * 0.70 +
    x.odds * 3
  );
}

function attackScore(x) {
  const conf =
    confOf(x) ?? 0;

  const ev =
    evOf(x) ?? 0;

  return (
    ev * 1.20 +
    x.odds * 8 +
    conf * 0.15
  );
}

function sortRole(rows, role) {
  const score =
    role === "DEFENSE"
      ? defenseScore
      : role === "BALANCE"
        ? balanceScore
        : attackScore;

  return [...rows]
    .sort(
      (a,b) =>
        score(b) -
        score(a)
    );
}

/*
  동일 경기에서는 한 픽만 허용.

  특정 역할 후보 자체에
  한 경기 여러 시장이 있을 경우
  역할 점수가 가장 높은 것만 남김.
*/
function uniqueGame(rows, role) {
  const sorted =
    sortRole(rows, role);

  const seen =
    new Set();

  const out = [];

  for (const x of sorted) {
    const key =
      String(x.gameId);

    if (seen.has(key))
      continue;

    seen.add(key);
    out.push(x);
  }

  return out;
}

function byDate(rows) {
  const map =
    new Map();

  for (const x of rows) {
    if (!map.has(x.date))
      map.set(x.date, []);

    map.get(x.date).push(x);
  }

  return map;
}

function rolePools(rows) {
  return {
    DEFENSE:
      uniqueGame(
        rows.filter(isDefense),
        "DEFENSE"
      ),

    BALANCE:
      uniqueGame(
        rows.filter(isBalance),
        "BALANCE"
      ),

    ATTACK:
      uniqueGame(
        rows.filter(isAttack),
        "ATTACK"
      ),
  };
}

/*
  roles 예:
  ["DEFENSE","BALANCE"]

  역할 순서대로 가장 좋은 후보를 고르되
  이미 사용한 경기는 제외.
*/
function makeCombo(
  pools,
  roles
) {
  const picks = [];
  const usedGames =
    new Set();

  for (const role of roles) {
    const pool =
      pools[role] ?? [];

    const candidate =
      pool.find(
        x =>
          !usedGames.has(
            String(x.gameId)
          )
      );

    if (!candidate)
      return null;

    picks.push({
      ...candidate,
      role,
    });

    usedGames.add(
      String(candidate.gameId)
    );
  }

  return picks;
}

function comboResult(
  date,
  profile,
  picks
) {
  if (!picks)
    return null;

  const odds =
    picks.reduce(
      (p,x) =>
        p * x.odds,
      1
    );

  const win =
    picks.every(
      x =>
        x.result === "WIN"
    );

  const returned =
    win
      ? STAKE * odds
      : 0;

  return {
    date,
    month:
      date.slice(0,7),

    profile,

    legs:
      picks.length,

    odds:
      Number(
        odds.toFixed(4)
      ),

    win,

    stake:
      STAKE,

    returned,

    profit:
      returned - STAKE,

    picks:
      picks.map(
        x => ({
          gameId:
            x.gameId,

          role:
            x.role,

          market:
            x.market,

          label:
            x.label,

          odds:
            x.odds,

          confidence:
            x.confidence,

          ev:
            x.ev,

          result:
            x.result,
        })
      ),
  };
}

const PROFILES = [
  {
    name:
      "2SAFE_DD",

    label:
      "2폴 안전형 방어+방어",

    roles:
      [
        "DEFENSE",
        "DEFENSE",
      ],
  },

  {
    name:
      "2BAL_DB",

    label:
      "2폴 균형형 방어+균형",

    roles:
      [
        "DEFENSE",
        "BALANCE",
      ],
  },

  {
    name:
      "2ATT_DA",

    label:
      "2폴 공격형 방어+공격",

    roles:
      [
        "DEFENSE",
        "ATTACK",
      ],
  },

  {
    name:
      "3SAFE_DDD",

    label:
      "3폴 안전형 방어+방어+방어",

    roles:
      [
        "DEFENSE",
        "DEFENSE",
        "DEFENSE",
      ],
  },

  {
    name:
      "3BAL_DDB",

    label:
      "3폴 균형형 방어+방어+균형",

    roles:
      [
        "DEFENSE",
        "DEFENSE",
        "BALANCE",
      ],
  },

  {
    name:
      "3ATT_DBA",

    label:
      "3폴 공격형 방어+균형+공격",

    roles:
      [
        "DEFENSE",
        "BALANCE",
        "ATTACK",
      ],
  },
];

function runPeriod(
  rows,
  start,
  end = "9999-12-31"
) {
  const period =
    rows.filter(
      x =>
        x.date >= start &&
        x.date <= end
    );

  const dates =
    byDate(period);

  const combos = [];

  const availability = [];

  for (
    const [date, dayRows]
    of [...dates.entries()]
      .sort(
        (a,b) =>
          a[0].localeCompare(b[0])
      )
  ) {
    const pools =
      rolePools(dayRows);

    availability.push({
      date,

      defense:
        pools.DEFENSE.length,

      balance:
        pools.BALANCE.length,

      attack:
        pools.ATTACK.length,
    });

    for (
      const profile of PROFILES
    ) {
      const picks =
        makeCombo(
          pools,
          profile.roles
        );

      const result =
        comboResult(
          date,
          profile.name,
          picks
        );

      if (result)
        combos.push(result);
    }
  }

  return {
    period,
    combos,
    availability,
  };
}

function comboStat(rows) {
  const wins =
    rows.filter(
      x => x.win
    ).length;

  const bets =
    rows.length;

  const stake =
    rows.reduce(
      (s,x) =>
        s + x.stake,
      0
    );

  const returned =
    rows.reduce(
      (s,x) =>
        s + x.returned,
      0
    );

  const profit =
    returned - stake;

  const avgOdds =
    bets
      ? rows.reduce(
          (s,x) =>
            s + x.odds,
          0
        ) / bets
      : 0;

  return {
    bets,

    wins,

    losses:
      bets - wins,

    hitRate:
      bets
        ? +(
            wins /
            bets *
            100
          ).toFixed(2)
        : 0,

    avgOdds:
      +avgOdds.toFixed(3),

    stake:
      Math.round(stake),

    returned:
      Math.round(returned),

    profit:
      Math.round(profit),

    roi:
      stake
        ? +(
            profit /
            stake *
            100
          ).toFixed(2)
        : 0,
  };
}

function singleStat(rows) {
  const wins =
    rows.filter(
      x =>
        x.result === "WIN"
    ).length;

  const bets =
    rows.length;

  const stake =
    bets * STAKE;

  const returned =
    rows.reduce(
      (s,x) =>
        s +
        (
          x.result === "WIN"
            ? STAKE * x.odds
            : 0
        ),
      0
    );

  const profit =
    returned - stake;

  return {
    bets,

    wins,

    losses:
      bets - wins,

    hitRate:
      bets
        ? +(
            wins /
            bets *
            100
          ).toFixed(2)
        : 0,

    avgOdds:
      bets
        ? +(
            rows.reduce(
              (s,x) =>
                s + x.odds,
              0
            ) /
            bets
          ).toFixed(3)
        : 0,

    profit:
      Math.round(profit),

    roi:
      stake
        ? +(
            profit /
            stake *
            100
          ).toFixed(2)
        : 0,
  };
}

function riskStat(rows) {
  const sorted =
    [...rows].sort(
      (a,b) =>
        a.date.localeCompare(
          b.date
        )
    );

  let bankroll =
    1000000;

  let peak =
    bankroll;

  let peakDate = null;

  let maxDd = 0;
  let maxDdPct = 0;

  let ddPeakDate = null;
  let ddBottomDate = null;

  let losingStreak = 0;
  let maxLosingStreak = 0;

  for (const x of sorted) {
    bankroll += x.profit;

    if (x.win) {
      losingStreak = 0;
    } else {
      losingStreak++;

      maxLosingStreak =
        Math.max(
          maxLosingStreak,
          losingStreak
        );
    }

    if (bankroll > peak) {
      peak =
        bankroll;

      peakDate =
        x.date;
    }

    const dd =
      peak - bankroll;

    const ddPct =
      peak > 0
        ? dd / peak * 100
        : 0;

    if (dd > maxDd) {
      maxDd = dd;
    }

    if (
      ddPct >
      maxDdPct
    ) {
      maxDdPct =
        ddPct;

      ddPeakDate =
        peakDate;

      ddBottomDate =
        x.date;
    }
  }

  return {
    start:
      1000000,

    end:
      Math.round(
        bankroll
      ),

    net:
      Math.round(
        bankroll -
        1000000
      ),

    maxDrawdown:
      Math.round(
        maxDd
      ),

    maxDrawdownPct:
      +maxDdPct.toFixed(2),

    maxLosingStreak,

    peakDate:
      ddPeakDate,

    bottomDate:
      ddBottomDate,
  };
}

function report(
  title,
  result
) {
  console.log();
  console.log();
  console.log(
    "=============================================="
  );
  console.log(title);
  console.log(
    "=============================================="
  );

  /*
    역할 원재료 픽 통계
  */
  console.log();
  console.log(
    "===== ROLE SINGLE PICK ====="
  );

  console.table([
    {
      role:
        "DEFENSE",

      ...singleStat(
        result.period.filter(
          isDefense
        )
      ),
    },

    {
      role:
        "BALANCE",

      ...singleStat(
        result.period.filter(
          isBalance
        )
      ),
    },

    {
      role:
        "ATTACK",

      ...singleStat(
        result.period.filter(
          isAttack
        )
      ),
    },
  ]);

  /*
    조합별
  */
  console.log();
  console.log(
    "===== COMBO PROFILE ====="
  );

  console.table(
    PROFILES.map(
      p => ({
        profile:
          p.label,

        ...comboStat(
          result.combos.filter(
            x =>
              x.profile ===
              p.name
          )
        ),
      })
    )
  );

  /*
    조합별 risk
  */
  console.log();
  console.log(
    "===== COMBO RISK ====="
  );

  console.table(
    PROFILES.map(
      p => ({
        profile:
          p.label,

        ...riskStat(
          result.combos.filter(
            x =>
              x.profile ===
              p.name
          )
        ),
      })
    )
  );

  /*
    월별 조합
  */
  console.log();
  console.log(
    "===== MONTHLY COMBOS ====="
  );

  const months =
    [...new Set(
      result.combos.map(
        x => x.month
      )
    )].sort();

  const monthly = [];

  for (const month of months) {
    for (
      const p of PROFILES
    ) {
      const r =
        result.combos.filter(
          x =>
            x.month === month &&
            x.profile ===
              p.name
        );

      if (!r.length)
        continue;

      monthly.push({
        month,

        profile:
          p.name,

        ...comboStat(r),
      });
    }
  }

  console.table(monthly);

  /*
    일자별 역할 후보 개수
  */
  console.log();
  console.log(
    "===== ROLE AVAILABILITY ====="
  );

  const days =
    result.availability.length;

  const withDefense =
    result.availability.filter(
      x =>
        x.defense >= 1
    ).length;

  const with2Defense =
    result.availability.filter(
      x =>
        x.defense >= 2
    ).length;

  const with3Defense =
    result.availability.filter(
      x =>
        x.defense >= 3
    ).length;

  const withBalance =
    result.availability.filter(
      x =>
        x.balance >= 1
    ).length;

  const withAttack =
    result.availability.filter(
      x =>
        x.attack >= 1
    ).length;

  console.table([
    {
      gameDays:
        days,

      defenseDays:
        withDefense,

      defense2Days:
        with2Defense,

      defense3Days:
        with3Defense,

      balanceDays:
        withBalance,

      attackDays:
        withAttack,
    },
  ]);
}

const train =
  runPeriod(
    all,
    "2026-03-28",
    "2026-06-30"
  );

const validation =
  runPeriod(
    all,
    "2026-07-01",
    "2026-09-30"
  );

const full =
  runPeriod(
    all,
    "2026-03-28",
    "2026-09-30"
  );

report(
  "TRAIN 03-06",
  train
);

report(
  "VALIDATION 07-09",
  validation
);

report(
  "FULL 03-09",
  full
);

/*
  최종 비교표
*/
console.log();
console.log();
console.log(
  "=============================================="
);
console.log(
  "TRAIN / VALIDATION PROFILE COMPARISON"
);
console.log(
  "=============================================="
);

console.table(
  PROFILES.map(
    p => {
      const tr =
        comboStat(
          train.combos.filter(
            x =>
              x.profile ===
              p.name
          )
        );

      const va =
        comboStat(
          validation.combos.filter(
            x =>
              x.profile ===
              p.name
          )
        );

      return {
        profile:
          p.label,

        trainBets:
          tr.bets,

        trainHit:
          tr.hitRate,

        trainROI:
          tr.roi,

        validBets:
          va.bets,

        validHit:
          va.hitRate,

        validROI:
          va.roi,
      };
    }
  )
);

/*
  원본 상세 결과 저장
*/
const OUTPUT =
  "data/kbo-role-combos-v12.json";

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(
    {
      generatedAt:
        new Date()
          .toISOString(),

      methodology: {
        base:
          "EV >= 3% and EV < 10%",

        defense:
          "TOTAL OVER",

        balance:
          "non-defense/non-attack, odds 1.60-2.49",

        attack:
          "HANDICAP or odds >= 2.50",

        stakePerCombo:
          STAKE,

        sameGameDuplicate:
          false,
      },

      train,

      validation,

      full,
    },
    null,
    2
  )
);

console.log();
console.log(
  "FILE:",
  OUTPUT
);

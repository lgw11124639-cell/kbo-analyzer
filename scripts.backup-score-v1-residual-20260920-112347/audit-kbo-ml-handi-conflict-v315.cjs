const fs = require("fs");

const INPUT =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw =
  JSON.parse(
    fs.readFileSync(INPUT, "utf8")
  );

const all =
  (raw.results || raw)
    .filter(x =>
      ["WIN", "LOSS"].includes(x.result) &&
      ["ML", "HANDICAP", "TOTAL"].includes(x.market) &&
      Number.isFinite(Number(x.odds)) &&
      Number(x.odds) > 1
    )
    .map(x => {
      let confidence =
        Number(x.confidence);

      if (
        Number.isFinite(confidence) &&
        confidence > 1
      ) {
        confidence /= 100;
      }

      return {
        ...x,
        odds: Number(x.odds),
        confidence:
          Number.isFinite(confidence)
            ? confidence
            : null,
        ev:
          Number.isFinite(Number(x.ev))
            ? Number(x.ev)
            : null,
        actual:
          x.result === "WIN"
            ? 1
            : 0
      };
    });

const DISC_START = "2026-03-28";
const DISC_END   = "2026-04-30";
const INT_START  = "2026-05-01";
const INT_END    = "2026-06-30";
const FINAL_START = "2026-07-01";
const FINAL_END   = "2026-09-30";

const TOTAL_STAKE = 10000;
const INITIAL_BANK = 1000000;

function mean(a) {
  if (!a.length) return 0;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function sd(a) {
  if (!a.length) return 1;

  const m = mean(a);

  return (
    Math.sqrt(
      mean(
        a.map(
          x => (x - m) ** 2
        )
      )
    ) || 1
  );
}

function num(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function side(x) {
  const label = String(x.label || "");
  const away = String(x.awayTeam || "");
  const home = String(x.homeTeam || "");

  if (away && label.includes(away))
    return "AWAY";

  if (home && label.includes(home))
    return "HOME";

  return null;
}

function pickKey(x) {
  return `${x.gameId}:${x.market}:${x.label}`;
}

/*
============================================================
A ENGINE = HANDICAP FORM V3.7
============================================================
*/

const handiRows =
  all.filter(
    x => x.market === "HANDICAP"
  );

const handiGroups =
  new Map();

for (const x of handiRows) {
  const key =
    `${x.date}:${x.gameId}:HANDICAP`;

  if (!handiGroups.has(key))
    handiGroups.set(key, []);

  handiGroups.get(key).push(x);
}

const pairedHandi = [];

for (const list of handiGroups.values()) {
  if (list.length !== 2)
    continue;

  const [a, b] = list;

  const denom =
    1 / a.odds +
    1 / b.odds;

  for (const x of [a, b]) {
    const s = side(x);
    const form = num(x.formEdge);

    if (!s || form === null)
      continue;

    const signedForm =
      s === "AWAY"
        ? form
        : -form;

    pairedHandi.push({
      ...x,
      signedForm,
      marketProb:
        (1 / x.odds) /
        denom
    });
  }
}

const discoveryHandi =
  pairedHandi.filter(
    x =>
      x.date >= DISC_START &&
      x.date <= DISC_END
  );

const FORM_SD =
  sd(
    discoveryHandi.map(
      x => x.signedForm
    )
  );

function zForm(x) {
  return x.signedForm / FORM_SD;
}

const z =
  discoveryHandi.map(zForm);

const residual =
  discoveryHandi.map(
    x =>
      x.actual -
      x.marketProb
  );

const mz = mean(z);
const mr = mean(residual);

const covariance =
  mean(
    z.map(
      (v, i) =>
        (v - mz) *
        (residual[i] - mr)
    )
  );

const variance =
  mean(
    z.map(
      v =>
        (v - mz) ** 2
    )
  );

const BETA =
  variance
    ? covariance / variance
    : 0;

const anchorRows =
  pairedHandi.map(x => {
    const adjustedProb =
      Math.max(
        .05,
        Math.min(
          .95,
          x.marketProb +
          BETA * zForm(x)
        )
      );

    return {
      ...x,
      adjustedProb,
      adjustedEV:
        adjustedProb *
        x.odds -
        1
    };
  });

function dailyAnchor(start, end) {
  const days = new Map();

  for (const x of anchorRows) {
    if (
      x.date < start ||
      x.date > end ||
      x.adjustedEV <= 0
    ) {
      continue;
    }

    if (
      !days.has(x.date) ||
      x.adjustedEV >
      days.get(x.date).adjustedEV
    ) {
      days.set(
        x.date,
        x
      );
    }
  }

  return days;
}

/*
============================================================
B/C ENGINE = ML partnerScore
B = ML #1
C = ML #2
============================================================
*/

function partnerScore(x) {
  const conf =
    x.confidence ?? 0;

  const ev =
    x.ev ?? -1;

  return (
    conf * 100 +
    ev * 100
  );
}

function getMLPartners(
  anchor,
  dateRows
) {
  const candidates =
    dateRows
      .filter(
        x =>
          x.market === "ML"
      )
      .filter(
        x =>
          pickKey(x) !==
          pickKey(anchor)
      )
      .sort(
        (a, b) =>
          partnerScore(b) -
          partnerScore(a)
      );

  return {
    b: candidates[0] || null,
    c: candidates[1] || null
  };
}

/*
============================================================
BUILD DAILY AB / ABC
============================================================
*/

function buildDays(start, end) {
  const anchors =
    dailyAnchor(start, end);

  const rowsByDate =
    new Map();

  for (const x of all) {
    if (
      x.date < start ||
      x.date > end
    ) continue;

    if (!rowsByDate.has(x.date))
      rowsByDate.set(x.date, []);

    rowsByDate.get(x.date).push(x);
  }

  const out = [];

  for (
    const [date, a]
    of anchors.entries()
  ) {
    const dateRows =
      rowsByDate.get(date) || [];

    const { b, c } =
      getMLPartners(
        a,
        dateRows
      );

    if (!b || !c)
      continue;

    const abOdds =
      a.odds * b.odds;

    const abcOdds =
      abOdds * c.odds;

    const abWin =
      a.actual === 1 &&
      b.actual === 1;

    const abcWin =
      abWin &&
      c.actual === 1;

    out.push({
      date,
      a,
      b,
      c,
      abOdds,
      abcOdds,
      abWin,
      abcWin
    });
  }

  return out.sort(
    (a, b) =>
      a.date.localeCompare(
        b.date
      )
  );
}


function hasMLHandiConflict(picks) {
  const byGame = new Map();

  for (const x of picks) {
    if (!byGame.has(x.gameId))
      byGame.set(x.gameId, []);

    byGame.get(x.gameId).push(x);
  }

  for (const gamePicks of byGame.values()) {
    const markets =
      new Set(
        gamePicks.map(x => x.market)
      );

    if (
      markets.has("ML") &&
      markets.has("HANDICAP")
    ) {
      return true;
    }
  }

  return false;
}

function conflictAudit(name, start, end) {
  const days =
    buildDays(start, end);

  let abConflict = 0;
  let abcConflict = 0;

  const details = [];

  for (const x of days) {
    const ab =
      hasMLHandiConflict([
        x.a,
        x.b
      ]);

    const abc =
      hasMLHandiConflict([
        x.a,
        x.b,
        x.c
      ]);

    if (ab)
      abConflict++;

    if (abc)
      abcConflict++;

    if (ab || abc) {
      details.push({
        date: x.date,

        A:
          `${x.a.gameId} / ${x.a.market} / ${x.a.label}`,

        B:
          `${x.b.gameId} / ${x.b.market} / ${x.b.label}`,

        C:
          `${x.c.gameId} / ${x.c.market} / ${x.c.label}`,

        AB_CONFLICT: ab,
        ABC_CONFLICT: abc
      });
    }
  }

  const result = {
    period: name,
    days: days.length,

    abValid:
      days.length - abConflict,

    abConflict,

    abcValid:
      days.length - abcConflict,

    abcConflict
  };

  console.log();
  console.log(
    `===== ${name} ML+HANDI CONFLICT =====`
  );

  console.table([result]);

  if (details.length) {
    console.log();
    console.log("CONFLICT DETAILS");
    console.table(details);
  }

  return result;
}

/*
============================================================
PORTFOLIO
============================================================
*/

function simulate(
  days,
  abShare
) {
  const abcShare =
    1 - abShare;

  const abStake =
    TOTAL_STAKE *
    abShare;

  const abcStake =
    TOTAL_STAKE *
    abcShare;

  let bank =
    INITIAL_BANK;

  let peak =
    INITIAL_BANK;

  let maxDD = 0;

  let losingStreak = 0;
  let maxLosingStreak = 0;

  let totalReturned = 0;

  let zeroHitDays = 0;
  let abOnlyDays = 0;
  let bothDays = 0;

  let abOnlyRecoverySum = 0;
  let abOnlyRecoveryCount = 0;

  const monthMap =
    new Map();

  for (const x of days) {
    let returned = 0;

    if (x.abWin) {
      returned +=
        abStake *
        x.abOdds;
    }

    if (x.abcWin) {
      returned +=
        abcStake *
        x.abcOdds;
    }

    const pnl =
      returned -
      TOTAL_STAKE;

    bank += pnl;

    totalReturned += returned;

    if (!x.abWin) {
      zeroHitDays++;
    } else if (
      x.abWin &&
      !x.abcWin
    ) {
      abOnlyDays++;

      const recovery =
        returned /
        TOTAL_STAKE *
        100;

      abOnlyRecoverySum += recovery;
      abOnlyRecoveryCount++;
    } else {
      bothDays++;
    }

    if (bank > peak)
      peak = bank;

    const dd =
      peak > 0
        ? (peak - bank) / peak
        : 0;

    if (dd > maxDD)
      maxDD = dd;

    if (pnl < 0) {
      losingStreak++;

      if (
        losingStreak >
        maxLosingStreak
      ) {
        maxLosingStreak =
          losingStreak;
      }
    } else {
      losingStreak = 0;
    }

    const month =
      x.date.slice(0, 7);

    if (!monthMap.has(month)) {
      monthMap.set(month, {
        stake: 0,
        returned: 0,
        days: 0
      });
    }

    const m =
      monthMap.get(month);

    m.stake += TOTAL_STAKE;
    m.returned += returned;
    m.days++;
  }

  const totalStake =
    days.length *
    TOTAL_STAKE;

  const roi =
    totalStake
      ? (
          totalReturned /
          totalStake -
          1
        ) *
        100
      : 0;

  const monthly =
    [...monthMap.entries()]
      .map(([month, m]) => ({
        month,
        days: m.days,
        roi:
          +(
            (
              m.returned /
              m.stake -
              1
            ) *
            100
          ).toFixed(2),
        profit:
          Math.round(
            m.returned -
            m.stake
          )
      }));

  return {
    abShare:
      +(abShare * 100).toFixed(0),

    abcShare:
      +(abcShare * 100).toFixed(0),

    days:
      days.length,

    roi:
      +roi.toFixed(2),

    finalBank:
      Math.round(bank),

    profit:
      Math.round(
        bank -
        INITIAL_BANK
      ),

    mdd:
      +(maxDD * 100)
        .toFixed(2),

    maxLosingStreak,

    zeroHitDays,

    abOnlyDays,

    bothDays,

    avgABOnlyRecovery:
      abOnlyRecoveryCount
        ? +(
            abOnlyRecoverySum /
            abOnlyRecoveryCount
          ).toFixed(2)
        : 0,

    monthly
  };
}

function scanPeriod(
  name,
  start,
  end
) {
  const days =
    buildDays(
      start,
      end
    );

  const rows = [];

  for (
    let ab = 90;
    ab >= 10;
    ab -= 10
  ) {
    rows.push(
      simulate(
        days,
        ab / 100
      )
    );
  }

  console.log();
  console.log(
    `===== ${name} RATIO SCAN =====`
  );

  console.table(
    rows.map(x => ({
      AB: x.abShare,
      ABC: x.abcShare,
      days: x.days,
      roi: x.roi,
      profit: x.profit,
      mdd: x.mdd,
      losingStreak:
        x.maxLosingStreak,
      zeroHit:
        x.zeroHitDays,
      abOnly:
        x.abOnlyDays,
      both:
        x.bothDays,
      abOnlyRecovery:
        x.avgABOnlyRecovery
    }))
  );

  return {
    days,
    rows
  };
}

/*
============================================================
SELECT RATIO USING DISCOVERY ONLY
Score priority:
1 ROI positive
2 lower MDD
3 better AB-only recovery
============================================================
*/

function chooseDiscoveryRatio(rows) {
  const positive =
    rows.filter(
      x => x.roi > 0
    );

  const pool =
    positive.length
      ? positive
      : rows;

  return [...pool]
    .sort((a, b) => {
      if (
        Math.abs(
          a.roi - b.roi
        ) > 5
      ) {
        return b.roi - a.roi;
      }

      if (
        a.mdd !== b.mdd
      ) {
        return a.mdd - b.mdd;
      }

      return (
        b.avgABOnlyRecovery -
        a.avgABOnlyRecovery
      );
    })[0];
}

console.log(
  "============================================================"
);

console.log(
  "KBO ML+HANDICAP CONFLICT AUDIT V3.15"
);

console.log(
  "TICKET 1 = A+B"
);

console.log(
  "TICKET 2 = A+B+C"
);

console.log(
  "RATIO SELECTED USING DISCOVERY ONLY"
);

console.log(
  "FINAL 07~09: USED ONLY AFTER RATIO FREEZE"
);

console.log(
  "============================================================"
);

console.log(
  "FORM_SD:",
  FORM_SD
);

console.log(
  "BETA:",
  BETA
);

const conflictDiscovery =
  conflictAudit(
    "DISCOVERY",
    DISC_START,
    DISC_END
  );

const conflictInternal =
  conflictAudit(
    "INTERNAL",
    INT_START,
    INT_END
  );

const conflictFinal =
  conflictAudit(
    "FINAL 07~09",
    FINAL_START,
    FINAL_END
  );

console.log();
console.log(
  "===== CONFLICT AUDIT COMPLETE ====="
);

fs.writeFileSync(
  "data/kbo-ml-handi-conflict-v315.json",
  JSON.stringify(
    {
      discovery:
        conflictDiscovery,
      internal:
        conflictInternal,
      final:
        conflictFinal
    },
    null,
    2
  )
);

console.log(
  "SAVED: data/kbo-ml-handi-conflict-v315.json"
);

return;

/* ORIGINAL PORTFOLIO BELOW */

const discovery =
  scanPeriod(
    "DISCOVERY",
    DISC_START,
    DISC_END
  );

const chosen =
  chooseDiscoveryRatio(
    discovery.rows
  );

console.log();
console.log(
  "===== DISCOVERY SELECTED RATIO ====="
);

console.table([
  {
    AB: chosen.abShare,
    ABC: chosen.abcShare,
    ROI: chosen.roi,
    MDD: chosen.mdd,
    ABOnlyRecovery:
      chosen.avgABOnlyRecovery
  }
]);

const internalDays =
  buildDays(
    INT_START,
    INT_END
  );

const internal =
  simulate(
    internalDays,
    chosen.abShare / 100
  );

console.log();
console.log(
  "===== INTERNAL FROZEN RATIO ====="
);

console.table([
  {
    AB: internal.abShare,
    ABC: internal.abcShare,
    days: internal.days,
    roi: internal.roi,
    profit: internal.profit,
    mdd: internal.mdd,
    losingStreak:
      internal.maxLosingStreak,
    zeroHit:
      internal.zeroHitDays,
    abOnly:
      internal.abOnlyDays,
    both:
      internal.bothDays,
    abOnlyRecovery:
      internal.avgABOnlyRecovery
  }
]);

console.log();
console.log(
  "INTERNAL MONTHLY"
);

console.table(
  internal.monthly
);

const finalDays =
  buildDays(
    FINAL_START,
    FINAL_END
  );

const final =
  simulate(
    finalDays,
    chosen.abShare / 100
  );

console.log();
console.log(
  "===== FINAL 07~09 FROZEN RATIO ====="
);

console.table([
  {
    AB: final.abShare,
    ABC: final.abcShare,
    days: final.days,
    roi: final.roi,
    profit: final.profit,
    mdd: final.mdd,
    losingStreak:
      final.maxLosingStreak,
    zeroHit:
      final.zeroHitDays,
    abOnly:
      final.abOnlyDays,
    both:
      final.bothDays,
    abOnlyRecovery:
      final.avgABOnlyRecovery
  }
]);

console.log();
console.log(
  "FINAL MONTHLY"
);

console.table(
  final.monthly
);

const output = {
  formSd: FORM_SD,
  beta: BETA,

  totalStakePerDay:
    TOTAL_STAKE,

  discoveryScan:
    discovery.rows,

  selectedRatio:
    {
      ab:
        chosen.abShare,
      abc:
        chosen.abcShare
    },

  internal,

  final
};

fs.writeFileSync(
  "data/kbo-portfolio-2plus3-v313.json",
  JSON.stringify(
    output,
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-portfolio-2plus3-v313.json"
);

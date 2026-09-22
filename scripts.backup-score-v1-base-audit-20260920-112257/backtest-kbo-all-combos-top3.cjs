const fs = require("fs");

const DATA =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

console.log(
  "=================================================="
);
console.log(
  "ALL COMBINATIONS TOP3 BACKTEST"
);
console.log(
  "DEFENSE / VALUE / HIGH_ODDS"
);
console.log(
  "=================================================="
);

if (!fs.existsSync(DATA)) {
  console.log("DATA FILE NOT FOUND");
  process.exitCode = 0;
} else {

const root =
  JSON.parse(
    fs.readFileSync(
      DATA,
      "utf8"
    )
  );

const rows =
  Array.isArray(root)
    ? root
    : root.results ?? [];


/* ==================================================
   BASIC
================================================== */

function num(v) {
  return typeof v === "number" &&
    Number.isFinite(v)
      ? v
      : null;
}

function resultType(row) {
  const x =
    String(
      row.result ?? ""
    )
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
    x === "CANCEL" ||
    x === "CANCELED" ||
    x === "CANCELLED" ||
    x === "RETURN"
  ) {
    return "PUSH";
  }

  return "UNKNOWN";
}

function splitOf(row) {
  const month =
    String(row.date ?? "")
      .slice(0, 7);

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

function gradeValue(grade) {
  if (grade === "A") return 3;
  if (grade === "B") return 2;
  return 1;
}

function validPick(row) {
  return (
    num(row.odds) !== null &&
    row.odds > 1 &&
    num(row.confidence) !== null &&
    num(row.ev) !== null &&
    resultType(row) !==
      "UNKNOWN"
  );
}


console.log();
console.log(
  "===== DATA ====="
);

console.log(
  "ROWS:",
  rows.length
);

const resultCounts = {};

for (const row of rows) {
  const r =
    resultType(row);

  resultCounts[r] =
    (resultCounts[r] ?? 0) + 1;
}

console.log(
  "RESULTS:",
  resultCounts
);

console.log(
  "CURRENT_FILTER_TRUE:",
  rows.filter(
    row =>
      row.passesCurrentFilter ===
      true
  ).length
);


/* ==================================================
   MODES
================================================== */

const MODES = {
  ALL_VALID:
    rows.filter(validPick),

  CURRENT_FILTER:
    rows.filter(
      row =>
        validPick(row) &&
        row.passesCurrentFilter ===
          true
    ),
};


/* ==================================================
   COMBO RULES

   같은 경기:
   - 최대 2픽
   - 같은 시장 2개 금지
   - ML + HANDICAP 금지
   - ML + TOTAL 가능
   - HANDICAP + TOTAL 가능
================================================== */

function canAdd(
  selected,
  next
) {
  const sameGame =
    selected.filter(
      pick =>
        pick.gameId ===
        next.gameId
    );

  if (
    sameGame.length >= 2
  ) {
    return false;
  }

  if (
    sameGame.some(
      pick =>
        pick.market ===
        next.market
    )
  ) {
    return false;
  }

  const nextSide =
    next.market === "ML" ||
    next.market ===
      "HANDICAP";

  const hasSide =
    sameGame.some(
      pick =>
        pick.market === "ML" ||
        pick.market ===
          "HANDICAP"
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

function productProbability(
  picks
) {
  return picks.reduce(
    (v, pick) =>
      v * pick.confidence,
    1
  );
}

function productOdds(
  picks
) {
  return picks.reduce(
    (v, pick) =>
      v * pick.odds,
    1
  );
}

function averageConfidence(
  picks
) {
  return (
    picks.reduce(
      (s, pick) =>
        s + pick.confidence,
      0
    ) /
    picks.length
  );
}

function averageEv(
  picks
) {
  return (
    picks.reduce(
      (s, pick) =>
        s + pick.ev,
      0
    ) /
    picks.length
  );
}


/*
  현재 analyzer.ts와 동일 점수식
*/

function safeScore(
  picks
) {
  return (
    productProbability(picks) *
      120 +

    averageConfidence(picks) *
      45 +

    averageEv(picks) *
      12 +

    picks.reduce(
      (sum, pick) =>
        sum +
        gradeValue(
          pick.grade
        ) *
          1.5,
      0
    )
  );
}

function valueScore(
  picks
) {
  return (
    productProbability(picks) *
      75 +

    averageConfidence(picks) *
      42 +

    averageEv(picks) *
      30 +

    Math.log(
      Math.max(
        1,
        productOdds(picks)
      )
    ) *
      5 +

    picks.reduce(
      (sum, pick) =>
        sum +
        gradeValue(
          pick.grade
        ),
      0
    )
  );
}

function highOddsScore(
  picks
) {
  return (
    Math.log(
      Math.max(
        1,
        productOdds(picks)
      )
    ) *
      14 +

    averageConfidence(picks) *
      55 +

    averageEv(picks) *
      12
  );
}


/* ==================================================
   SETTLEMENT
================================================== */

function settleCombo(
  picks
) {
  const results =
    picks.map(
      resultType
    );

  if (
    results.includes(
      "UNKNOWN"
    )
  ) {
    return null;
  }

  if (
    results.includes(
      "LOSS"
    )
  ) {
    return {
      outcome: "LOSS",
      profit: -1,
    };
  }

  const winPicks =
    picks.filter(
      pick =>
        resultType(pick) ===
        "WIN"
    );

  if (
    !winPicks.length
  ) {
    return {
      outcome: "PUSH",
      profit: 0,
    };
  }

  const effectiveOdds =
    winPicks.reduce(
      (value, pick) =>
        value * pick.odds,
      1
    );

  return {
    outcome: "WIN",
    profit:
      effectiveOdds - 1,
  };
}


/* ==================================================
   KEY
================================================== */

function comboKey(
  picks
) {
  return [...picks]
    .map(
      p =>
        `${p.gameId}:${p.market}:${p.label}`
    )
    .sort()
    .join("|");
}


/* ==================================================
   TOP LIST

   전체 조합은 모두 검사하지만
   최종 순위 후보만 메모리에 유지.
================================================== */

function better(
  a,
  b,
  style
) {
  if (
    style === "DEFENSE"
  ) {
    if (
      Math.abs(
        a.safe -
        b.safe
      ) >
      1e-12
    ) {
      return (
        a.safe >
        b.safe
      );
    }

    return (
      a.probability >
      b.probability
    );
  }

  if (
    style === "VALUE"
  ) {
    if (
      Math.abs(
        a.value -
        b.value
      ) >
      1e-12
    ) {
      return (
        a.value >
        b.value
      );
    }

    return (
      a.probability >
      b.probability
    );
  }

  /*
    고배당:
    현재 코드와 동일하게
    실제 총배당 우선.
  */
  if (
    Math.abs(
      a.odds -
      b.odds
    ) >
    1e-12
  ) {
    return (
      a.odds >
      b.odds
    );
  }

  return (
    a.high >
    b.high
  );
}

function addTop(
  list,
  item,
  style,
  limit = 20
) {
  let pos = 0;

  while (
    pos < list.length &&
    !better(
      item,
      list[pos],
      style
    )
  ) {
    pos++;
  }

  if (
    pos < limit
  ) {
    list.splice(
      pos,
      0,
      item
    );

    if (
      list.length >
      limit
    ) {
      list.pop();
    }
  }
}


/* ==================================================
   ENUMERATE ALL COMBINATIONS

   NO 15000 CAP.
================================================== */

function rankDate(
  dateRows,
  leg
) {
  const tops = {
    DEFENSE: [],
    VALUE: [],
    HIGH_ODDS: [],
  };

  let examined = 0;

  const selected = [];

  function visit(
    index
  ) {
    if (
      selected.length ===
      leg
    ) {
      examined++;

      const picks =
        [...selected];

      const probability =
        productProbability(
          picks
        );

      const odds =
        productOdds(
          picks
        );

      const avgConf =
        averageConfidence(
          picks
        );

      const avgEv =
        averageEv(
          picks
        );

      const item = {
        key:
          comboKey(picks),

        picks,

        probability,
        odds,
        avgConf,
        avgEv,

        safe:
          safeScore(picks),

        value:
          valueScore(picks),

        high:
          highOddsScore(
            picks
          ),
      };

      addTop(
        tops.DEFENSE,
        item,
        "DEFENSE"
      );

      addTop(
        tops.VALUE,
        item,
        "VALUE"
      );

      /*
        현재 고배당 방어선 그대로:
        평균 confidence >= 52%
        평균 EV >= -5%
      */
      if (
        avgConf >= 0.52 &&
        avgEv >= -0.05
      ) {
        addTop(
          tops.HIGH_ODDS,
          item,
          "HIGH_ODDS"
        );
      }

      return;
    }

    if (
      index >=
      dateRows.length
    ) {
      return;
    }

    const needed =
      leg -
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

      visit(
        index + 1
      );

      selected.pop();
    }

    visit(
      index + 1
    );
  }

  visit(0);

  return {
    tops,
    examined,
  };
}


/* ==================================================
   SELECT TOP3

   INDEPENDENT:
   각 유형 독립 TOP3.

   UNIQUE9:
   방어 TOP3
   → 가치 TOP3
   → 고배당 TOP3
   순서로 동일 조합 중복 제거.
================================================== */

function independentTop3(
  tops
) {
  const out = [];

  for (
    const style
    of [
      "DEFENSE",
      "VALUE",
      "HIGH_ODDS",
    ]
  ) {
    tops[style]
      .slice(0, 3)
      .forEach(
        (item, index) => {
          out.push({
            style,
            rank:
              index + 1,
            item,
          });
        }
      );
  }

  return out;
}

function uniqueTop3(
  tops
) {
  const out = [];

  const used =
    new Set();

  for (
    const style
    of [
      "DEFENSE",
      "VALUE",
      "HIGH_ODDS",
    ]
  ) {
    let rank = 0;

    for (
      const item
      of tops[style]
    ) {
      if (
        used.has(
          item.key
        )
      ) {
        continue;
      }

      used.add(
        item.key
      );

      rank++;

      out.push({
        style,
        rank,
        item,
      });

      if (
        rank === 3
      ) {
        break;
      }
    }
  }

  return out;
}


/* ==================================================
   RUN
================================================== */

const records = [];

const enumeration =
  new Map();

for (
  const [
    mode,
    modeRows
  ]
  of Object.entries(
    MODES
  )
) {

  const byDate =
    new Map();

  for (
    const row
    of modeRows
  ) {
    const date =
      String(
        row.date
      );

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


  for (
    const [
      date,
      dateRows
    ]
    of [...byDate.entries()]
      .sort(
        (a, b) =>
          a[0].localeCompare(
            b[0]
          )
      )
  ) {

    for (
      const leg
      of [
        2,
        3,
        4,
        5,
      ]
    ) {
      const {
        tops,
        examined,
      } =
        rankDate(
          dateRows,
          leg
        );

      const enumKey =
        `${mode}:${leg}`;

      enumeration.set(
        enumKey,
        (
          enumeration.get(
            enumKey
          ) ?? 0
        ) +
          examined
      );


      const policies = [
        {
          name:
            "INDEPENDENT",
          selections:
            independentTop3(
              tops
            ),
        },
        {
          name:
            "UNIQUE9",
          selections:
            uniqueTop3(
              tops
            ),
        },
      ];


      for (
        const policy
        of policies
      ) {
        for (
          const selection
          of policy.selections
        ) {
          const settlement =
            settleCombo(
              selection
                .item
                .picks
            );

          if (
            !settlement
          ) {
            continue;
          }

          records.push({
            mode,
            policy:
              policy.name,

            split:
              splitOf(
                selection
                  .item
                  .picks[0]
              ),

            date,
            leg,

            style:
              selection.style,

            rank:
              selection.rank,

            odds:
              selection
                .item
                .odds,

            probability:
              selection
                .item
                .probability,

            avgConf:
              selection
                .item
                .avgConf,

            avgEv:
              selection
                .item
                .avgEv,

            outcome:
              settlement.outcome,

            profit:
              settlement.profit,
          });
        }
      }
    }
  }
}


/* ==================================================
   SUMMARY
================================================== */

function pct(
  x
) {
  return (
    x * 100
  ).toFixed(1) + "%";
}

function summary(
  arr
) {
  if (
    !arr.length
  ) {
    return null;
  }

  const wins =
    arr.filter(
      x =>
        x.outcome ===
        "WIN"
    ).length;

  const losses =
    arr.filter(
      x =>
        x.outcome ===
        "LOSS"
    ).length;

  const pushes =
    arr.filter(
      x =>
        x.outcome ===
        "PUSH"
    ).length;

  const decided =
    wins + losses;

  const profit =
    arr.reduce(
      (s, x) =>
        s + x.profit,
      0
    );

  const avgOdds =
    arr.reduce(
      (s, x) =>
        s + x.odds,
      0
    ) /
    arr.length;

  const avgProbability =
    arr.reduce(
      (s, x) =>
        s +
        x.probability,
      0
    ) /
    arr.length;

  const days =
    new Map();

  for (
    const x
    of arr
  ) {
    if (
      !days.has(
        x.date
      )
    ) {
      days.set(
        x.date,
        []
      );
    }

    days
      .get(x.date)
      .push(x);
  }

  let dayAny = 0;
  let dayTwo = 0;
  let dayAll = 0;

  for (
    const xs
    of days.values()
  ) {
    const dayWins =
      xs.filter(
        x =>
          x.outcome ===
          "WIN"
      ).length;

    if (
      dayWins >= 1
    ) {
      dayAny++;
    }

    if (
      dayWins >= 2
    ) {
      dayTwo++;
    }

    if (
      dayWins ===
        xs.length &&
      xs.length > 0
    ) {
      dayAll++;
    }
  }

  return {
    n:
      arr.length,

    wins,
    losses,
    pushes,

    hitRate:
      decided
        ? wins /
          decided
        : 0,

    roi:
      profit /
      arr.length,

    profit,

    avgOdds,
    avgProbability,

    days:
      days.size,

    dayAny:
      days.size
        ? dayAny /
          days.size
        : 0,

    dayTwo:
      days.size
        ? dayTwo /
          days.size
        : 0,

    dayAll:
      days.size
        ? dayAll /
          days.size
        : 0,
  };
}

function printSummary(
  label,
  s
) {
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
    `P=${s.pushes}`,
    `HIT=${pct(s.hitRate)}`,
    `AVG_ODDS=${s.avgOdds.toFixed(3)}`,
    `MODEL_P=${pct(s.avgProbability)}`,
    `ROI=${pct(s.roi)}`,
    `PROFIT=${s.profit.toFixed(3)}`,
    `DAYS=${s.days}`,
    `DAY_ANY=${pct(s.dayAny)}`,
    `DAY_2+=${pct(s.dayTwo)}`,
    `DAY_ALL=${pct(s.dayAll)}`
  );
}


/* ==================================================
   ENUMERATION
================================================== */

console.log();
console.log(
  "===== ALL COMBINATIONS EXAMINED ====="
);

for (
  const mode
  of Object.keys(
    MODES
  )
) {
  console.log();
  console.log(
    `### ${mode}`
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
    console.log(
      `${leg}LEG`,
      enumeration.get(
        `${mode}:${leg}`
      ) ?? 0
    );
  }
}


/* ==================================================
   PRIMARY
   ALL_VALID + UNIQUE9
================================================== */

console.log();
console.log(
  "=================================================="
);

console.log(
  "PRIMARY — ALL_VALID / UNIQUE9"
);

console.log(
  "=================================================="
);


console.log();
console.log(
  "===== ALL PERIOD ====="
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
    const style
    of [
      "DEFENSE",
      "VALUE",
      "HIGH_ODDS",
    ]
  ) {
    const xs =
      records.filter(
        x =>
          x.mode ===
            "ALL_VALID" &&
          x.policy ===
            "UNIQUE9" &&
          x.leg ===
            leg &&
          x.style ===
            style
      );

    printSummary(
      style,
      summary(xs)
    );
  }
}


/* ==================================================
   TEMPORAL STABILITY
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
    `######## ${split} ########`
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
    console.log(
      `--- ${leg}LEG ---`
    );

    for (
      const style
      of [
        "DEFENSE",
        "VALUE",
        "HIGH_ODDS",
      ]
    ) {
      const xs =
        records.filter(
          x =>
            x.mode ===
              "ALL_VALID" &&
            x.policy ===
              "UNIQUE9" &&
            x.split ===
              split &&
            x.leg ===
              leg &&
            x.style ===
              style
        );

      printSummary(
        style,
        summary(xs)
      );
    }
  }
}


/* ==================================================
   RANK 1 / 2 / 3
================================================== */

console.log();
console.log(
  "===== TOP3 RANK DETAIL ====="
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
    const style
    of [
      "DEFENSE",
      "VALUE",
      "HIGH_ODDS",
    ]
  ) {
    for (
      const rank
      of [
        1,
        2,
        3,
      ]
    ) {
      const xs =
        records.filter(
          x =>
            x.mode ===
              "ALL_VALID" &&
            x.policy ===
              "UNIQUE9" &&
            x.leg ===
              leg &&
            x.style ===
              style &&
            x.rank ===
              rank
        );

      printSummary(
        `${style}#${rank}`,
        summary(xs)
      );
    }
  }
}


/* ==================================================
   CURRENT FILTER COMPARISON
================================================== */

console.log();
console.log(
  "=================================================="
);

console.log(
  "CURRENT_FILTER / UNIQUE9"
);

console.log(
  "=================================================="
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
    const style
    of [
      "DEFENSE",
      "VALUE",
      "HIGH_ODDS",
    ]
  ) {
    const xs =
      records.filter(
        x =>
          x.mode ===
            "CURRENT_FILTER" &&
          x.policy ===
            "UNIQUE9" &&
          x.leg ===
            leg &&
          x.style ===
            style
      );

    printSummary(
      style,
      summary(xs)
    );
  }
}


/* ==================================================
   UNIQUE VS INDEPENDENT
================================================== */

console.log();
console.log(
  "===== UNIQUE9 VS INDEPENDENT ====="
);

for (
  const policy
  of [
    "INDEPENDENT",
    "UNIQUE9",
  ]
) {
  console.log();
  console.log(
    `### ${policy}`
  );

  for (
    const style
    of [
      "DEFENSE",
      "VALUE",
      "HIGH_ODDS",
    ]
  ) {
    const xs =
      records.filter(
        x =>
          x.mode ===
            "ALL_VALID" &&
          x.policy ===
            policy &&
          x.style ===
            style
      );

    printSummary(
      style,
      summary(xs)
    );
  }
}


console.log();
console.log(
  "BACKTEST RULE:"
);

console.log(
  "ALL POSSIBLE COMBINATIONS EXAMINED"
);

console.log(
  "NO 15000 COMBO CAP"
);

console.log(
  "NO SCORE WEIGHT TUNING"
);

console.log(
  "DEFENSE / VALUE / HIGH_ODDS FORMULAS UNCHANGED"
);

console.log(
  "2 / 3 / 4 / 5 LEG ONLY"
);

console.log(
  "TOP3 PER STYLE"
);

}

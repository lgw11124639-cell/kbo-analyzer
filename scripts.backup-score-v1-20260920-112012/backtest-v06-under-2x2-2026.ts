import fs from "fs";
import path from "path";

import {
  makeFlexibleAutoCombos,
} from "../src/lib/analyzer";

import type {
  Pick,
} from "../src/types/kbo";

const INPUT = path.join(
  process.cwd(),
  "data/kbo-backtest-all-candidates-2026.json"
);

const OUTPUT = path.join(
  process.cwd(),
  "data/kbo-backtest-v06-under-2x2-2026.json"
);

const DAILY_BANKROLL = 100000;

const raw = JSON.parse(
  fs.readFileSync(INPUT, "utf8")
);

type Row = {
  date: string;
  month: string;
  gameId: string;

  homeTeam: string;
  awayTeam: string;

  market:
    | "ML"
    | "HANDICAP"
    | "TOTAL";

  label: string;

  grade:
    | "A"
    | "B"
    | "C";

  confidence: number;
  ev: number | null;
  odds: number | null;

  totalEdge?: number | null;

  result:
    | "WIN"
    | "LOSS"
    | "PUSH"
    | "VOID";
};

type Combo =
  ReturnType<
    typeof makeFlexibleAutoCombos
  >[number];

const rows: Row[] =
  raw.results ?? [];


/* =========================================================
   MAP
========================================================= */

const rowsByDate =
  new Map<string, Row[]>();

const resultMap =
  new Map<string, Row>();

function resultKey(
  gameId: string,
  market: string,
  label: string
) {
  return `${gameId}||${market}||${label}`;
}

for (
  const row of rows
) {
  if (
    !rowsByDate.has(row.date)
  ) {
    rowsByDate.set(
      row.date,
      []
    );
  }

  rowsByDate
    .get(row.date)!
    .push(row);

  resultMap.set(
    resultKey(
      row.gameId,
      row.market,
      row.label
    ),
    row
  );
}

const dates =
  [...rowsByDate.keys()]
    .sort();


/* =========================================================
   HELPERS
========================================================= */

function normalize(
  value: string
) {
  return String(value)
    .replace(/\s+/g, "")
    .toLowerCase();
}

function isUnder(
  row: Row
) {
  if (
    row.market !== "TOTAL"
  ) {
    return false;
  }

  const label =
    normalize(row.label);

  return (
    label.includes("언더") ||
    label.includes("under")
  );
}

function toPick(
  row: Row
): Pick {
  return {
    gameId:
      row.gameId,

    market:
      row.market,

    label:
      row.label,

    grade:
      row.grade,

    confidence:
      Number(row.confidence),

    ev:
      row.ev === null
        ? null
        : Number(row.ev),

    odds:
      row.odds === null
        ? null
        : Number(row.odds),
  } as Pick;
}

function pickKey(
  pick: Pick
) {
  return (
    `${pick.gameId}:` +
    `${pick.market}:` +
    `${pick.label}`
  );
}

function defenseScore(
  combo: Combo
) {
  return (
    combo.probability * 100 +
    combo.averageConfidence * 20 +
    (combo.averageEv ?? -0.20) * 10
  );
}


/* =========================================================
   STRICT 2-LEG SELECTION
========================================================= */

/*
  무조건 2폴만.
  1폴 fallback 없음.
*/
function selectFirst2Leg(
  combos: Combo[]
) {
  return combos
    .filter(
      combo =>
        combo.picks.length === 2
    )
    .map(
      combo => ({
        combo,
        score:
          defenseScore(combo),
      })
    )
    .sort(
      (a,b) =>
        b.score -
        a.score
    )[0]?.combo;
}


/*
  두 번째 2폴은
  첫 번째 티켓과 픽 중복이
  정확히 0개인 것만 허용.
*/
function selectSecond2Leg(
  combos: Combo[],
  used:
    Set<string>
) {
  return combos
    .filter(
      combo =>
        combo.picks.length === 2
    )
    .filter(
      combo =>
        combo.picks.every(
          pick =>
            !used.has(
              pickKey(pick)
            )
        )
    )
    .map(
      combo => ({
        combo,
        score:
          defenseScore(combo),
      })
    )
    .sort(
      (a,b) =>
        b.score -
        a.score
    )[0]?.combo;
}


/* =========================================================
   SETTLEMENT
========================================================= */

function settleCombo(
  combo: Combo,
  stake: number
) {
  const legs =
    combo.picks.map(
      pick => {
        const row =
          resultMap.get(
            resultKey(
              pick.gameId,
              pick.market,
              pick.label
            )
          );

        return {
          pick,
          result:
            row?.result ??
            "VOID",
        };
      }
    );

  if (
    legs.some(
      x =>
        x.result === "LOSS"
    )
  ) {
    return {
      result:
        "LOSS" as const,

      returned:
        0,

      profit:
        -stake,
    };
  }

  const allVoid =
    legs.every(
      x =>
        x.result === "VOID" ||
        x.result === "PUSH"
    );

  if (allVoid) {
    return {
      result:
        "VOID" as const,

      returned:
        stake,

      profit: 0,
    };
  }

  const effectiveOdds =
    legs.reduce(
      (product,x) => {
        if (
          x.result === "VOID" ||
          x.result === "PUSH"
        ) {
          return product;
        }

        return (
          product *
          Number(
            x.pick.odds ?? 1
          )
        );
      },
      1
    );

  const returned =
    stake *
    effectiveOdds;

  return {
    result:
      "WIN" as const,

    returned,

    profit:
      returned -
      stake,
  };
}


/* =========================================================
   STRATEGY
========================================================= */

type Params = {
  useAnchor: boolean;
  underMinEv: number;
  totalEdgeMin: number;
  minConfidence: number;
};

type DayResult = {
  date: string;
  month: string;

  stake: number;
  returned: number;
  profit: number;

  wins: number;
  losses: number;
  voids: number;

  combo1Odds: number;
  combo2Odds: number;
};

function runStrategy(
  params: Params
) {
  const results:
    DayResult[] = [];

  let candidateDays = 0;
  let insufficientDays = 0;

  for (
    const date of dates
  ) {
    const dayRows =
      rowsByDate.get(date)!;

    const filtered =
      dayRows.filter(
        row => {
          if (
            !isUnder(row) ||
            !row.odds ||
            row.odds <= 1 ||
            row.ev === null
          ) {
            return false;
          }

          return (
            row.ev >=
              params.underMinEv &&
            Math.abs(
              Number(
                row.totalEdge ?? 0
              )
            ) >=
              params.totalEdgeMin &&
            Number(
              row.confidence
            ) >=
              params.minConfidence
          );
        }
      );

    /*
      중복 없는 2폴 두 장이면
      최소 4개의 서로 다른 UNDER 픽 필요
    */
    if (
      filtered.length < 4
    ) {
      insufficientDays += 1;
      continue;
    }

    candidateDays += 1;

    const picks =
      filtered.map(toPick);

    const combos =
      makeFlexibleAutoCombos(
        picks,
        {
          legs: [2],

          /*
            생성기 내부 후보가 너무 적게 잘리지 않도록
            2폴 후보를 넉넉히 확보
          */
          combosPerLeg: 20,

          useAnchor:
            params.useAnchor,

          minimumGrade:
            "ALL",

          minimumConfidence:
            params.minConfidence,

          minimumEv:
            params.underMinEv,
        }
      );

    const first =
      selectFirst2Leg(
        combos
      );

    if (!first) {
      insufficientDays += 1;
      continue;
    }

    const used =
      new Set<string>();

    first.picks.forEach(
      pick =>
        used.add(
          pickKey(pick)
        )
    );

    const second =
      selectSecond2Leg(
        combos,
        used
      );

    if (!second) {
      insufficientDays += 1;
      continue;
    }

    /*
      2조합 안전형 기존 비율
      방어 60 / 방어 40
    */
    const s1 =
      settleCombo(
        first,
        60000
      );

    const s2 =
      settleCombo(
        second,
        40000
      );

    const statuses = [
      s1.result,
      s2.result,
    ];

    results.push({
      date,

      month:
        date.slice(0,7),

      stake:
        DAILY_BANKROLL,

      returned:
        s1.returned +
        s2.returned,

      profit:
        s1.profit +
        s2.profit,

      wins:
        statuses.filter(
          x => x === "WIN"
        ).length,

      losses:
        statuses.filter(
          x => x === "LOSS"
        ).length,

      voids:
        statuses.filter(
          x => x === "VOID"
        ).length,

      combo1Odds:
        first.odds,

      combo2Odds:
        second.odds,
    });
  }

  return {
    results,
    candidateDays,
    insufficientDays,
  };
}


/* =========================================================
   SUMMARY
========================================================= */

function summarize(
  list: DayResult[]
) {
  const stake =
    list.reduce(
      (sum,x) =>
        sum + x.stake,
      0
    );

  const returned =
    list.reduce(
      (sum,x) =>
        sum + x.returned,
      0
    );

  const profit =
    returned - stake;

  const profitDays =
    list.filter(
      x => x.profit > 0
    ).length;

  const lossDays =
    list.filter(
      x => x.profit < 0
    ).length;

  const allWinDays =
    list.filter(
      x => x.wins === 2
    ).length;

  const partialDays =
    list.filter(
      x => x.wins === 1
    ).length;

  const wipeoutDays =
    list.filter(
      x => x.losses === 2
    ).length;

  let streak = 0;
  let maxLossStreak = 0;

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (
    const day of list
  ) {
    if (
      day.profit < 0
    ) {
      streak += 1;

      maxLossStreak =
        Math.max(
          maxLossStreak,
          streak
        );
    } else {
      streak = 0;
    }

    equity +=
      day.profit;

    peak =
      Math.max(
        peak,
        equity
      );

    const dd =
      peak -
      equity;

    maxDrawdown =
      Math.max(
        maxDrawdown,
        dd
      );
  }

  const avgOdds =
    list.length
      ? list.reduce(
          (sum,x) =>
            sum +
            x.combo1Odds +
            x.combo2Odds,
          0
        ) /
        (list.length * 2)
      : 0;

  return {
    days:
      list.length,

    profitDays,
    lossDays,

    dayWinRate:
      list.length
        ? Number(
            (
              profitDays /
              list.length *
              100
            ).toFixed(2)
          )
        : 0,

    allWinDays,
    partialDays,
    wipeoutDays,

    stake:
      Math.round(stake),

    returned:
      Math.round(returned),

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

    maxLossStreak,

    maxDrawdown:
      Math.round(
        maxDrawdown
      ),

    avgTicketOdds:
      Number(
        avgOdds.toFixed(3)
      ),
  };
}


/* =========================================================
   GRID
========================================================= */

const UNDER_EV = [
  0,
  0.01,
  0.02,
  0.03,
  0.04,
];

const EDGES = [
  0.8,
  1.0,
  1.2,
  1.4,
];

const CONFIDENCE = [
  0.50,
  0.52,
  0.54,
  0.56,
];

const allResults:
  any[] = [];

for (
  const useAnchor of
  [false,true]
) {
  for (
    const underMinEv of
    UNDER_EV
  ) {
    for (
      const totalEdgeMin of
      EDGES
    ) {
      for (
        const minConfidence of
        CONFIDENCE
      ) {
        const run =
          runStrategy({
            useAnchor,
            underMinEv,
            totalEdgeMin,
            minConfidence,
          });

        const full =
          summarize(
            run.results
          );

        const val =
          summarize(
            run.results.filter(
              x =>
                x.date >=
                "2026-07-01"
            )
          );

        allResults.push({
          anchor:
            useAnchor
              ? "ON"
              : "OFF",

          underEv:
            underMinEv,

          edge:
            totalEdgeMin,

          confidence:
            minConfidence,

          candidateDays:
            run.candidateDays,

          insufficientDays:
            run.insufficientDays,

          fullDays:
            full.days,

          fullROI:
            full.roi,

          fullProfit:
            full.profit,

          fullWinRate:
            full.dayWinRate,

          fullAllWin:
            full.allWinDays,

          fullPartial:
            full.partialDays,

          fullWipeout:
            full.wipeoutDays,

          fullMaxLoss:
            full.maxLossStreak,

          fullMDD:
            full.maxDrawdown,

          fullAvgOdds:
            full.avgTicketOdds,

          valDays:
            val.days,

          valROI:
            val.roi,

          valProfit:
            val.profit,

          valWinRate:
            val.dayWinRate,

          valMaxLoss:
            val.maxLossStreak,

          valMDD:
            val.maxDrawdown,

          robust:
            Number(
              Math.min(
                full.roi,
                val.roi
              ).toFixed(2)
            ),
        });
      }
    }
  }
}


/* =========================================================
   FILTER
========================================================= */

const qualified =
  allResults
    .filter(
      x =>
        x.fullDays >= 15 &&
        x.valDays >= 5 &&
        x.fullROI > 0 &&
        x.valROI > 0
    )
    .sort(
      (a,b) => {
        if (
          b.robust !==
          a.robust
        ) {
          return (
            b.robust -
            a.robust
          );
        }

        if (
          b.valDays !==
          a.valDays
        ) {
          return (
            b.valDays -
            a.valDays
          );
        }

        return (
          b.fullDays -
          a.fullDays
        );
      }
    );


console.log(
  "\n===== V0.6 STRICT 2폴 × 2조합 ====="
);

console.log(
  "전체 설정:",
  allResults.length
);

console.log(
  "전체+검증 플러스:",
  qualified.length
);


console.log(
  "\n===== ROBUST TOP 20 ====="
);

console.table(
  qualified
    .slice(0,20)
    .map(
      (x,i) => ({
        순위:
          i + 1,

        축:
          x.anchor === "ON"
            ? "사용"
            : "미사용",

        UNDER_EV:
          `${Math.round(
            x.underEv * 100
          )}%`,

        EDGE:
          x.edge,

        CONF:
          `${Math.round(
            x.confidence * 100
          )}%`,

        전체일:
          x.fullDays,

        전체ROI:
          `${x.fullROI}%`,

        검증일:
          x.valDays,

        검증ROI:
          `${x.valROI}%`,

        ROBUST:
          `${x.robust}%`,

        전체승일:
          `${x.fullWinRate}%`,

        올킬:
          x.fullAllWin,

        반쪽적중:
          x.fullPartial,

        전멸:
          x.fullWipeout,

        평균조합배당:
          x.fullAvgOdds,

        최대연패:
          x.fullMaxLoss,

        MDD:
          x.fullMDD,
      })
    )
);


/* =========================================================
   MONTHLY TOP 10
========================================================= */

console.log(
  "\n===== TOP 10 월별 ====="
);

const monthlyRows:
  any[] = [];

for (
  const config of
  qualified.slice(0,10)
) {
  const run =
    runStrategy({
      useAnchor:
        config.anchor === "ON",

      underMinEv:
        config.underEv,

      totalEdgeMin:
        config.edge,

      minConfidence:
        config.confidence,
    });

  const row: any = {
    축:
      config.anchor === "ON"
        ? "사용"
        : "미사용",

    EV:
      `${Math.round(
        config.underEv * 100
      )}%`,

    EDGE:
      config.edge,

    CONF:
      `${Math.round(
        config.confidence * 100
      )}%`,
  };

  for (
    const month of [
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]
  ) {
    const m =
      summarize(
        run.results.filter(
          x =>
            x.month === month
        )
      );

    row[month] =
      m.days
        ? `${m.roi}% (${m.days})`
        : "-";
  }

  row["전체"] =
    `${config.fullROI}%`;

  row["검증"] =
    `${config.valROI}%`;

  monthlyRows.push(row);
}

console.table(
  monthlyRows
);


/* =========================================================
   SAVE
========================================================= */

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(
    {
      generatedAt:
        new Date()
          .toISOString(),

      description:
        "V0.6 UNDER-only strict two 2-leg tickets, zero overlap",

      rules: {
        ticketCount: 2,
        legsPerTicket: 2,
        singleLegFallback: false,
        crossTicketOverlap: 0,
        stakeRatio: [
          0.60,
          0.40,
        ],
      },

      totalConfigs:
        allResults.length,

      qualifiedCount:
        qualified.length,

      allResults,
      qualified,
    },
    null,
    2
  )
);

console.log(
  "\nFILE:",
  OUTPUT
);

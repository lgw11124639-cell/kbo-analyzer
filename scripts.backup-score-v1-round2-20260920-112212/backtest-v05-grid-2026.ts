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
  "data/kbo-backtest-v05-grid-2026.json"
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
   MAPS
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
  return (
    `${gameId}||${market}||${label}`
  );
}

for (
  const row of rows
) {
  if (
    !rowsByDate.has(
      row.date
    )
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
      Number(
        row.confidence
      ),

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

function investmentPickKey(
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
    combo.probability *
      100 +
    combo.averageConfidence *
      20 +
    (combo.averageEv ??
      -0.20) *
      10
  );
}


/*
  실제 사이트 DEFENSE 선택 로직:
  2폴 우선 -> 없으면 1폴
  중복 수 최소화 -> 방어점수 최대
*/
function selectDefense(
  combos: Combo[],
  usedPickKeys:
    Set<string>
) {
  for (
    const leg of [2,1]
  ) {
    const candidates =
      combos
        .filter(
          combo =>
            combo.picks.length ===
            leg
        )
        .map(
          combo => ({
            combo,

            overlapCount:
              combo.picks.filter(
                pick =>
                  usedPickKeys.has(
                    investmentPickKey(
                      pick
                    )
                  )
              ).length,

            score:
              defenseScore(
                combo
              ),
          })
        )
        .sort(
          (a,b) => {
            if (
              a.overlapCount !==
              b.overlapCount
            ) {
              return (
                a.overlapCount -
                b.overlapCount
              );
            }

            return (
              b.score -
              a.score
            );
          }
        );

    if (
      candidates[0]
    ) {
      return (
        candidates[0].combo
      );
    }
  }

  return undefined;
}


/* =========================================================
   HOME ML 판별
========================================================= */

function normalize(
  value: string
) {
  return String(value)
    .replace(/\s+/g, "")
    .toLowerCase();
}

function isHomeMl(
  row: Row
) {
  if (
    row.market !== "ML"
  ) {
    return false;
  }

  const label =
    normalize(row.label);

  const home =
    normalize(row.homeTeam);

  return (
    label.includes(home) ||
    label.includes("홈")
  );
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


/* =========================================================
   SETTLEMENT
========================================================= */

function settleCombo(
  combo: Combo,
  stake: number
) {
  const settledLegs =
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
    settledLegs.some(
      leg =>
        leg.result ===
        "LOSS"
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
    settledLegs.every(
      leg =>
        leg.result ===
          "VOID" ||
        leg.result ===
          "PUSH"
    );

  if (allVoid) {
    return {
      result:
        "VOID" as const,

      returned:
        stake,

      profit:
        0,
    };
  }

  const effectiveOdds =
    settledLegs.reduce(
      (product,leg) => {
        if (
          leg.result ===
            "VOID" ||
          leg.result ===
            "PUSH"
        ) {
          return product;
        }

        return (
          product *
          Number(
            leg.pick.odds ??
            1
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
   ONE PARAMETER SET
========================================================= */

type GridParams = {
  useAnchor: boolean;
  mlMinEv: number;
  underMinEv: number;
  totalEdgeMin: number;
};

type DayResult = {
  date: string;
  month: string;

  stake: number;
  returned: number;
  profit: number;

  ticketWins: number;
  ticketLosses: number;
  ticketVoids: number;

  mlLegs: number;
  underLegs: number;

  totalLegs: number;

  firstComboOdds: number;
  secondComboOdds: number;
};

function runStrategy(
  params: GridParams
) {
  const dayResults:
    DayResult[] = [];

  let skippedDays =
    0;

  let candidateDays =
    0;

  for (
    const date of dates
  ) {
    const dayRows =
      rowsByDate.get(
        date
      )!;

    /*
      V0.5 후보풀:
      HOME ML:
        EV >= 설정값

      UNDER:
        EV >= 설정값
        totalEdge >= 설정값

      AWAY/OVER/HANDICAP 제외
    */
    const filtered =
      dayRows.filter(
        row => {
          if (
            !row.odds ||
            row.odds <= 1 ||
            row.ev === null
          ) {
            return false;
          }

          if (
            isHomeMl(row)
          ) {
            return (
              row.ev >=
              params.mlMinEv
            );
          }

          if (
            isUnder(row)
          ) {
            return (
              row.ev >=
                params.underMinEv &&
              Math.abs(
                Number(
                  row.totalEdge ??
                  0
                )
              ) >=
                params.totalEdgeMin
            );
          }

          return false;
        }
      );

    if (
      filtered.length === 0
    ) {
      skippedDays += 1;
      continue;
    }

    candidateDays += 1;

    const picks =
      filtered.map(
        toPick
      );

    const combos =
      makeFlexibleAutoCombos(
        picks,
        {
          legs:
            [1,2,3,4,5],

          combosPerLeg:
            3,

          useAnchor:
            params.useAnchor,

          minimumGrade:
            "ALL",

          minimumConfidence:
            0.50,

          minimumEv:
            -0.15,
        }
      );

    const used =
      new Set<string>();

    const first =
      selectDefense(
        combos,
        used
      );

    if (!first) {
      skippedDays += 1;
      continue;
    }

    first.picks.forEach(
      pick =>
        used.add(
          investmentPickKey(
            pick
          )
        )
    );

    const second =
      selectDefense(
        combos,
        used
      );

    /*
      반드시 방어 2장 모두 있어야 베팅
    */
    if (!second) {
      skippedDays += 1;
      continue;
    }

    /*
      2조합 안전형 실제 비율
      첫 방어 60%
      둘째 방어 40%
    */
    const stake1 =
      60000;

    const stake2 =
      40000;

    const settled1 =
      settleCombo(
        first,
        stake1
      );

    const settled2 =
      settleCombo(
        second,
        stake2
      );

    const allPicks = [
      ...first.picks,
      ...second.picks,
    ];

    let mlLegs = 0;
    let underLegs = 0;

    for (
      const pick of
      allPicks
    ) {
      if (
        pick.market === "ML"
      ) {
        mlLegs += 1;
      } else if (
        pick.market ===
        "TOTAL"
      ) {
        underLegs += 1;
      }
    }

    const results = [
      settled1.result,
      settled2.result,
    ];

    dayResults.push({
      date,
      month:
        date.slice(0,7),

      stake:
        DAILY_BANKROLL,

      returned:
        settled1.returned +
        settled2.returned,

      profit:
        settled1.profit +
        settled2.profit,

      ticketWins:
        results.filter(
          x => x === "WIN"
        ).length,

      ticketLosses:
        results.filter(
          x => x === "LOSS"
        ).length,

      ticketVoids:
        results.filter(
          x => x === "VOID"
        ).length,

      mlLegs,
      underLegs,

      totalLegs:
        allPicks.length,

      firstComboOdds:
        first.odds,

      secondComboOdds:
        second.odds,
    });
  }

  return {
    dayResults,
    candidateDays,
    skippedDays,
  };
}


/* =========================================================
   SUMMARY
========================================================= */

function summary(
  list: DayResult[]
) {
  const totalStake =
    list.reduce(
      (sum,x) =>
        sum + x.stake,
      0
    );

  const totalReturned =
    list.reduce(
      (sum,x) =>
        sum + x.returned,
      0
    );

  const profit =
    totalReturned -
    totalStake;

  const profitableDays =
    list.filter(
      x => x.profit > 0
    ).length;

  const losingDays =
    list.filter(
      x => x.profit < 0
    ).length;

  const flatDays =
    list.length -
    profitableDays -
    losingDays;

  /*
    최대 일 손실 연속 횟수
  */
  let currentLossStreak =
    0;

  let maxLossStreak =
    0;

  for (
    const day of list
  ) {
    if (
      day.profit < 0
    ) {
      currentLossStreak +=
        1;

      maxLossStreak =
        Math.max(
          maxLossStreak,
          currentLossStreak
        );
    } else {
      currentLossStreak =
        0;
    }
  }

  const allWinDays =
    list.filter(
      x =>
        x.ticketWins === 2
    ).length;

  const partialDays =
    list.filter(
      x =>
        x.ticketWins === 1
    ).length;

  const wipeoutDays =
    list.filter(
      x =>
        x.ticketLosses === 2
    ).length;

  const mlLegs =
    list.reduce(
      (sum,x) =>
        sum + x.mlLegs,
      0
    );

  const underLegs =
    list.reduce(
      (sum,x) =>
        sum + x.underLegs,
      0
    );

  const totalLegs =
    list.reduce(
      (sum,x) =>
        sum + x.totalLegs,
      0
    );

  const avgTicketOdds =
    list.length
      ? list.reduce(
          (sum,x) =>
            sum +
            x.firstComboOdds +
            x.secondComboOdds,
          0
        ) /
        (list.length * 2)
      : 0;

  return {
    betDays:
      list.length,

    profitableDays,
    losingDays,
    flatDays,

    dayWinRate:
      list.length
        ? Number(
            (
              profitableDays /
              list.length *
              100
            ).toFixed(2)
          )
        : 0,

    allWinDays,
    partialDays,
    wipeoutDays,

    totalStake:
      Math.round(
        totalStake
      ),

    totalReturned:
      Math.round(
        totalReturned
      ),

    profit:
      Math.round(
        profit
      ),

    roi:
      totalStake
        ? Number(
            (
              profit /
              totalStake *
              100
            ).toFixed(2)
          )
        : 0,

    maxLossStreak,

    avgTicketOdds:
      Number(
        avgTicketOdds
          .toFixed(3)
      ),

    mlLegs,
    underLegs,

    avgLegsPerDay:
      list.length
        ? Number(
            (
              totalLegs /
              list.length
            ).toFixed(2)
          )
        : 0,
  };
}


/* =========================================================
   GRID
========================================================= */

const ML_CUTS = [
  0.03,
  0.05,
  0.07,
  0.10,
];

const UNDER_CUTS = [
  0.00,
  0.02,
  0.04,
  0.06,
];

const EDGE_CUTS = [
  0.8,
  1.0,
  1.2,
];

const gridResults:
  any[] = [];

for (
  const useAnchor of
  [false,true]
) {
  for (
    const mlMinEv of
    ML_CUTS
  ) {
    for (
      const underMinEv of
      UNDER_CUTS
    ) {
      for (
        const totalEdgeMin of
        EDGE_CUTS
      ) {
        const params = {
          useAnchor,
          mlMinEv,
          underMinEv,
          totalEdgeMin,
        };

        const run =
          runStrategy(
            params
          );

        const full =
          summary(
            run.dayResults
          );

        const validation =
          summary(
            run.dayResults.filter(
              x =>
                x.date >=
                "2026-07-01"
            )
          );

        gridResults.push({
          anchor:
            useAnchor
              ? "ON"
              : "OFF",

          mlEv:
            mlMinEv,

          underEv:
            underMinEv,

          totalEdge:
            totalEdgeMin,

          candidateDays:
            run.candidateDays,

          skippedDays:
            run.skippedDays,

          ...Object.fromEntries(
            Object.entries(full)
              .map(
                ([k,v]) => [
                  `full_${k}`,
                  v,
                ]
              )
          ),

          ...Object.fromEntries(
            Object.entries(
              validation
            ).map(
              ([k,v]) => [
                `val_${k}`,
                v,
              ]
            )
          ),
        });
      }
    }
  }
}


/* =========================================================
   QUALIFIED
========================================================= */

const qualified =
  gridResults
    .filter(
      x =>
        x.full_roi > 0 &&
        x.val_roi > 0 &&
        x.full_betDays >= 20 &&
        x.val_betDays >= 5
    )
    .sort(
      (a,b) => {
        /*
          최근 검증구간 우선.
          같으면 전체 ROI.
          그래도 같으면 베팅일수.
        */
        if (
          b.val_roi !==
          a.val_roi
        ) {
          return (
            b.val_roi -
            a.val_roi
          );
        }

        if (
          b.full_roi !==
          a.full_roi
        ) {
          return (
            b.full_roi -
            a.full_roi
          );
        }

        return (
          b.full_betDays -
          a.full_betDays
        );
      }
    );


/* =========================================================
   ROBUST SCORE
========================================================= */

/*
  단순 최고 ROI만 뽑으면 과최적화될 수 있으므로
  전체/검증 중 낮은 ROI를 기준으로 보는
  robust score도 같이 계산.
*/

const robust =
  qualified
    .map(
      x => ({
        ...x,

        robustScore:
          Number(
            Math.min(
              x.full_roi,
              x.val_roi
            ).toFixed(2)
          ),
      })
    )
    .sort(
      (a,b) => {
        if (
          b.robustScore !==
          a.robustScore
        ) {
          return (
            b.robustScore -
            a.robustScore
          );
        }

        return (
          b.full_betDays -
          a.full_betDays
        );
      }
    );


/* =========================================================
   OUTPUT TABLE
========================================================= */

function pretty(
  x: any
) {
  return {
    축:
      x.anchor === "ON"
        ? "사용"
        : "미사용",

    홈ML_EV:
      `${Math.round(
        x.mlEv * 100
      )}%`,

    언더_EV:
      `${Math.round(
        x.underEv * 100
      )}%`,

    언더_EDGE:
      x.totalEdge,

    전체일:
      x.full_betDays,

    전체ROI:
      `${x.full_roi}%`,

    전체손익:
      x.full_profit,

    검증일:
      x.val_betDays,

    검증ROI:
      `${x.val_roi}%`,

    검증손익:
      x.val_profit,

    최대연패:
      x.full_maxLossStreak,

    검증최대연패:
      x.val_maxLossStreak,

    평균배당:
      x.full_avgTicketOdds,

    ML픽:
      x.full_mlLegs,

    언더픽:
      x.full_underLegs,

    robust:
      x.robustScore,
  };
}


console.log(
  "\n===== V0.5 GRID SUMMARY ====="
);

console.log(
  "전체 조합:",
  gridResults.length
);

console.log(
  "전체+검증 플러스:",
  qualified.length
);


console.log(
  "\n===== 검증 ROI 상위 20 ====="
);

console.table(
  qualified
    .slice(0,20)
    .map(pretty)
);


console.log(
  "\n===== ROBUST 상위 20 ====="
);

console.table(
  robust
    .slice(0,20)
    .map(pretty)
);


/* =========================================================
   MONTHLY - ROBUST TOP 10
========================================================= */

console.log(
  "\n===== ROBUST TOP 10 월별 ====="
);

const monthlyOutput:
  any[] = [];

for (
  const config of
  robust.slice(0,10)
) {
  const run =
    runStrategy({
      useAnchor:
        config.anchor === "ON",

      mlMinEv:
        config.mlEv,

      underMinEv:
        config.underEv,

      totalEdgeMin:
        config.totalEdge,
    });

  const row: any = {
    축:
      config.anchor === "ON"
        ? "사용"
        : "미사용",

    ML:
      `${Math.round(
        config.mlEv * 100
      )}%`,

    UNDER:
      `${Math.round(
        config.underEv * 100
      )}%`,

    EDGE:
      config.totalEdge,
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
      summary(
        run.dayResults.filter(
          x =>
            x.month === month
        )
      );

    row[month] =
      m.betDays
        ? `${m.roi}% (${m.betDays})`
        : "-";
  }

  row["전체"] =
    `${config.full_roi}%`;

  row["검증"] =
    `${config.val_roi}%`;

  monthlyOutput.push(
    row
  );
}

console.table(
  monthlyOutput
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
        "V0.5 2-combo SAFE parameter grid",

      dailyBankroll:
        DAILY_BANKROLL,

      searchSpace: {
        anchor:
          [false,true],

        mlMinEv:
          ML_CUTS,

        underMinEv:
          UNDER_CUTS,

        totalEdgeMin:
          EDGE_CUTS,
      },

      totalConfigs:
        gridResults.length,

      qualifiedCount:
        qualified.length,

      gridResults,

      qualified,

      robust,
    },
    null,
    2
  )
);

console.log(
  "\nFILE:",
  OUTPUT
);

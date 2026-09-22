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
  "data/kbo-backtest-portfolio-v03-2026.json"
);

const DAILY_AMOUNT = 100000;

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

const rows: Row[] =
  raw.results ?? [];


/* =========================================================
   COMMON
========================================================= */

function pct(
  n: number
) {
  return Number(
    n.toFixed(2)
  );
}

function rowKey(
  gameId: string,
  market: string,
  label: string
) {
  return [
    gameId,
    market,
    label,
  ].join("||");
}

function rowToPick(
  row: Row
): Pick {
  return {
    gameId: row.gameId,
    market: row.market,
    label: row.label,
    grade: row.grade,
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


/* =========================================================
   DATA MAP
========================================================= */

const rowsByDate =
  new Map<string, Row[]>();

const resultMap =
  new Map<string, Row>();

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
    rowKey(
      row.gameId,
      row.market,
      row.label
    ),
    row
  );
}


/* =========================================================
   COMBO SETTLEMENT
========================================================= */

type Combo =
  ReturnType<
    typeof makeFlexibleAutoCombos
  >[number];

function settleCombo(
  combo: Combo
) {
  const legs =
    combo.picks.map(
      pick => {
        const row =
          resultMap.get(
            rowKey(
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
      effectiveOdds: 0,
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
      effectiveOdds: 1,
    };
  }

  const effectiveOdds =
    legs.reduce(
      (total,x) => {
        if (
          x.result === "VOID" ||
          x.result === "PUSH"
        ) {
          return total;
        }

        return (
          total *
          Number(
            x.pick.odds ?? 1
          )
        );
      },
      1
    );

  return {
    result:
      "WIN" as const,
    effectiveOdds,
  };
}


/* =========================================================
   INVESTMENT LOGIC
   현재 page.tsx 그대로 복제
========================================================= */

function pickKey(
  pick: Pick
) {
  return (
    `${pick.gameId}:` +
    `${pick.market}:` +
    `${pick.label}`
  );
}

function investmentComboScore(
  combo: Combo,
  type:
    | "DEFENSE"
    | "BALANCE"
    | "ATTACK"
) {
  if (
    type === "DEFENSE"
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

  if (
    type === "ATTACK"
  ) {
    return (
      Math.log(
        Math.max(
          1,
          combo.odds
        )
      ) *
        18 +
      combo.averageConfidence *
        45 +
      (combo.averageEv ??
        -0.20) *
        25
    );
  }

  return (
    combo.averageConfidence *
      55 +
    combo.probability *
      35 +
    (combo.averageEv ??
      -0.20) *
      30 +
    Math.log(
      Math.max(
        1,
        combo.odds
      )
    ) *
      5
  );
}

function selectInvestmentCombo(
  combos: Combo[],
  legPriority: number[],
  usedPickKeys: Set<string>,
  type:
    | "DEFENSE"
    | "BALANCE"
    | "ATTACK"
) {
  for (
    const leg of
    legPriority
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
                    pickKey(pick)
                  )
              ).length,

            score:
              investmentComboScore(
                combo,
                type
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
   RATIOS
========================================================= */

type Profile =
  | "SAFE"
  | "BALANCED"
  | "AGGRESSIVE";

function ratios(
  count: 2 | 3,
  profile: Profile
) {
  if (
    count === 2
  ) {
    if (
      profile === "SAFE"
    ) {
      return {
        defense: 0.60,
        balance: 0,
        attack: 0.40,
      };
    }

    if (
      profile ===
      "AGGRESSIVE"
    ) {
      return {
        defense: 0.40,
        balance: 0,
        attack: 0.60,
      };
    }

    return {
      defense: 0.60,
      balance: 0.40,
      attack: 0,
    };
  }

  if (
    profile === "SAFE"
  ) {
    return {
      defense: 0.45,
      balance: 0.20,
      attack: 0.35,
    };
  }

  if (
    profile ===
    "AGGRESSIVE"
  ) {
    return {
      defense: 0.20,
      balance: 0.35,
      attack: 0.45,
    };
  }

  return {
    defense: 0.40,
    balance: 0.35,
    attack: 0.25,
  };
}


/* =========================================================
   BUILD PORTFOLIO
========================================================= */

type Plan = {
  key: string;
  combo: Combo;
  ratio: number;
};

function makePortfolio(
  combos: Combo[],
  count: 2 | 3,
  profile: Profile
) {
  const used =
    new Set<string>();

  const register = (
    combo:
      Combo |
      undefined
  ) => {
    if (!combo) return;

    combo.picks.forEach(
      pick =>
        used.add(
          pickKey(pick)
        )
    );
  };

  const r =
    ratios(
      count,
      profile
    );

  let defense:
    Combo | undefined;

  let defense2:
    Combo | undefined;

  let balance:
    Combo | undefined;

  let attack:
    Combo | undefined;

  let attack2:
    Combo | undefined;


  if (
    count === 2 &&
    profile === "SAFE"
  ) {
    defense =
      selectInvestmentCombo(
        combos,
        [2,1],
        used,
        "DEFENSE"
      );

    register(defense);

    defense2 =
      selectInvestmentCombo(
        combos,
        [2,1],
        used,
        "DEFENSE"
      );

  } else if (
    count === 2 &&
    profile === "BALANCED"
  ) {
    balance =
      selectInvestmentCombo(
        combos,
        [3,2],
        used,
        "BALANCE"
      );

    register(balance);

    defense =
      selectInvestmentCombo(
        combos,
        [2,1],
        used,
        "DEFENSE"
      );

  } else if (
    count === 2
  ) {
    attack =
      selectInvestmentCombo(
        combos,
        [5,4,3],
        used,
        "ATTACK"
      );

    register(attack);

    defense =
      selectInvestmentCombo(
        combos,
        [2,1],
        used,
        "DEFENSE"
      );

  } else if (
    profile === "SAFE"
  ) {
    balance =
      selectInvestmentCombo(
        combos,
        [3,2],
        used,
        "BALANCE"
      );

    register(balance);

    defense =
      selectInvestmentCombo(
        combos,
        [2,1],
        used,
        "DEFENSE"
      );

    register(defense);

    defense2 =
      selectInvestmentCombo(
        combos,
        [2,1],
        used,
        "DEFENSE"
      );

  } else if (
    profile ===
    "AGGRESSIVE"
  ) {
    attack =
      selectInvestmentCombo(
        combos,
        [5,4,3],
        used,
        "ATTACK"
      );

    register(attack);

    attack2 =
      selectInvestmentCombo(
        combos,
        [5,4,3],
        used,
        "ATTACK"
      );

    register(attack2);

    defense =
      selectInvestmentCombo(
        combos,
        [2,1],
        used,
        "DEFENSE"
      );

  } else {
    attack =
      selectInvestmentCombo(
        combos,
        [5,4,3],
        used,
        "ATTACK"
      );

    register(attack);

    balance =
      selectInvestmentCombo(
        combos,
        [3,2],
        used,
        "BALANCE"
      );

    register(balance);

    defense =
      selectInvestmentCombo(
        combos,
        [2,1],
        used,
        "DEFENSE"
      );
  }


  const plans: Plan[] =
    [];

  if (defense) {
    plans.push({
      key: "defense",
      combo: defense,
      ratio: r.defense,
    });
  }

  /*
    현재 운영 코드 그대로:
    두 번째 방어는 attack 비율
  */
  if (defense2) {
    plans.push({
      key: "defense2",
      combo: defense2,
      ratio: r.attack,
    });
  }

  if (balance) {
    plans.push({
      key: "balance",
      combo: balance,
      ratio: r.balance,
    });
  }

  if (attack) {
    plans.push({
      key: "attack",
      combo: attack,
      ratio: r.attack,
    });
  }

  /*
    현재 운영 코드 그대로:
    두 번째 공격은 balance 비율
  */
  if (attack2) {
    plans.push({
      key: "attack2",
      combo: attack2,
      ratio: r.balance,
    });
  }

  return plans;
}


/* =========================================================
   RUN
========================================================= */

type PortfolioRecord = {
  date: string;
  month: string;

  anchor:
    | "ON"
    | "OFF";

  planCount:
    2 | 3;

  profile:
    Profile;

  plannedAmount:
    number;

  actualStake:
    number;

  returned:
    number;

  profit:
    number;

  result:
    | "ALL_WIN"
    | "PARTIAL_WIN"
    | "ALL_LOSS";

  wins: number;
  losses: number;
  voids: number;

  plans: any[];
};

const records:
  PortfolioRecord[] = [];

const dates =
  [...rowsByDate.keys()]
    .sort();

for (
  const useAnchor of
  [false,true]
) {
  for (
    const date of dates
  ) {
    const dayRows =
      rowsByDate.get(
        date
      )!;

    /*
      V0.3 검증 픽풀

      1) HOME ML
         - 홈팀 승 선택지만 사용
         - EV > 3%

      2) TOTAL UNDER
         - 언더만 사용
         - EV > 0
         - 예상득점과 기준점 차이 >= 0.8

      제외:
      - AWAY ML
      - OVER
      - HANDICAP
    */
    const filteredRows =
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
            row.market === "ML"
          ) {
            const normalizedLabel =
              String(row.label)
                .replace(/\s+/g, "")
                .toLowerCase();

            const normalizedHome =
              String(row.homeTeam)
                .replace(/\s+/g, "")
                .toLowerCase();

            const isHome =
              normalizedLabel.includes(
                normalizedHome
              ) ||
              normalizedLabel.includes("홈");

            return (
              isHome &&
              row.ev > 0.03
            );
          }

          if (
            row.market === "TOTAL"
          ) {
            const normalizedLabel =
              String(row.label)
                .replace(/\s+/g, "")
                .toLowerCase();

            const isUnder =
              normalizedLabel.includes("언더") ||
              normalizedLabel.includes("under");

            const edge =
              Math.abs(
                Number(
                  row.totalEdge ?? 0
                )
              );

            return (
              isUnder &&
              row.ev > 0 &&
              edge >= 0.8
            );
          }

          return false;
        }
      );

    const picks =
      filteredRows
        .map(rowToPick);

    /*
      실제 기본 조합 설정.
      투자 로직이 1~5폴을 모두 사용할 수 있으므로
      전부 생성한다.
    */
    const combos =
      makeFlexibleAutoCombos(
        picks,
        {
          legs:
            [1,2,3,4,5],

          combosPerLeg:
            3,

          useAnchor,

          minimumGrade:
            "ALL",

          minimumConfidence:
            0.50,

          minimumEv:
            -0.15,
        }
      );


    for (
      const planCount of
      [2,3] as const
    ) {
      for (
        const profile of
        [
          "SAFE",
          "BALANCED",
          "AGGRESSIVE",
        ] as const
      ) {
        const plans =
          makePortfolio(
            combos,
            planCount,
            profile
          );

        if (
          plans.length === 0
        ) {
          continue;
        }

        let actualStake =
          0;

        let returned =
          0;

        let wins =
          0;

        let losses =
          0;

        let voids =
          0;

        const details =
          plans.map(
            plan => {
              const stake =
                Math.round(
                  DAILY_AMOUNT *
                  plan.ratio
                );

              const settled =
                settleCombo(
                  plan.combo
                );

              let comboReturn =
                0;

              if (
                settled.result ===
                "WIN"
              ) {
                wins += 1;

                comboReturn =
                  stake *
                  settled
                    .effectiveOdds;

              } else if (
                settled.result ===
                "VOID"
              ) {
                voids += 1;

                comboReturn =
                  stake;

              } else {
                losses += 1;
              }

              actualStake +=
                stake;

              returned +=
                comboReturn;

              return {
                key:
                  plan.key,

                ratio:
                  plan.ratio,

                stake,

                comboName:
                  plan.combo.name,

                legs:
                  plan.combo
                    .picks.length,

                odds:
                  Number(
                    plan.combo
                      .odds
                      .toFixed(4)
                  ),

                result:
                  settled.result,

                effectiveOdds:
                  Number(
                    settled
                      .effectiveOdds
                      .toFixed(4)
                  ),

                returned:
                  Math.round(
                    comboReturn
                  ),

                picks:
                  plan.combo
                    .picks
                    .map(
                      p => ({
                        gameId:
                          p.gameId,
                        market:
                          p.market,
                        label:
                          p.label,
                        odds:
                          p.odds,
                      })
                    ),
              };
            }
          );


        const result =
          wins ===
            plans.length
            ? "ALL_WIN"
            : wins > 0 ||
                voids > 0
              ? "PARTIAL_WIN"
              : "ALL_LOSS";

        records.push({
          date,
          month:
            date.slice(0,7),

          anchor:
            useAnchor
              ? "ON"
              : "OFF",

          planCount,
          profile,

          plannedAmount:
            DAILY_AMOUNT,

          actualStake,

          returned:
            Math.round(
              returned
            ),

          profit:
            Math.round(
              returned -
              actualStake
            ),

          result,

          wins,
          losses,
          voids,

          plans:
            details,
        });
      }
    }
  }
}


/* =========================================================
   SUMMARY
========================================================= */

function summarize(
  list:
    PortfolioRecord[]
) {
  const totalStake =
    list.reduce(
      (sum,x) =>
        sum +
        x.actualStake,
      0
    );

  const totalReturned =
    list.reduce(
      (sum,x) =>
        sum +
        x.returned,
      0
    );

  const profit =
    totalReturned -
    totalStake;

  const profitableDays =
    list.filter(
      x =>
        x.profit > 0
    ).length;

  const lossDays =
    list.filter(
      x =>
        x.profit < 0
    ).length;

  const breakevenDays =
    list.length -
    profitableDays -
    lossDays;

  const allWin =
    list.filter(
      x =>
        x.result ===
        "ALL_WIN"
    ).length;

  const partial =
    list.filter(
      x =>
        x.result ===
        "PARTIAL_WIN"
    ).length;

  const allLoss =
    list.filter(
      x =>
        x.result ===
        "ALL_LOSS"
    ).length;

  return {
    days:
      list.length,

    profitableDays,

    lossDays,

    breakevenDays,

    allWin,
    partial,
    allLoss,

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
        ? pct(
            profit /
            totalStake *
            100
          )
        : 0,
  };
}

function profileName(
  p: Profile
) {
  if (
    p === "SAFE"
  ) return "안전";

  if (
    p === "BALANCED"
  ) return "균형";

  return "공격";
}


/* =========================================================
   OVERALL
========================================================= */

console.log(
  "\n===== V0.3 픽풀 포트폴리오 전체 비교 ====="
);

const overallRows:
  any[] = [];

for (
  const anchor of
  ["OFF","ON"] as const
) {
  for (
    const count of
    [2,3] as const
  ) {
    for (
      const profile of
      [
        "SAFE",
        "BALANCED",
        "AGGRESSIVE",
      ] as const
    ) {
      const list =
        records.filter(
          x =>
            x.anchor ===
              anchor &&
            x.planCount ===
              count &&
            x.profile ===
              profile
        );

      overallRows.push({
        anchor:
          anchor === "ON"
            ? "축사용"
            : "축미사용",

        strategy:
          `${count}조합 ${profileName(profile)}`,

        ...summarize(list),
      });
    }
  }
}

console.table(
  overallRows
);


/* =========================================================
   VALIDATION
========================================================= */

console.log(
  "\n===== V0.3 픽풀 7~9월 검증구간 ====="
);

const validationRows:
  any[] = [];

for (
  const anchor of
  ["OFF","ON"] as const
) {
  for (
    const count of
    [2,3] as const
  ) {
    for (
      const profile of
      [
        "SAFE",
        "BALANCED",
        "AGGRESSIVE",
      ] as const
    ) {
      const list =
        records.filter(
          x =>
            x.date >=
              "2026-07-01" &&
            x.anchor ===
              anchor &&
            x.planCount ===
              count &&
            x.profile ===
              profile
        );

      validationRows.push({
        anchor:
          anchor === "ON"
            ? "축사용"
            : "축미사용",

        strategy:
          `${count}조합 ${profileName(profile)}`,

        ...summarize(list),
      });
    }
  }
}

console.table(
  validationRows
);


/* =========================================================
   MONTHLY
========================================================= */

console.log(
  "\n===== 월별 ROI ====="
);

for (
  const anchor of
  ["OFF","ON"] as const
) {
  for (
    const count of
    [2,3] as const
  ) {
    for (
      const profile of
      [
        "SAFE",
        "BALANCED",
        "AGGRESSIVE",
      ] as const
    ) {
      const base =
        records.filter(
          x =>
            x.anchor ===
              anchor &&
            x.planCount ===
              count &&
            x.profile ===
              profile
        );

      if (
        base.length === 0
      ) {
        continue;
      }

      console.log(
        `\n--- ${
          anchor === "ON"
            ? "축사용"
            : "축미사용"
        } / ${count}조합 / ${profileName(profile)} ---`
      );

      const months =
        [...new Set(
          base.map(
            x => x.month
          )
        )]
          .sort();

      console.table(
        months.map(
          month => ({
            month,
            ...summarize(
              base.filter(
                x =>
                  x.month ===
                  month
              )
            ),
          })
        )
      );
    }
  }
}


/* =========================================================
   SAVE
========================================================= */

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(
    {
      generatedAt:
        new Date().toISOString(),

      dailyInvestmentAmount:
        DAILY_AMOUNT,

      strategy:
        "V0.3_HOME_ML_EV3_OR_UNDER",

      avoidInvestmentOverlap:
        true,

      comboSettings: {
        legs:
          [1,2,3,4,5],

        combosPerLeg:
          3,

        minimumGrade:
          "ALL",

        minimumConfidence:
          0.50,

        minimumEv:
          -0.15,
      },

      overall:
        overallRows,

      validation:
        validationRows,

      records,
    },
    null,
    2
  )
);

console.log(
  "\nFILE:",
  OUTPUT
);

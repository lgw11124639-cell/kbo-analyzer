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
  "data/kbo-backtest-combos-2026.json"
);

const STAKE = 10000;

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

  totalEdge: number | null;

  passesCurrentFilter: boolean;

  result:
    | "WIN"
    | "LOSS"
    | "PUSH"
    | "VOID";

  returned: number;
  profit: number;
};

const rows: Row[] =
  raw.results ?? [];


/* =========================================================
   COMMON
========================================================= */

function pct(
  value: number
) {
  return Number(
    value.toFixed(2)
  );
}

function sideOf(
  row: Row
) {
  if (row.market === "ML") {
    if (
      row.label.includes(
        `${row.homeTeam} 승`
      )
    ) {
      return "HOME";
    }

    if (
      row.label.includes(
        `${row.awayTeam} 승`
      )
    ) {
      return "AWAY";
    }
  }

  if (
    row.market === "TOTAL"
  ) {
    if (
      row.label.includes("언더")
    ) {
      return "UNDER";
    }

    if (
      row.label.includes("오버")
    ) {
      return "OVER";
    }
  }

  return "?";
}

function rowToPick(
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


/* =========================================================
   DATE / GAME GROUP
========================================================= */

const rowsByDate =
  new Map<string, Row[]>();

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
}

const resultMap =
  new Map<string, Row>();

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

for (
  const row of rows
) {
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
   SINGLE PICK STRATEGIES
========================================================= */

const rowsByGame =
  new Map<string, Row[]>();

for (
  const row of rows
) {
  if (
    row.result !== "WIN" &&
    row.result !== "LOSS"
  ) {
    continue;
  }

  if (
    !rowsByGame.has(
      row.gameId
    )
  ) {
    rowsByGame.set(
      row.gameId,
      []
    );
  }

  rowsByGame
    .get(row.gameId)!
    .push(row);
}

function currentPick(
  list: Row[]
) {
  return (
    list.find(
      row =>
        row.passesCurrentFilter ===
        true
    ) ?? null
  );
}

function v03Pick(
  list: Row[]
) {
  const under =
    list
      .filter(
        row =>
          row.market ===
            "TOTAL" &&
          sideOf(row) ===
            "UNDER" &&
          Number(
            row.ev ?? -999
          ) > 0 &&
          Number(
            row.totalEdge ?? 0
          ) >= 0.8
      )
      .sort(
        (a,b) =>
          Number(b.ev ?? -999) -
          Number(a.ev ?? -999)
      )[0] ?? null;

  if (under) {
    return under;
  }

  return (
    list
      .filter(
        row =>
          row.market ===
            "ML" &&
          sideOf(row) ===
            "HOME" &&
          Number(
            row.ev ?? -999
          ) > 0.03
      )
      .sort(
        (a,b) =>
          Number(b.ev ?? -999) -
          Number(a.ev ?? -999)
      )[0] ?? null
  );
}


/* =========================================================
   SINGLE SUMMARY
========================================================= */

function summarizeSingles(
  list: Row[]
) {
  const settled =
    list.filter(
      x =>
        x.result === "WIN" ||
        x.result === "LOSS"
    );

  const wins =
    settled.filter(
      x =>
        x.result === "WIN"
    ).length;

  const losses =
    settled.length - wins;

  const stake =
    settled.length *
    STAKE;

  const returned =
    settled.reduce(
      (sum,row) =>
        sum +
        (
          row.result === "WIN"
            ? STAKE *
              Number(row.odds ?? 1)
            : 0
        ),
      0
    );

  const profit =
    returned -
    stake;

  return {
    bets:
      settled.length,

    wins,
    losses,

    hitRate:
      settled.length
        ? pct(
            wins /
            settled.length *
            100
          )
        : 0,

    avgOdds:
      settled.length
        ? Number(
            (
              settled.reduce(
                (sum,row) =>
                  sum +
                  Number(
                    row.odds ?? 0
                  ),
                0
              ) /
              settled.length
            ).toFixed(3)
          )
        : 0,

    totalStake:
      Math.round(stake),

    totalReturned:
      Math.round(returned),

    profit:
      Math.round(profit),

    roi:
      stake
        ? pct(
            profit /
            stake *
            100
          )
        : 0,
  };
}

const singleOutputs = {
  CURRENT:
    [] as Row[],

  V03_UNDER_THEN_HOME_EV3:
    [] as Row[],
};

for (
  const list of
  rowsByGame.values()
) {
  const current =
    currentPick(list);

  if (current) {
    singleOutputs
      .CURRENT
      .push(current);
  }

  const v03 =
    v03Pick(list);

  if (v03) {
    singleOutputs
      .V03_UNDER_THEN_HOME_EV3
      .push(v03);
  }
}


/* =========================================================
   COMBO SETTLEMENT
========================================================= */

type ComboRecord = {
  date: string;
  month: string;

  name: string;
  style: string;

  legs: number;

  odds: number;
  effectiveOdds: number;

  probability: number;

  result:
    | "WIN"
    | "LOSS"
    | "VOID";

  stake: number;
  returned: number;
  profit: number;

  picks: {
    gameId: string;
    market: string;
    label: string;
    odds: number | null;
    result:
      | "WIN"
      | "LOSS"
      | "PUSH"
      | "VOID";
  }[];
};

function settleCombo(
  combo: ReturnType<
    typeof makeFlexibleAutoCombos
  >[number]
) {
  const settledPicks =
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
          row,
          result:
            row?.result ??
            "VOID",
        };
      }
    );

  /*
    사이트 정산 규칙:
    하나라도 LOSS -> 조합 LOSS
  */
  if (
    settledPicks.some(
      x =>
        x.result === "LOSS"
    )
  ) {
    return {
      result:
        "LOSS" as const,

      effectiveOdds:
        0,

      returned:
        0,

      picks:
        settledPicks,
    };
  }

  /*
    전부 PUSH/VOID면
    조합 전체 VOID
  */
  const onlyVoidOrPush =
    settledPicks.every(
      x =>
        x.result === "VOID" ||
        x.result === "PUSH"
    );

  if (
    onlyVoidOrPush
  ) {
    return {
      result:
        "VOID" as const,

      effectiveOdds:
        1,

      returned:
        STAKE,

      picks:
        settledPicks,
    };
  }

  /*
    PUSH/VOID는 1배 처리.
    WIN 픽의 배당만 곱한다.
  */
  const effectiveOdds =
    settledPicks.reduce(
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

    returned:
      STAKE *
      effectiveOdds,

    picks:
      settledPicks,
  };
}


/* =========================================================
   RUN CURRENT AUTO COMBO
========================================================= */

/*
  현재 사이트 기본 설정 그대로.
  사용자가 브라우저에서 변경 저장한 개인 설정은
  계정마다 다를 수 있으므로 여기서는 기본값 기준.
*/
const SETTINGS = {
  legs:
    [2,3],

  combosPerLeg:
    3,

  useAnchor:
    false,

  minimumGrade:
    "ALL" as const,

  minimumConfidence:
    0.50,

  minimumEv:
    -0.15,
};

const comboRecords:
  ComboRecord[] = [];

const dates =
  [...rowsByDate.keys()]
    .sort();

for (
  const date of dates
) {
  const dayRows =
    rowsByDate.get(date)!;

  const month =
    date.slice(0,7);

  const allPicks =
    dayRows.map(
      rowToPick
    );

  const combos =
    makeFlexibleAutoCombos(
      allPicks,
      SETTINGS
    );

  for (
    const combo of combos
  ) {
    /*
      2폴/3폴만
    */
    if (
      combo.picks.length !== 2 &&
      combo.picks.length !== 3
    ) {
      continue;
    }

    const settlement =
      settleCombo(combo);

    const returned =
      settlement.returned;

    comboRecords.push({
      date,
      month,

      name:
        combo.name,

      style:
        combo.style,

      legs:
        combo.picks.length,

      odds:
        Number(
          combo.odds.toFixed(4)
        ),

      effectiveOdds:
        Number(
          settlement
            .effectiveOdds
            .toFixed(4)
        ),

      probability:
        Number(
          combo.probability
            .toFixed(6)
        ),

      result:
        settlement.result,

      stake:
        STAKE,

      returned:
        Math.round(returned),

      profit:
        Math.round(
          returned -
          STAKE
        ),

      picks:
        settlement.picks.map(
          x => ({
            gameId:
              x.pick.gameId,

            market:
              x.pick.market,

            label:
              x.pick.label,

            odds:
              x.pick.odds,

            result:
              x.result,
          })
        ),
    });
  }
}


/* =========================================================
   COMBO SUMMARY
========================================================= */

function summarizeCombos(
  list: ComboRecord[]
) {
  const wins =
    list.filter(
      x =>
        x.result === "WIN"
    ).length;

  const losses =
    list.filter(
      x =>
        x.result === "LOSS"
    ).length;

  const voids =
    list.filter(
      x =>
        x.result === "VOID"
    ).length;

  const decided =
    wins +
    losses;

  const stake =
    list.reduce(
      (sum,x) =>
        sum + x.stake,
      0
    );

  const returned =
    list.reduce(
      (sum,x) =>
        sum +
        x.returned,
      0
    );

  const profit =
    returned -
    stake;

  return {
    bets:
      list.length,

    wins,
    losses,
    voids,

    hitRate:
      decided
        ? pct(
            wins /
            decided *
            100
          )
        : 0,

    avgOdds:
      list.length
        ? Number(
            (
              list.reduce(
                (sum,x) =>
                  sum +
                  x.odds,
                0
              ) /
              list.length
            ).toFixed(3)
          )
        : 0,

    totalStake:
      Math.round(stake),

    totalReturned:
      Math.round(returned),

    profit:
      Math.round(profit),

    roi:
      stake
        ? pct(
            profit /
            stake *
            100
          )
        : 0,
  };
}

function styleName(
  style: string
) {
  if (
    style === "SAFE"
  ) {
    return "방어";
  }

  if (
    style === "BALANCED"
  ) {
    return "균형";
  }

  if (
    style === "HIGH_ODDS"
  ) {
    return "공격";
  }

  return style;
}


/* =========================================================
   PRINT
========================================================= */

console.log(
  "\n===== 단일 추천픽 ====="
);

console.table([
  {
    strategy:
      "기존 CURRENT",

    ...summarizeSingles(
      singleOutputs.CURRENT
    ),
  },
  {
    strategy:
      "V0.3 언더→홈ML(EV>3%)",

    ...summarizeSingles(
      singleOutputs
        .V03_UNDER_THEN_HOME_EV3
    ),
  },
]);


console.log(
  "\n===== 자동조합 전체 ====="
);

const comboOverall: any[] =
  [];

for (
  const legs of [2,3]
) {
  for (
    const style of [
      "SAFE",
      "BALANCED",
      "HIGH_ODDS",
    ]
  ) {
    const list =
      comboRecords.filter(
        x =>
          x.legs === legs &&
          x.style === style
      );

    comboOverall.push({
      strategy:
        `${legs}폴 ${styleName(style)}`,

      ...summarizeCombos(
        list
      ),
    });
  }
}

console.table(
  comboOverall
);


console.log(
  "\n===== 자동조합 월별 ====="
);

for (
  const legs of [2,3]
) {
  for (
    const style of [
      "SAFE",
      "BALANCED",
      "HIGH_ODDS",
    ]
  ) {
    const base =
      comboRecords.filter(
        x =>
          x.legs === legs &&
          x.style === style
      );

    console.log(
      `\n--- ${legs}폴 ${styleName(style)} ---`
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

          ...summarizeCombos(
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


/* =========================================================
   SINGLE MONTHLY V0.3
========================================================= */

console.log(
  "\n===== V0.3 단일추천 월별 ====="
);

const singleMonths =
  [...new Set(
    singleOutputs
      .V03_UNDER_THEN_HOME_EV3
      .map(
        x => x.month
      )
  )]
    .sort();

console.table(
  singleMonths.map(
    month => ({
      month,

      ...summarizeSingles(
        singleOutputs
          .V03_UNDER_THEN_HOME_EV3
          .filter(
            x =>
              x.month ===
              month
          )
      ),
    })
  )
);


/* =========================================================
   VALIDATION 7~9월
========================================================= */

console.log(
  "\n===== 7~9월 검증구간 ====="
);

const validationTable: any[] =
  [
    {
      strategy:
        "V0.3 단일추천",

      ...summarizeSingles(
        singleOutputs
          .V03_UNDER_THEN_HOME_EV3
          .filter(
            x =>
              x.date >=
              "2026-07-01"
          )
      ),
    },
  ];

for (
  const legs of [2,3]
) {
  for (
    const style of [
      "SAFE",
      "BALANCED",
      "HIGH_ODDS",
    ]
  ) {
    const list =
      comboRecords.filter(
        x =>
          x.date >=
            "2026-07-01" &&
          x.legs === legs &&
          x.style === style
      );

    validationTable.push({
      strategy:
        `${legs}폴 ${styleName(style)}`,

      ...summarizeCombos(
        list
      ),
    });
  }
}

console.table(
  validationTable
);


/* =========================================================
   SAVE
========================================================= */

const output = {
  generatedAt:
    new Date().toISOString(),

  stakePerBet:
    STAKE,

  methodology: {
    comboEngine:
      "makeFlexibleAutoCombos current production function",

    comboSettings:
      SETTINGS,

    singleV03:
      "TOTAL UNDER EV>0 edge>=0.8 first, otherwise HOME ML EV>3%",

    settlement:
      "LOSS if any leg loses; PUSH/VOID removed from effective odds; all PUSH/VOID => VOID",
  },

  singles: {
    current: {
      summary:
        summarizeSingles(
          singleOutputs.CURRENT
        ),

      results:
        singleOutputs.CURRENT,
    },

    v03: {
      summary:
        summarizeSingles(
          singleOutputs
            .V03_UNDER_THEN_HOME_EV3
        ),

      results:
        singleOutputs
          .V03_UNDER_THEN_HOME_EV3,
    },
  },

  combos: {
    summary:
      comboOverall,

    results:
      comboRecords,
  },
};

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(
    output,
    null,
    2
  )
);

console.log(
  "\nFILE:",
  OUTPUT
);

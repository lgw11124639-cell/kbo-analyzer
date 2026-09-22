import fs from "fs";
import path from "path";

const INPUT = path.join(
  process.cwd(),
  "data/kbo-backtest-all-candidates-2026.json"
);

const OUTPUT = path.join(
  process.cwd(),
  "data/kbo-backtest-v10-total-direction-2x2-2026.json"
);

const raw = JSON.parse(
  fs.readFileSync(INPUT, "utf8")
);

type Result =
  | "WIN"
  | "LOSS"
  | "PUSH"
  | "VOID";

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
  confidence: number;
  ev: number | null;
  odds: number | null;
  totalEdge?: number | null;
  projectedTotal?: number | null;
  totalLine?: number | null;
  result: Result;
};

const rows: Row[] =
  raw.results ?? [];

const byDate =
  new Map<string, Row[]>();

for (const row of rows) {
  if (!byDate.has(row.date)) {
    byDate.set(row.date, []);
  }

  byDate.get(row.date)!.push(row);
}

const dates =
  [...byDate.keys()].sort();


/* =========================================================
   HELPERS
========================================================= */

function norm(v: string) {
  return String(v ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function isHomeMl(row: Row) {
  if (row.market !== "ML") {
    return false;
  }

  const team =
    norm(
      String(row.label ?? "")
        .replace(/\s*승\s*$/, "")
    );

  return team ===
    norm(row.homeTeam);
}

function isUnder(row: Row) {
  return (
    row.market === "TOTAL" &&
    (
      norm(row.label).includes("언더") ||
      norm(row.label).includes("under")
    )
  );
}

function isOver(row: Row) {
  return (
    row.market === "TOTAL" &&
    (
      norm(row.label).includes("오버") ||
      norm(row.label).includes("over")
    )
  );
}

function pickScore(row: Row) {
  return (
    row.confidence * 100 +
    (row.ev ?? -0.30) * 20
  );
}

function settle(
  picks: Row[],
  stake: number
) {
  if (
    picks.some(
      x => x.result === "LOSS"
    )
  ) {
    return {
      result: "LOSS",
      returned: 0,
      profit: -stake,
    };
  }

  const active =
    picks.filter(
      x =>
        x.result !== "VOID" &&
        x.result !== "PUSH"
    );

  if (!active.length) {
    return {
      result: "VOID",
      returned: stake,
      profit: 0,
    };
  }

  const odds =
    active.reduce(
      (v,x) =>
        v * Number(x.odds ?? 1),
      1
    );

  const returned =
    stake * odds;

  return {
    result: "WIN",
    returned,
    profit:
      returned - stake,
  };
}


/* =========================================================
   TOTAL MODE
========================================================= */

type TotalMode =
  | "UNDER"
  | "OVER"
  | "BEST";

function totalCandidates(
  day: Row[],
  mode: TotalMode,
  minEv: number,
  minEdge: number,
  minConf: number
) {
  let list =
    day.filter(row =>
      row.market === "TOTAL" &&
      (row.odds ?? 0) > 1 &&
      row.ev !== null &&
      row.ev >= minEv &&
      Math.abs(
        Number(
          row.totalEdge ?? 0
        )
      ) >= minEdge &&
      row.confidence >= minConf
    );

  if (mode === "UNDER") {
    list =
      list.filter(isUnder);
  }

  if (mode === "OVER") {
    list =
      list.filter(isOver);
  }

  if (mode === "BEST") {
    /*
      같은 경기 UNDER/OVER 중
      score가 높은 한 방향만 유지.
    */
    const best =
      new Map<string, Row>();

    for (const row of list) {
      const old =
        best.get(row.gameId);

      if (
        !old ||
        pickScore(row) >
          pickScore(old)
      ) {
        best.set(
          row.gameId,
          row
        );
      }
    }

    list =
      [...best.values()];
  }

  return list.sort(
    (a,b) =>
      pickScore(b) -
      pickScore(a)
  );
}


/* =========================================================
   PORTFOLIO STRUCTURE
========================================================= */

type Structure =
  | "SHARED_TOTAL"
  | "SPLIT_TOTAL";

type Ratio =
  | "50_50"
  | "60_40"
  | "70_30";

function stakes(
  ratio: Ratio
) {
  if (ratio === "50_50") {
    return [50000,50000];
  }

  if (ratio === "70_30") {
    return [70000,30000];
  }

  return [60000,40000];
}

function build(
  day: Row[],
  structure: Structure,
  mode: TotalMode,
  mlEv: number,
  mlConf: number,
  totalEv: number,
  edge: number,
  totalConf: number
) {
  const totals =
    totalCandidates(
      day,
      mode,
      totalEv,
      edge,
      totalConf
    );

  const homes =
    day.filter(row =>
      isHomeMl(row) &&
      (row.odds ?? 0) > 1 &&
      row.ev !== null &&
      row.ev >= mlEv &&
      row.confidence >= mlConf
    )
    .sort(
      (a,b) =>
        pickScore(b) -
        pickScore(a)
    );

  if (
    structure ===
    "SHARED_TOTAL"
  ) {
    for (const total of totals) {
      const usableHomes =
        homes.filter(
          h =>
            h.gameId !==
            total.gameId
        );

      if (
        usableHomes.length >= 2
      ) {
        return {
          ticket1: [
            total,
            usableHomes[0],
          ] as Row[],

          ticket2: [
            total,
            usableHomes[1],
          ] as Row[],
        };
      }
    }

    return null;
  }


  /*
    SPLIT TOTAL:
    T1 + ML1
    T2 + ML2

    TOTAL 두 개도 다른 경기,
    HOME ML 두 개도 다른 경기,
    네 픽 모두 서로 다른 경기.
  */
  for (
    let i = 0;
    i < totals.length;
    i++
  ) {
    for (
      let j = i + 1;
      j < totals.length;
      j++
    ) {
      for (
        let h1 = 0;
        h1 < homes.length;
        h1++
      ) {
        for (
          let h2 = h1 + 1;
          h2 < homes.length;
          h2++
        ) {
          const gameIds =
            new Set([
              totals[i].gameId,
              totals[j].gameId,
              homes[h1].gameId,
              homes[h2].gameId,
            ]);

          if (
            gameIds.size !== 4
          ) {
            continue;
          }

          return {
            ticket1: [
              totals[i],
              homes[h1],
            ] as Row[],

            ticket2: [
              totals[j],
              homes[h2],
            ] as Row[],
          };
        }
      }
    }
  }

  return null;
}


/* =========================================================
   RUN
========================================================= */

type Params = {
  structure: Structure;
  mode: TotalMode;
  ratio: Ratio;

  mlEv: number;
  mlConf: number;

  totalEv: number;
  edge: number;
  totalConf: number;
};

function run(p: Params) {
  const results:any[] = [];

  for (const date of dates) {
    const day =
      byDate.get(date)!;

    const built =
      build(
        day,
        p.structure,
        p.mode,
        p.mlEv,
        p.mlConf,
        p.totalEv,
        p.edge,
        p.totalConf
      );

    if (!built) {
      continue;
    }

    const [s1,s2] =
      stakes(p.ratio);

    const r1 =
      settle(
        built.ticket1,
        s1
      );

    const r2 =
      settle(
        built.ticket2,
        s2
      );

    const wins =
      [r1.result,r2.result]
        .filter(
          x => x === "WIN"
        )
        .length;

    results.push({
      date,
      month:
        date.slice(0,7),

      stake:
        s1 + s2,

      returned:
        r1.returned +
        r2.returned,

      profit:
        r1.profit +
        r2.profit,

      wins,

      ticket1:
        built.ticket1.map(x => ({
          game:
            `${x.awayTeam} @ ${x.homeTeam}`,
          market:
            x.market,
          label:
            x.label,
          odds:
            x.odds,
          ev:
            x.ev,
          conf:
            x.confidence,
          result:
            x.result,
        })),

      ticket2:
        built.ticket2.map(x => ({
          game:
            `${x.awayTeam} @ ${x.homeTeam}`,
          market:
            x.market,
          label:
            x.label,
          odds:
            x.odds,
          ev:
            x.ev,
          conf:
            x.confidence,
          result:
            x.result,
        })),
    });
  }

  return results;
}


/* =========================================================
   SUMMARY
========================================================= */

function summary(
  list:any[]
) {
  const stake =
    list.reduce(
      (s,x) =>
        s + x.stake,
      0
    );

  const returned =
    list.reduce(
      (s,x) =>
        s + x.returned,
      0
    );

  const profit =
    returned - stake;

  const allWin =
    list.filter(
      x => x.wins === 2
    ).length;

  const partial =
    list.filter(
      x => x.wins === 1
    ).length;

  const wipeout =
    list.filter(
      x => x.wins === 0
    ).length;

  let equity = 0;
  let peak = 0;
  let mdd = 0;

  let lossStreak = 0;
  let maxLossStreak = 0;

  for (const row of list) {
    equity +=
      row.profit;

    peak =
      Math.max(
        peak,
        equity
      );

    mdd =
      Math.max(
        mdd,
        peak - equity
      );

    if (
      row.profit < 0
    ) {
      lossStreak++;

      maxLossStreak =
        Math.max(
          maxLossStreak,
          lossStreak
        );
    } else {
      lossStreak = 0;
    }
  }

  return {
    days:
      list.length,

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

    allWin,
    partial,
    wipeout,

    maxLossStreak,

    mdd:
      Math.round(mdd),
  };
}


/* =========================================================
   GRID
========================================================= */

const MODES:TotalMode[] = [
  "UNDER",
  "OVER",
  "BEST",
];

const STRUCTURES:Structure[] = [
  "SHARED_TOTAL",
  "SPLIT_TOTAL",
];

const RATIOS:Ratio[] = [
  "50_50",
  "60_40",
  "70_30",
];

const ML_EV = [
  -0.16,
  -0.15,
  -0.14,
];

const ML_CONF = [
  0.51,
  0.52,
  0.53,
];

const TOTAL_EV = [
  0,
  0.01,
];

const EDGE = [
  1.0,
  1.1,
  1.2,
  1.3,
];

const TOTAL_CONF = [
  0.50,
  0.52,
  0.54,
];

const all:any[] = [];

for (const mode of MODES) {
  for (const structure of STRUCTURES) {
    for (const ratio of RATIOS) {
      for (const mlEv of ML_EV) {
        for (const mlConf of ML_CONF) {
          for (const totalEv of TOTAL_EV) {
            for (const edge of EDGE) {
              for (const totalConf of TOTAL_CONF) {

                const params = {
                  mode,
                  structure,
                  ratio,
                  mlEv,
                  mlConf,
                  totalEv,
                  edge,
                  totalConf,
                };

                const results =
                  run(params);

                const full =
                  summary(results);

                const val =
                  summary(
                    results.filter(
                      x =>
                        x.date >=
                        "2026-07-01"
                    )
                  );

                all.push({
                  ...params,

                  fullDays:
                    full.days,

                  fullROI:
                    full.roi,

                  fullProfit:
                    full.profit,

                  fullAllWin:
                    full.allWin,

                  fullPartial:
                    full.partial,

                  fullWipeout:
                    full.wipeout,

                  fullMDD:
                    full.mdd,

                  fullLossStreak:
                    full.maxLossStreak,

                  valDays:
                    val.days,

                  valROI:
                    val.roi,

                  valProfit:
                    val.profit,

                  valMDD:
                    val.mdd,

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
      }
    }
  }
}

const qualified =
  all
    .filter(
      x =>
        x.fullDays >= 8 &&
        x.valDays >= 3 &&
        x.fullROI > 0 &&
        x.valROI > 0
    )
    .sort(
      (a,b) =>
        b.robust -
          a.robust ||
        b.valDays -
          a.valDays ||
        b.fullDays -
          a.fullDays
    );

function pretty(
  x:any,
  i:number
) {
  return {
    순위:
      i+1,

    방향:
      x.mode,

    구조:
      x.structure,

    비율:
      x.ratio,

    ML_EV:
      `${(x.mlEv*100).toFixed(0)}%`,

    ML_CONF:
      `${Math.round(
        x.mlConf*100
      )}%`,

    T_EV:
      `${Math.round(
        x.totalEv*100
      )}%`,

    EDGE:
      x.edge,

    T_CONF:
      `${Math.round(
        x.totalConf*100
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

    올킬:
      x.fullAllWin,

    반쪽:
      x.fullPartial,

    전멸:
      x.fullWipeout,

    연패:
      x.fullLossStreak,

    MDD:
      x.fullMDD,
  };
}


/* =========================================================
   OUTPUT
========================================================= */

console.log(
  "\n===== V1.0 TOTAL 방향 비교 ====="
);

console.log(
  "전체 설정:",
  all.length
);

console.log(
  "전체+검증 플러스:",
  qualified.length
);

console.log(
  "\n===== ROBUST TOP 40 ====="
);

console.table(
  qualified
    .slice(0,40)
    .map(pretty)
);


console.log(
  "\n===== 방향별 최고 ====="
);

for (const mode of MODES) {
  const best =
    all
      .filter(
        x =>
          x.mode === mode &&
          x.fullDays >= 5
      )
      .sort(
        (a,b) =>
          b.robust -
          a.robust
      )
      .slice(0,10);

  console.log(
    `\n--- ${mode} ---`
  );

  console.table(
    best.map(pretty)
  );
}


console.log(
  "\n===== 구조별 최고 ====="
);

for (
  const structure of
  STRUCTURES
) {
  const best =
    all
      .filter(
        x =>
          x.structure ===
            structure &&
          x.fullDays >= 5
      )
      .sort(
        (a,b) =>
          b.robust -
          a.robust
      )
      .slice(0,10);

  console.log(
    `\n--- ${structure} ---`
  );

  console.table(
    best.map(pretty)
  );
}


console.log(
  "\n===== 비율별 최고 ====="
);

for (const ratio of RATIOS) {
  const best =
    all
      .filter(
        x =>
          x.ratio === ratio &&
          x.fullDays >= 5
      )
      .sort(
        (a,b) =>
          b.robust -
          a.robust
      )
      .slice(0,10);

  console.log(
    `\n--- ${ratio} ---`
  );

  console.table(
    best.map(pretty)
  );
}


fs.writeFileSync(
  OUTPUT,
  JSON.stringify(
    {
      generatedAt:
        new Date()
          .toISOString(),

      description:
        "V1.0 compare UNDER vs OVER vs BEST TOTAL direction, shared vs split 2-ticket portfolios",

      totalConfigs:
        all.length,

      qualifiedCount:
        qualified.length,

      allResults:
        all,

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

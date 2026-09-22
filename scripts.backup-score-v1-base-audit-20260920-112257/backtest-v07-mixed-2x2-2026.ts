import fs from "fs";
import path from "path";

const INPUT = path.join(
  process.cwd(),
  "data/kbo-backtest-all-candidates-2026.json"
);

const OUTPUT = path.join(
  process.cwd(),
  "data/kbo-backtest-v07-mixed-2x2-2026.json"
);

const DAILY_BANKROLL = 100000;

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

  grade:
    | "A"
    | "B"
    | "C";

  confidence: number;
  ev: number | null;
  odds: number | null;

  totalEdge?: number | null;

  result: Result;
};

const rows: Row[] =
  raw.results ?? [];


/* =========================================================
   MAP
========================================================= */

const byDate =
  new Map<string, Row[]>();

for (const row of rows) {
  if (!byDate.has(row.date)) {
    byDate.set(row.date, []);
  }

  byDate
    .get(row.date)!
    .push(row);
}

const dates =
  [...byDate.keys()]
    .sort();


/* =========================================================
   IDENTIFICATION
========================================================= */

function normalizeTeam(
  v: string
) {
  return String(v ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function mlLabelTeam(
  label: string
) {
  return normalizeTeam(
    String(label ?? "")
      .replace(/\s*승\s*$/, "")
  );
}

function isHomeMl(
  row: Row
) {
  return (
    row.market === "ML" &&
    mlLabelTeam(row.label) ===
      normalizeTeam(row.homeTeam)
  );
}

function isUnder(
  row: Row
) {
  const label =
    String(row.label ?? "")
      .toLowerCase();

  return (
    row.market === "TOTAL" &&
    (
      label.includes("언더") ||
      label.includes("under")
    )
  );
}


/* =========================================================
   PICK SCORE
========================================================= */

/*
  방어형 성향에 맞춘 개별픽 점수.
  EV만 과하게 따라가지 않고
  confidence 중심.
*/
function pickScore(
  row: Row
) {
  const ev =
    row.ev ?? -0.20;

  return (
    row.confidence * 100 +
    Math.max(
      -0.20,
      Math.min(
        0.30,
        ev
      )
    ) * 20
  );
}

function sortBest(
  list: Row[]
) {
  return [...list]
    .sort(
      (a,b) =>
        pickScore(b) -
        pickScore(a)
    );
}


/* =========================================================
   TICKET
========================================================= */

type Ticket = {
  picks: [Row, Row];
  odds: number;
};

function makeTicket(
  a: Row,
  b: Row
): Ticket | null {
  if (
    !a.odds ||
    !b.odds ||
    a.odds <= 1 ||
    b.odds <= 1
  ) {
    return null;
  }

  /*
    같은 경기의 ML + TOTAL도
    이번 테스트에서는 허용하지 않는다.
    실제 분산력을 보기 위함.
  */
  if (
    a.gameId === b.gameId
  ) {
    return null;
  }

  return {
    picks: [a,b],
    odds:
      a.odds * b.odds,
  };
}


/* =========================================================
   SETTLEMENT
========================================================= */

function settleTicket(
  ticket: Ticket,
  stake: number
) {
  const results =
    ticket.picks.map(
      p => p.result
    );

  if (
    results.some(
      x => x === "LOSS"
    )
  ) {
    return {
      result:
        "LOSS" as const,

      returned: 0,

      profit: -stake,
    };
  }

  const allVoid =
    results.every(
      x =>
        x === "VOID" ||
        x === "PUSH"
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

  let effectiveOdds = 1;

  for (
    const pick of
    ticket.picks
  ) {
    if (
      pick.result === "VOID" ||
      pick.result === "PUSH"
    ) {
      continue;
    }

    effectiveOdds *=
      Number(pick.odds ?? 1);
  }

  const returned =
    stake *
    effectiveOdds;

  return {
    result:
      "WIN" as const,

    returned,

    profit:
      returned - stake,
  };
}


/* =========================================================
   STRUCTURES
========================================================= */

type Structure =
  | "A_SHARED_UNDER"
  | "B_SPLIT_UNDER"
  | "C_FULL_INDEPENDENT";

function buildStructure(
  structure: Structure,
  unders: Row[],
  homes: Row[]
) {
  const U =
    sortBest(unders);

  const H =
    sortBest(homes);

  /*
    A:
    U1+H1
    U1+H2
  */
  if (
    structure ===
    "A_SHARED_UNDER"
  ) {
    if (
      U.length < 1 ||
      H.length < 2
    ) {
      return null;
    }

    /*
      홈ML 2개는 서로 다른 경기.
      언더와도 같은 경기 금지.
    */
    for (
      let ui = 0;
      ui < U.length;
      ui++
    ) {
      for (
        let h1 = 0;
        h1 < H.length;
        h1++
      ) {
        for (
          let h2 = h1 + 1;
          h2 < H.length;
          h2++
        ) {
          if (
            H[h1].gameId ===
            H[h2].gameId
          ) {
            continue;
          }

          const t1 =
            makeTicket(
              U[ui],
              H[h1]
            );

          const t2 =
            makeTicket(
              U[ui],
              H[h2]
            );

          if (
            t1 &&
            t2
          ) {
            return {
              ticket1: t1,
              ticket2: t2,
            };
          }
        }
      }
    }

    return null;
  }


  /*
    B:
    U1+H1
    U2+H2

    픽 자체는 4개 모두 다르지만
    서로 다른 티켓끼리 같은 경기의
    다른 시장은 허용.
  */
  if (
    structure ===
    "B_SPLIT_UNDER"
  ) {
    if (
      U.length < 2 ||
      H.length < 2
    ) {
      return null;
    }

    for (
      let u1 = 0;
      u1 < U.length;
      u1++
    ) {
      for (
        let u2 = u1 + 1;
        u2 < U.length;
        u2++
      ) {
        for (
          let h1 = 0;
          h1 < H.length;
          h1++
        ) {
          for (
            let h2 = 0;
            h2 < H.length;
            h2++
          ) {
            if (
              h1 === h2
            ) {
              continue;
            }

            const t1 =
              makeTicket(
                U[u1],
                H[h1]
              );

            const t2 =
              makeTicket(
                U[u2],
                H[h2]
              );

            if (
              t1 &&
              t2
            ) {
              return {
                ticket1: t1,
                ticket2: t2,
              };
            }
          }
        }
      }
    }

    return null;
  }


  /*
    C:
    U1+H1
    U2+H2

    네 픽이 전부
    서로 다른 경기여야 한다.
  */
  if (
    U.length < 2 ||
    H.length < 2
  ) {
    return null;
  }

  for (
    let u1 = 0;
    u1 < U.length;
    u1++
  ) {
    for (
      let u2 = u1 + 1;
      u2 < U.length;
      u2++
    ) {
      for (
        let h1 = 0;
        h1 < H.length;
        h1++
      ) {
        for (
          let h2 = 0;
          h2 < H.length;
          h2++
        ) {
          if (
            h1 === h2
          ) {
            continue;
          }

          const ids = new Set([
            U[u1].gameId,
            U[u2].gameId,
            H[h1].gameId,
            H[h2].gameId,
          ]);

          if (
            ids.size !== 4
          ) {
            continue;
          }

          const t1 =
            makeTicket(
              U[u1],
              H[h1]
            );

          const t2 =
            makeTicket(
              U[u2],
              H[h2]
            );

          if (
            t1 &&
            t2
          ) {
            return {
              ticket1: t1,
              ticket2: t2,
            };
          }
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

  mlMinEv: number;
  mlMinConfidence: number;

  underMinEv: number;
  underEdge: number;
  underMinConfidence: number;
};

type DayResult = {
  date: string;
  month: string;

  stake: number;
  returned: number;
  profit: number;

  wins: number;
  losses: number;

  odds1: number;
  odds2: number;
};

function run(
  params: Params
) {
  const results:
    DayResult[] = [];

  let candidateDays = 0;
  let structureFailed = 0;

  for (
    const date of dates
  ) {
    const day =
      byDate.get(date)!;

    const unders =
      day.filter(
        row =>
          isUnder(row) &&
          !!row.odds &&
          row.odds > 1 &&
          row.ev !== null &&
          row.ev >=
            params.underMinEv &&
          Math.abs(
            Number(
              row.totalEdge ?? 0
            )
          ) >=
            params.underEdge &&
          row.confidence >=
            params.underMinConfidence
      );

    const homes =
      day.filter(
        row =>
          isHomeMl(row) &&
          !!row.odds &&
          row.odds > 1 &&
          row.ev !== null &&
          row.ev >=
            params.mlMinEv &&
          row.confidence >=
            params.mlMinConfidence
      );

    if (
      unders.length === 0 ||
      homes.length === 0
    ) {
      continue;
    }

    candidateDays++;

    const built =
      buildStructure(
        params.structure,
        unders,
        homes
      );

    if (!built) {
      structureFailed++;
      continue;
    }

    const s1 =
      settleTicket(
        built.ticket1,
        60000
      );

    const s2 =
      settleTicket(
        built.ticket2,
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

      odds1:
        built.ticket1.odds,

      odds2:
        built.ticket2.odds,
    });
  }

  return {
    results,
    candidateDays,
    structureFailed,
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

  const profitableDays =
    list.filter(
      x => x.profit > 0
    ).length;

  const losingDays =
    list.filter(
      x => x.profit < 0
    ).length;

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
      x => x.losses === 2
    ).length;

  let currentLoss = 0;
  let maxLoss = 0;

  let equity = 0;
  let peak = 0;
  let mdd = 0;

  for (
    const day of list
  ) {
    if (
      day.profit < 0
    ) {
      currentLoss++;

      maxLoss =
        Math.max(
          maxLoss,
          currentLoss
        );
    } else {
      currentLoss = 0;
    }

    equity +=
      day.profit;

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
  }

  const avgOdds =
    list.length
      ? list.reduce(
          (s,x) =>
            s +
            x.odds1 +
            x.odds2,
          0
        ) /
        (list.length * 2)
      : 0;

  return {
    days:
      list.length,

    profitableDays,
    losingDays,

    winDayRate:
      list.length
        ? Number(
            (
              profitableDays /
              list.length *
              100
            ).toFixed(2)
          )
        : 0,

    allWin,
    partial,
    wipeout,

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

    avgOdds:
      Number(
        avgOdds.toFixed(3)
      ),

    maxLoss,

    mdd:
      Math.round(mdd),
  };
}


/* =========================================================
   GRID
========================================================= */

const STRUCTURES: Structure[] = [
  "A_SHARED_UNDER",
  "B_SPLIT_UNDER",
  "C_FULL_INDEPENDENT",
];

const ML_EV = [
  -0.05,
  0,
  0.03,
  0.05,
  0.10,
];

const ML_CONF = [
  0.50,
  0.54,
  0.58,
];

const UNDER_EV = [
  0,
  0.01,
];

const UNDER_EDGE = [
  0.8,
  1.0,
  1.2,
];

const UNDER_CONF = [
  0.50,
  0.55,
];

const all: any[] = [];

for (
  const structure of
  STRUCTURES
) {
  for (
    const mlMinEv of
    ML_EV
  ) {
    for (
      const mlMinConfidence of
      ML_CONF
    ) {
      for (
        const underMinEv of
        UNDER_EV
      ) {
        for (
          const underEdge of
          UNDER_EDGE
        ) {
          for (
            const underMinConfidence of
            UNDER_CONF
          ) {
            const params = {
              structure,
              mlMinEv,
              mlMinConfidence,
              underMinEv,
              underEdge,
              underMinConfidence,
            };

            const r =
              run(params);

            const full =
              summarize(
                r.results
              );

            const val =
              summarize(
                r.results.filter(
                  x =>
                    x.date >=
                    "2026-07-01"
                )
              );

            all.push({
              ...params,

              candidateDays:
                r.candidateDays,

              structureFailed:
                r.structureFailed,

              fullDays:
                full.days,

              fullROI:
                full.roi,

              fullProfit:
                full.profit,

              fullWinRate:
                full.winDayRate,

              fullAvgOdds:
                full.avgOdds,

              fullMaxLoss:
                full.maxLoss,

              fullMDD:
                full.mdd,

              fullAllWin:
                full.allWin,

              fullPartial:
                full.partial,

              fullWipeout:
                full.wipeout,

              valDays:
                val.days,

              valROI:
                val.roi,

              valProfit:
                val.profit,

              valWinRate:
                val.winDayRate,

              valMaxLoss:
                val.maxLoss,

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


/* =========================================================
   RANK
========================================================= */

const qualified =
  all
    .filter(
      x =>
        x.fullDays >= 10 &&
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

function shortStructure(
  s: Structure
) {
  if (
    s === "A_SHARED_UNDER"
  ) return "A-언더축공유";

  if (
    s === "B_SPLIT_UNDER"
  ) return "B-언더분산";

  return "C-완전독립";
}

function pretty(
  x: any,
  i: number
) {
  return {
    순위:
      i + 1,

    구조:
      shortStructure(
        x.structure
      ),

    ML_EV:
      `${Math.round(
        x.mlMinEv * 100
      )}%`,

    ML_CONF:
      `${Math.round(
        x.mlMinConfidence * 100
      )}%`,

    U_EV:
      `${Math.round(
        x.underMinEv * 100
      )}%`,

    U_EDGE:
      x.underEdge,

    U_CONF:
      `${Math.round(
        x.underMinConfidence * 100
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

    평균배당:
      x.fullAvgOdds,

    최대연패:
      x.fullMaxLoss,

    MDD:
      x.fullMDD,

    올킬:
      x.fullAllWin,

    반쪽:
      x.fullPartial,

    전멸:
      x.fullWipeout,
  };
}


console.log(
  "\n===== V0.7 MIXED 2폴 × 2조합 ====="
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
  "\n===== ROBUST TOP 30 ====="
);

console.table(
  qualified
    .slice(0,30)
    .map(pretty)
);


/* =========================================================
   구조별 최고
========================================================= */

console.log(
  "\n===== 구조별 최고 ====="
);

const bestByStructure =
  STRUCTURES.map(
    structure => {
      const candidates =
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
          );

      return candidates[0];
    }
  )
  .filter(Boolean);

console.table(
  bestByStructure.map(
    (x,i) =>
      pretty(x,i)
  )
);


/* =========================================================
   TOP 10 MONTHLY
========================================================= */

console.log(
  "\n===== TOP 10 월별 ====="
);

const monthly: any[] = [];

for (
  const cfg of
  qualified.slice(0,10)
) {
  const r =
    run({
      structure:
        cfg.structure,

      mlMinEv:
        cfg.mlMinEv,

      mlMinConfidence:
        cfg.mlMinConfidence,

      underMinEv:
        cfg.underMinEv,

      underEdge:
        cfg.underEdge,

      underMinConfidence:
        cfg.underMinConfidence,
    });

  const row: any = {
    구조:
      shortStructure(
        cfg.structure
      ),

    ML_EV:
      `${Math.round(
        cfg.mlMinEv * 100
      )}%`,

    ML_CONF:
      `${Math.round(
        cfg.mlMinConfidence *
        100
      )}%`,

    EDGE:
      cfg.underEdge,
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
        r.results.filter(
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
    `${cfg.fullROI}%`;

  row["검증"] =
    `${cfg.valROI}%`;

  monthly.push(row);
}

console.table(monthly);


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
        "V0.7 mixed UNDER + HOME ML strict 2-leg x 2-ticket portfolio",

      dailyBankroll:
        DAILY_BANKROLL,

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

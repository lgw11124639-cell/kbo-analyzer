import fs from "fs";
import path from "path";

const INPUT = path.join(
  process.cwd(),
  "data/kbo-backtest-all-candidates-2026.json"
);

const OUTPUT = path.join(
  process.cwd(),
  "data/kbo-backtest-v08-under-anchor-home-2026.json"
);

const DAILY = 100000;

const raw = JSON.parse(
  fs.readFileSync(INPUT, "utf8")
);

type R = "WIN" | "LOSS" | "PUSH" | "VOID";

type Row = {
  date: string;
  month: string;
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  market: "ML" | "HANDICAP" | "TOTAL";
  label: string;
  confidence: number;
  ev: number | null;
  odds: number | null;
  totalEdge?: number | null;
  result: R;
};

const rows: Row[] = raw.results ?? [];

const byDate = new Map<string, Row[]>();

for (const r of rows) {
  if (!byDate.has(r.date)) byDate.set(r.date, []);
  byDate.get(r.date)!.push(r);
}

const dates = [...byDate.keys()].sort();

function norm(v: string) {
  return String(v ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function isHomeMl(r: Row) {
  if (r.market !== "ML") return false;

  const team = norm(
    String(r.label ?? "")
      .replace(/\s*승\s*$/, "")
  );

  return team === norm(r.homeTeam);
}

function isUnder(r: Row) {
  if (r.market !== "TOTAL") return false;

  const l = norm(r.label);

  return (
    l.includes("언더") ||
    l.includes("under")
  );
}

function score(r: Row) {
  return (
    r.confidence * 100 +
    (r.ev ?? -0.3) * 20
  );
}

function settle(
  picks: Row[],
  stake: number
) {
  if (
    picks.some(
      p => p.result === "LOSS"
    )
  ) {
    return {
      returned: 0,
      profit: -stake,
      result: "LOSS",
    };
  }

  const active =
    picks.filter(
      p =>
        p.result !== "VOID" &&
        p.result !== "PUSH"
    );

  if (!active.length) {
    return {
      returned: stake,
      profit: 0,
      result: "VOID",
    };
  }

  const odds =
    active.reduce(
      (n,p) =>
        n * Number(p.odds ?? 1),
      1
    );

  const returned =
    stake * odds;

  return {
    returned,
    profit: returned - stake,
    result: "WIN",
  };
}

type Params = {
  mlEv: number;
  mlConf: number;
  underEv: number;
  edge: number;
  underConf: number;
};

function run(p: Params) {
  const dayResults: any[] = [];

  let underDays = 0;
  let structureDays = 0;

  for (const date of dates) {
    const day = byDate.get(date)!;

    const unders =
      day.filter(x =>
        isUnder(x) &&
        (x.odds ?? 0) > 1 &&
        x.ev !== null &&
        x.ev >= p.underEv &&
        Math.abs(Number(x.totalEdge ?? 0)) >= p.edge &&
        x.confidence >= p.underConf
      )
      .sort((a,b) => score(b)-score(a));

    if (!unders.length) continue;

    underDays++;

    let selected:
      {
        u: Row;
        h1: Row;
        h2: Row;
      } | null = null;

    for (const u of unders) {
      const homes =
        day.filter(x =>
          isHomeMl(x) &&
          (x.odds ?? 0) > 1 &&
          x.ev !== null &&
          x.ev >= p.mlEv &&
          x.confidence >= p.mlConf &&
          x.gameId !== u.gameId
        )
        .sort((a,b) => score(b)-score(a));

      const unique: Row[] = [];
      const seen = new Set<string>();

      for (const h of homes) {
        if (seen.has(h.gameId)) continue;
        seen.add(h.gameId);
        unique.push(h);
      }

      if (unique.length >= 2) {
        selected = {
          u,
          h1: unique[0],
          h2: unique[1],
        };
        break;
      }
    }

    if (!selected) continue;

    structureDays++;

    const t1 =
      settle(
        [selected.u, selected.h1],
        60000
      );

    const t2 =
      settle(
        [selected.u, selected.h2],
        40000
      );

    const wins =
      [t1.result,t2.result]
        .filter(x => x === "WIN")
        .length;

    dayResults.push({
      date,
      month: date.slice(0,7),
      stake: DAILY,
      returned:
        t1.returned +
        t2.returned,
      profit:
        t1.profit +
        t2.profit,
      wins,
    });
  }

  return {
    results: dayResults,
    underDays,
    structureDays,
  };
}

function summary(list: any[]) {
  const stake =
    list.reduce(
      (s,x) => s + x.stake,
      0
    );

  const returned =
    list.reduce(
      (s,x) => s + x.returned,
      0
    );

  const profit =
    returned - stake;

  const profitDays =
    list.filter(
      x => x.profit > 0
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
      x => x.wins === 0
    ).length;

  let streak = 0;
  let maxLoss = 0;

  let equity = 0;
  let peak = 0;
  let mdd = 0;

  for (const x of list) {
    if (x.profit < 0) {
      streak++;
      maxLoss =
        Math.max(maxLoss,streak);
    } else {
      streak = 0;
    }

    equity += x.profit;
    peak = Math.max(peak,equity);
    mdd = Math.max(mdd,peak-equity);
  }

  return {
    days: list.length,
    profitDays,
    allWin,
    partial,
    wipeout,
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
    maxLoss,
    mdd:
      Math.round(mdd),
  };
}

const ML_EV = [
  -0.05,
  -0.075,
  -0.10,
  -0.125,
  -0.15,
];

const ML_CONF = [
  0.48,
  0.50,
  0.52,
  0.54,
  0.56,
];

const U_EV = [
  0,
  0.01,
];

const EDGE = [
  0.8,
  1.0,
  1.2,
];

const U_CONF = [
  0.50,
  0.55,
  0.58,
];

const all: any[] = [];

for (const mlEv of ML_EV) {
  for (const mlConf of ML_CONF) {
    for (const underEv of U_EV) {
      for (const edge of EDGE) {
        for (const underConf of U_CONF) {

          const params = {
            mlEv,
            mlConf,
            underEv,
            edge,
            underConf,
          };

          const r = run(params);

          const full =
            summary(r.results);

          const val =
            summary(
              r.results.filter(
                x =>
                  x.date >= "2026-07-01"
              )
            );

          all.push({
            ...params,

            underDays:
              r.underDays,

            structureDays:
              r.structureDays,

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

            fullMaxLoss:
              full.maxLoss,

            fullMDD:
              full.mdd,

            valDays:
              val.days,

            valROI:
              val.roi,

            valProfit:
              val.profit,

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

const qualified =
  all
    .filter(x =>
      x.fullDays >= 10 &&
      x.valDays >= 3 &&
      x.fullROI > 0 &&
      x.valROI > 0
    )
    .sort((a,b) =>
      b.robust - a.robust ||
      b.valDays - a.valDays ||
      b.fullDays - a.fullDays
    );

function pretty(x:any,i:number) {
  return {
    순위: i+1,

    ML_EV:
      `${(x.mlEv*100).toFixed(1)}%`,

    ML_CONF:
      `${Math.round(
        x.mlConf*100
      )}%`,

    U_EV:
      `${Math.round(
        x.underEv*100
      )}%`,

    EDGE:
      x.edge,

    U_CONF:
      `${Math.round(
        x.underConf*100
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
      x.fullMaxLoss,

    MDD:
      x.fullMDD,
  };
}

console.log(
  "\n===== V0.8 UNDER축 + HOME ML ====="
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

console.log(
  "\n===== 베팅일수 상위 20 ====="
);

console.table(
  [...all]
    .sort(
      (a,b) =>
        b.fullDays -
        a.fullDays
    )
    .slice(0,20)
    .map(pretty)
);

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(
    {
      generatedAt:
        new Date()
          .toISOString(),

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

/* =========================================================
   V0.9 ROBUSTNESS CHECK
========================================================= */

console.log(
  "\n===== V0.9 ROBUSTNESS CHECK ====="
);

const nearbyMlEv = [
  -0.16,
  -0.15,
  -0.14,
];

const nearbyMlConf = [
  0.51,
  0.52,
  0.53,
];

const nearbyEdge = [
  1.1,
  1.2,
  1.3,
];

const nearbyUnderConf = [
  0.50,
  0.52,
  0.54,
  0.56,
];

const robustness:any[] = [];

for (const mlEv of nearbyMlEv) {
  for (const mlConf of nearbyMlConf) {
    for (const edge of nearbyEdge) {
      for (const underConf of nearbyUnderConf) {

        const r = run({
          mlEv,
          mlConf,
          underEv: 0,
          edge,
          underConf,
        });

        const full =
          summary(r.results);

        const val =
          summary(
            r.results.filter(
              x =>
                x.date >= "2026-07-01"
            )
          );

        robustness.push({
          mlEv,
          mlConf,
          edge,
          underConf,

          days:
            full.days,

          roi:
            full.roi,

          profit:
            full.profit,

          valDays:
            val.days,

          valRoi:
            val.roi,

          valProfit:
            val.profit,

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

console.log(
  "\n===== 인접조건 전체 ====="
);

console.table(
  robustness
    .sort(
      (a,b) =>
        b.robust -
        a.robust ||
        b.days -
        a.days
    )
    .map((x,i) => ({
      순위: i+1,

      ML_EV:
        `${(x.mlEv*100).toFixed(1)}%`,

      ML_CONF:
        `${Math.round(
          x.mlConf*100
        )}%`,

      EDGE:
        x.edge,

      U_CONF:
        `${Math.round(
          x.underConf*100
        )}%`,

      전체일:
        x.days,

      전체ROI:
        `${x.roi}%`,

      검증일:
        x.valDays,

      검증ROI:
        `${x.valRoi}%`,

      ROBUST:
        `${x.robust}%`,
    }))
);


/* =========================================================
   기준 전략 상세
========================================================= */

const baseParams = {
  mlEv: -0.15,
  mlConf: 0.52,
  underEv: 0,
  edge: 1.2,
  underConf: 0.50,
};

const base =
  run(baseParams);

console.log(
  "\n===== 기준 전략 10일 상세 ====="
);

console.table(
  base.results.map(
    (x:any) => ({
      날짜:
        x.date,

      손익:
        Math.round(
          x.profit
        ),

      수익률:
        `${(
          x.profit /
          100000 *
          100
        ).toFixed(2)}%`,

      적중티켓:
        `${x.wins}/2`,
    })
  )
);


/* =========================================================
   월별
========================================================= */

console.log(
  "\n===== 기준 전략 월별 ====="
);

const monthRows:any[] = [];

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
      base.results.filter(
        (x:any) =>
          x.month === month
      )
    );

  monthRows.push({
    월:
      month,

    베팅일:
      m.days,

    수익일:
      m.profitDays,

    올킬:
      m.allWin,

    반쪽:
      m.partial,

    전멸:
      m.wipeout,

    손익:
      m.profit,

    ROI:
      `${m.roi}%`,
  });
}

console.table(monthRows);


/* =========================================================
   기간 분할
========================================================= */

console.log(
  "\n===== 기간분할 ====="
);

const periods = [
  {
    name: "3~5월",
    from: "2026-03-01",
    to: "2026-05-31",
  },
  {
    name: "6월",
    from: "2026-06-01",
    to: "2026-06-30",
  },
  {
    name: "7~9월",
    from: "2026-07-01",
    to: "2026-09-30",
  },
];

console.table(
  periods.map(p => {
    const s =
      summary(
        base.results.filter(
          (x:any) =>
            x.date >= p.from &&
            x.date <= p.to
        )
      );

    return {
      기간:
        p.name,

      베팅일:
        s.days,

      손익:
        s.profit,

      ROI:
        `${s.roi}%`,

      올킬:
        s.allWin,

      반쪽:
        s.partial,

      전멸:
        s.wipeout,
    };
  })
);

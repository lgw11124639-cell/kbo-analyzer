import fs from "fs";
import path from "path";

const INPUT = path.join(
  process.cwd(),
  "data/kbo-backtest-all-candidates-2026.json"
);

const OUTPUT = path.join(
  process.cwd(),
  "data/kbo-backtest-v11-model-calibration-2026.json"
);

const raw = JSON.parse(
  fs.readFileSync(INPUT, "utf8")
);

type Row = {
  date: string;
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  market: "ML" | "HANDICAP" | "TOTAL";
  label: string;
  grade: "A" | "B" | "C";
  confidence: number;
  ev: number | null;
  odds: number | null;
  totalEdge?: number | null;
  result: "WIN" | "LOSS" | "PUSH" | "VOID";
};

const rows: Row[] = raw.results ?? [];

function norm(v: string) {
  return String(v ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function direction(row: Row) {
  if (row.market === "ML") {
    const team = norm(
      String(row.label ?? "")
        .replace(/\s*승\s*$/, "")
    );

    if (team === norm(row.homeTeam)) return "HOME";
    if (team === norm(row.awayTeam)) return "AWAY";

    return "UNKNOWN";
  }

  if (row.market === "TOTAL") {
    const l = norm(row.label);

    if (
      l.includes("언더") ||
      l.includes("under")
    ) return "UNDER";

    if (
      l.includes("오버") ||
      l.includes("over")
    ) return "OVER";

    return "UNKNOWN";
  }

  return "HANDICAP";
}

function settled(row: Row) {
  return (
    row.result === "WIN" ||
    row.result === "LOSS"
  );
}

function actual(row: Row) {
  return row.result === "WIN" ? 1 : 0;
}

/*
  Calibration bin:
  50~55
  55~60
  60~65
  65~70
  70~75
  75~80
  80+
*/
function bin(conf: number) {
  const p = conf * 100;

  if (p < 50) return "<50%";
  if (p < 55) return "50~55%";
  if (p < 60) return "55~60%";
  if (p < 65) return "60~65%";
  if (p < 70) return "65~70%";
  if (p < 75) return "70~75%";
  if (p < 80) return "75~80%";

  return "80%+";
}

function summarize(list: Row[]) {
  const valid = list.filter(settled);

  const wins =
    valid.filter(x => x.result === "WIN").length;

  const n = valid.length;

  const avgPred =
    n
      ? valid.reduce(
          (s,x) => s + x.confidence,
          0
        ) / n
      : 0;

  const actualRate =
    n ? wins / n : 0;

  const brier =
    n
      ? valid.reduce(
          (s,x) => {
            const y = actual(x);
            const e = x.confidence - y;
            return s + e * e;
          },
          0
        ) / n
      : 0;

  const logLoss =
    n
      ? valid.reduce(
          (s,x) => {
            const y = actual(x);

            const p = Math.max(
              0.000001,
              Math.min(
                0.999999,
                x.confidence
              )
            );

            return s - (
              y * Math.log(p) +
              (1-y) * Math.log(1-p)
            );
          },
          0
        ) / n
      : 0;

  return {
    n,
    wins,
    losses: n-wins,

    avgPred:
      Number(
        (avgPred*100).toFixed(2)
      ),

    actual:
      Number(
        (actualRate*100).toFixed(2)
      ),

    gap:
      Number(
        (
          (actualRate-avgPred)*100
        ).toFixed(2)
      ),

    brier:
      Number(
        brier.toFixed(4)
      ),

    logLoss:
      Number(
        logLoss.toFixed(4)
      ),
  };
}

/*
  한 경기에서 양쪽 결과가 모두 들어 있으므로
  "모델 최고 확률 픽"을 따로 만든다.
*/
const byGame =
  new Map<string, Row[]>();

for (const row of rows) {
  if (!settled(row)) continue;

  const key =
    `${row.date}|${row.gameId}`;

  if (!byGame.has(key)) {
    byGame.set(key, []);
  }

  byGame.get(key)!.push(row);
}

/*
  시장별 최고 확률:
  ML 한 개
  HANDICAP 한 개
  TOTAL 한 개
*/
const marketBest: Row[] = [];

for (const gameRows of byGame.values()) {
  for (
    const market of [
      "ML",
      "HANDICAP",
      "TOTAL",
    ] as const
  ) {
    const candidates =
      gameRows
        .filter(x => x.market === market)
        .sort(
          (a,b) =>
            b.confidence -
            a.confidence
        );

    if (candidates[0]) {
      marketBest.push(
        candidates[0]
      );
    }
  }
}

/*
  경기 전체에서 가장 높은 confidence 한 픽.
*/
const gameBest: Row[] = [];

for (const gameRows of byGame.values()) {
  const best =
    [...gameRows]
      .sort(
        (a,b) =>
          b.confidence -
          a.confidence
      )[0];

  if (best) {
    gameBest.push(best);
  }
}

function calibrationTable(
  list: Row[]
) {
  const groups =
    new Map<string, Row[]>();

  for (const row of list) {
    const key =
      bin(row.confidence);

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key)!.push(row);
  }

  const order = [
    "<50%",
    "50~55%",
    "55~60%",
    "60~65%",
    "65~70%",
    "70~75%",
    "75~80%",
    "80%+",
  ];

  return order
    .filter(x => groups.has(x))
    .map(x => ({
      구간: x,
      ...summarize(groups.get(x)!),
    }));
}

function prettySummary(
  name: string,
  list: Row[]
) {
  const s = summarize(list);

  return {
    구분: name,
    표본: s.n,
    예상승률: `${s.avgPred}%`,
    실제적중률: `${s.actual}%`,
    차이: `${s.gap}%p`,
    Brier: s.brier,
    LogLoss: s.logLoss,
  };
}

/* =========================================================
   1. 시장별 최고확률
========================================================= */

const mlBest =
  marketBest.filter(
    x => x.market === "ML"
  );

const handicapBest =
  marketBest.filter(
    x => x.market === "HANDICAP"
  );

const totalBest =
  marketBest.filter(
    x => x.market === "TOTAL"
  );

console.log(
  "\n===== V1.1 모델 순수 예측력 ====="
);

console.log(
  "실제 고유 경기:",
  byGame.size
);

console.log(
  "\n===== 시장별 최고확률 픽 ====="
);

console.table([
  prettySummary(
    "ML",
    mlBest
  ),
  prettySummary(
    "HANDICAP",
    handicapBest
  ),
  prettySummary(
    "TOTAL",
    totalBest
  ),
  prettySummary(
    "경기 전체 최고",
    gameBest
  ),
]);


/* =========================================================
   2. 확률 Calibration
========================================================= */

for (
  const [name,list] of [
    ["ML",mlBest],
    ["HANDICAP",handicapBest],
    ["TOTAL",totalBest],
    ["GAME_BEST",gameBest],
  ] as const
) {
  console.log(
    `\n===== ${name} 확률구간 =====`
  );

  console.table(
    calibrationTable(list)
  );
}


/* =========================================================
   3. 방향별
========================================================= */

console.log(
  "\n===== 방향별 예측력 ====="
);

const directions =
  new Map<string,Row[]>();

for (const row of marketBest) {
  const key =
    `${row.market}:${direction(row)}`;

  if (!directions.has(key)) {
    directions.set(key,[]);
  }

  directions.get(key)!.push(row);
}

const directionOutput =
  [...directions.entries()]
    .map(([name,list]) => ({
      ...prettySummary(
        name,
        list
      ),
    }))
    .sort(
      (a,b) =>
        b.표본 - a.표본
    );

console.table(
  directionOutput
);


/* =========================================================
   4. 최소 확률 threshold
========================================================= */

console.log(
  "\n===== 최소 예상승률별 실제 적중률 ====="
);

const thresholds = [
  0.50,
  0.52,
  0.54,
  0.56,
  0.58,
  0.60,
  0.62,
  0.64,
  0.66,
];

const thresholdRows:any[] = [];

for (const threshold of thresholds) {
  for (
    const [name,list] of [
      ["ML",mlBest],
      ["HANDICAP",handicapBest],
      ["TOTAL",totalBest],
      ["GAME_BEST",gameBest],
    ] as const
  ) {
    const filtered =
      list.filter(
        x =>
          x.confidence >= threshold
      );

    const s =
      summarize(filtered);

    thresholdRows.push({
      기준:
        `${Math.round(
          threshold*100
        )}%+`,

      시장:
        name,

      표본:
        s.n,

      예상:
        `${s.avgPred}%`,

      실제:
        `${s.actual}%`,

      차이:
        `${s.gap}%p`,
    });
  }
}

console.table(
  thresholdRows
);


/* =========================================================
   5. 월별 GAME BEST
========================================================= */

console.log(
  "\n===== 경기 최고픽 월별 ====="
);

const months =
  [
    ...new Set(
      gameBest.map(
        x => x.date.slice(0,7)
      )
    ),
  ].sort();

const monthly =
  months.map(month => {
    const list =
      gameBest.filter(
        x =>
          x.date.startsWith(month)
      );

    const s =
      summarize(list);

    return {
      월: month,
      표본: s.n,
      예상승률:
        `${s.avgPred}%`,
      실제적중률:
        `${s.actual}%`,
      차이:
        `${s.gap}%p`,
      Brier:
        s.brier,
    };
  });

console.table(monthly);


/* =========================================================
   SAVE
========================================================= */

const output = {
  generatedAt:
    new Date().toISOString(),

  note:
    "Lookahead-safe partial-input analyzer: starter and lineup edges omitted in historical replay.",

  games:
    byGame.size,

  summary: {
    ML:
      summarize(mlBest),

    HANDICAP:
      summarize(handicapBest),

    TOTAL:
      summarize(totalBest),

    GAME_BEST:
      summarize(gameBest),
  },

  calibration: {
    ML:
      calibrationTable(mlBest),

    HANDICAP:
      calibrationTable(
        handicapBest
      ),

    TOTAL:
      calibrationTable(
        totalBest
      ),

    GAME_BEST:
      calibrationTable(
        gameBest
      ),
  },

  direction:
    directionOutput,

  thresholds:
    thresholdRows,

  monthlyGameBest:
    monthly,
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

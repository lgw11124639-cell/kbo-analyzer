const fs = require("fs");

const v03Path =
  "scripts/backtest-kbo-score-model-v03.cjs";

const v06Path =
  "data/kbo-score-features-v06.json";

const backtestPath =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

console.log(
  "===== V03 / V06 REPRODUCTION AUDIT ====="
);

console.log(
  "FINAL HOLDOUT: NOT TOUCHED"
);

console.log();

/*
 * 원본 V0.3 코드에서 실제 설정 확인
 */
const src =
  fs.readFileSync(
    v03Path,
    "utf8"
  );

console.log(
  "===== ORIGINAL V03 KEY LINES ====="
);

for (const line of src.split("\n")) {
  if (
    /P80|priorGames|teamWeight|predictV03|leagueByDate|marginAdjustedPredictor|marketRuns|formRuns|blendedEra|eraNeutral|0\.09/.test(line)
  ) {
    console.log(line);
  }
}

console.log();

/*
 * 원본 backtest rows
 */
const rawBacktest =
  JSON.parse(
    fs.readFileSync(
      backtestPath,
      "utf8"
    )
  );

const rows =
  Array.isArray(rawBacktest)
    ? rawBacktest
    : rawBacktest.results || [];

/*
 * 실제 경기 1개당 하나
 */
const gameMap =
  new Map();

for (const r of rows) {
  if (!r?.gameId)
    continue;

  if (!gameMap.has(r.gameId)) {
    gameMap.set(
      r.gameId,
      r
    );
  }
}

const originalGames =
  [...gameMap.values()];

/*
 * V0.3 usable 조건:
 * 기존 scoreModelInputs 4개가 전부 존재
 */
function finite(v) {
  return Number.isFinite(
    Number(v)
  );
}

const originalDiscovery =
  originalGames.filter(g => {
    if (
      g.date > "2026-04-30"
    ) {
      return false;
    }

    const x =
      g.scoreModelInputs;

    if (!x)
      return false;

    return (
      finite(x.awayAvgRuns) &&
      finite(x.awayAvgRunsAllowed) &&
      finite(x.homeAvgRuns) &&
      finite(x.homeAvgRunsAllowed)
    );
  });

const originalInternal =
  originalGames.filter(g => {
    if (
      g.date < "2026-05-01" ||
      g.date > "2026-06-30"
    ) {
      return false;
    }

    const x =
      g.scoreModelInputs;

    if (!x)
      return false;

    return (
      finite(x.awayAvgRuns) &&
      finite(x.awayAvgRunsAllowed) &&
      finite(x.homeAvgRuns) &&
      finite(x.homeAvgRunsAllowed)
    );
  });

console.log(
  "ORIGINAL DISCOVERY USABLE:",
  originalDiscovery.length
);

console.log(
  "ORIGINAL INTERNAL USABLE:",
  originalInternal.length
);

console.log();

/*
 * V0.6
 */
const rawV06 =
  JSON.parse(
    fs.readFileSync(
      v06Path,
      "utf8"
    )
  );

const v06Games =
  rawV06.games || [];

const v06Discovery =
  v06Games.filter(g =>
    g.date <= "2026-04-30" &&
    finite(
      g.awayTeamForm
        ?.seasonAvgRuns
    ) &&
    finite(
      g.awayTeamForm
        ?.seasonAvgRunsAllowed
    ) &&
    finite(
      g.homeTeamForm
        ?.seasonAvgRuns
    ) &&
    finite(
      g.homeTeamForm
        ?.seasonAvgRunsAllowed
    )
  );

const v06Internal =
  v06Games.filter(g =>
    g.date >= "2026-05-01" &&
    g.date <= "2026-06-30" &&
    finite(
      g.awayTeamForm
        ?.seasonAvgRuns
    ) &&
    finite(
      g.awayTeamForm
        ?.seasonAvgRunsAllowed
    ) &&
    finite(
      g.homeTeamForm
        ?.seasonAvgRuns
    ) &&
    finite(
      g.homeTeamForm
        ?.seasonAvgRunsAllowed
    )
  );

console.log(
  "V06 DISCOVERY USABLE:",
  v06Discovery.length
);

console.log(
  "V06 INTERNAL USABLE:",
  v06Internal.length
);

console.log();

/*
 * gameId 차이
 */
function ids(xs) {
  return new Set(
    xs.map(x => x.gameId)
  );
}

const oldD =
  ids(originalDiscovery);

const newD =
  ids(v06Discovery);

const oldI =
  ids(originalInternal);

const newI =
  ids(v06Internal);

const onlyOldD =
  [...oldD].filter(
    id => !newD.has(id)
  );

const onlyNewD =
  [...newD].filter(
    id => !oldD.has(id)
  );

const onlyOldI =
  [...oldI].filter(
    id => !newI.has(id)
  );

const onlyNewI =
  [...newI].filter(
    id => !oldI.has(id)
  );

console.log(
  "===== DISCOVERY GAME-ID DIFF ====="
);

console.log(
  "ONLY ORIGINAL:",
  onlyOldD.length,
  onlyOldD
);

console.log(
  "ONLY V06:",
  onlyNewD.length,
  onlyNewD
);

console.log();

console.log(
  "===== INTERNAL GAME-ID DIFF ====="
);

console.log(
  "ONLY ORIGINAL:",
  onlyOldI.length,
  onlyOldI
);

console.log(
  "ONLY V06:",
  onlyNewI.length,
  onlyNewI
);

console.log();

/*
 * 공통 경기에서 raw team averages 비교
 */
const oldById =
  new Map(
    originalGames.map(
      g => [g.gameId,g]
    )
  );

const newById =
  new Map(
    v06Games.map(
      g => [g.gameId,g]
    )
  );

const mismatches = [];

for (const id of oldD) {
  if (!newD.has(id))
    continue;

  const a =
    oldById.get(id);

  const b =
    newById.get(id);

  const x =
    a.scoreModelInputs;

  const pairs = [
    [
      "awayAvgRuns",
      x.awayAvgRuns,
      b.awayTeamForm
        ?.seasonAvgRuns
    ],
    [
      "awayAvgRunsAllowed",
      x.awayAvgRunsAllowed,
      b.awayTeamForm
        ?.seasonAvgRunsAllowed
    ],
    [
      "homeAvgRuns",
      x.homeAvgRuns,
      b.homeTeamForm
        ?.seasonAvgRuns
    ],
    [
      "homeAvgRunsAllowed",
      x.homeAvgRunsAllowed,
      b.homeTeamForm
        ?.seasonAvgRunsAllowed
    ]
  ];

  for (
    const [field,oldV,newV]
    of pairs
  ) {
    if (
      finite(oldV) &&
      finite(newV) &&
      Math.abs(
        Number(oldV) -
        Number(newV)
      ) > 1e-9
    ) {
      mismatches.push({
        date: a.date,
        gameId: id,
        field,
        old: Number(oldV),
        v06: Number(newV),
        delta:
          Number(newV) -
          Number(oldV)
      });
    }
  }
}

console.log(
  "===== COMMON DISCOVERY RAW INPUT MISMATCH ====="
);

console.log(
  "COUNT:",
  mismatches.length
);

console.log(
  JSON.stringify(
    mismatches.slice(0,40),
    null,
    2
  )
);

console.log();

/*
 * 선발 데이터도 원본 scoreModelInputs와 비교
 */
const starterMismatch = [];

for (const id of oldD) {
  if (!newD.has(id))
    continue;

  const a =
    oldById.get(id);

  const b =
    newById.get(id);

  const x =
    a.scoreModelInputs;

  const pairs = [
    [
      "awayStarterEra",
      x.awayStarterEra,
      b.starter?.away?.era
    ],
    [
      "awayStarterRecent5Era",
      x.awayStarterRecent5Era,
      b.starter?.away
        ?.recent5?.era
    ],
    [
      "homeStarterEra",
      x.homeStarterEra,
      b.starter?.home?.era
    ],
    [
      "homeStarterRecent5Era",
      x.homeStarterRecent5Era,
      b.starter?.home
        ?.recent5?.era
    ]
  ];

  for (
    const [field,oldV,newV]
    of pairs
  ) {
    const oldN =
      finite(oldV)
        ? Number(oldV)
        : null;

    const newN =
      finite(newV)
        ? Number(newV)
        : null;

    if (
      oldN !== newN &&
      !(
        oldN !== null &&
        newN !== null &&
        Math.abs(
          oldN-newN
        ) <= 1e-9
      )
    ) {
      starterMismatch.push({
        date: a.date,
        gameId: id,
        field,
        old: oldN,
        v06: newN
      });
    }
  }
}

console.log(
  "===== COMMON DISCOVERY STARTER INPUT MISMATCH ====="
);

console.log(
  "COUNT:",
  starterMismatch.length
);

console.log(
  JSON.stringify(
    starterMismatch.slice(0,40),
    null,
    2
  )
);

console.log();

console.log(
  "FINAL OPENED:",
  false
);

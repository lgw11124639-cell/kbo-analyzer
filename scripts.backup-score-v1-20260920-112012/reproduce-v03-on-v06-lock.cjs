const fs = require("fs");

const BT =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const V06 =
  "data/kbo-score-features-v06.json";

const V03SRC =
  "scripts/backtest-kbo-score-model-v03.cjs";

const raw =
  JSON.parse(fs.readFileSync(BT, "utf8"));

const v06 =
  JSON.parse(fs.readFileSync(V06, "utf8"));

const rows =
  Array.isArray(raw)
    ? raw
    : raw.results || [];

function num(v) {
  if (
    v === null ||
    v === undefined ||
    v === ""
  ) return null;

  const n = Number(v);
  return Number.isFinite(n)
    ? n
    : null;
}

/* ========================================
   ACTUAL GAME DEDUPE
======================================== */

const gameMap = new Map();

for (const r of rows) {
  if (
    num(r.awayScore) === null ||
    num(r.homeScore) === null
  ) continue;

  if (!gameMap.has(r.gameId)) {
    gameMap.set(r.gameId, r);
  }
}

const games =
  [...gameMap.values()]
    .sort((a, b) =>
      String(a.date).localeCompare(String(b.date)) ||
      String(a.gameId).localeCompare(String(b.gameId))
    );

/* ========================================
   V03 ORIGINAL USABLE CONDITION
======================================== */

function usable(g) {
  const x =
    g.scoreModelInputs || {};

  return (
    num(x.awayAvgRuns) !== null &&
    num(x.awayAvgRunsAllowed) !== null &&
    num(x.homeAvgRuns) !== null &&
    num(x.homeAvgRunsAllowed) !== null
  );
}

const discovery =
  games.filter(g =>
    g.date <= "2026-04-30" &&
    usable(g)
  );

const internal =
  games.filter(g =>
    g.date >= "2026-05-01" &&
    g.date <= "2026-06-30" &&
    usable(g)
  );

console.log(
  "===== V03 -> V06 LOCKED REPRO ====="
);

console.log(
  "DISCOVERY:",
  discovery.length
);

console.log(
  "INTERNAL:",
  internal.length
);

console.log(
  "FINAL HOLDOUT: LOCKED"
);

/* ========================================
   V06 PRESENCE
======================================== */

const v06Map =
  new Map(
    (v06.games || [])
      .map(g => [g.gameId, g])
  );

function allPresent(xs) {
  return xs.every(
    g => v06Map.has(g.gameId)
  );
}

console.log(
  "V06 D ALL PRESENT:",
  allPresent(discovery)
);

console.log(
  "V06 I ALL PRESENT:",
  allPresent(internal)
);

/* ========================================
   COPY EXACT V03 SOURCE FUNCTIONS
   Print source sections first so we can
   ensure constants match.
======================================== */

const source =
  fs.readFileSync(V03SRC, "utf8");

function sourceBlock(
  startPattern,
  endPattern
) {
  const lines =
    source.split("\n");

  const start =
    lines.findIndex(l =>
      l.includes(startPattern)
    );

  if (start < 0)
    return null;

  let end =
    lines.findIndex(
      (l, i) =>
        i > start &&
        l.includes(endPattern)
    );

  if (end < 0)
    end = Math.min(
      lines.length,
      start + 120
    );

  return lines
    .slice(start, end)
    .join("\n");
}

console.log();
console.log(
  "===== ORIGINAL V03 PREDICT SOURCE ====="
);

console.log(
  sourceBlock(
    "function blendedEra",
    "function metrics"
  ) || "BLOCK NOT FOUND"
);

/* ========================================
   EXACT V03 LEAGUE D-1
   P80
======================================== */

const PRIOR_RUNS = 4.50;
const PRIOR_GAMES = 80;
const TEAM_WEIGHT = 0.40;
const STARTER_COEF = 0.09;
const MARKET_RUNS = 4.5;

function buildLeagueAverages() {
  const byDate = new Map();

  const grouped = new Map();

  for (const g of games) {
    if (!grouped.has(g.date)) {
      grouped.set(g.date, []);
    }

    grouped.get(g.date).push(g);
  }

  let actualRuns = 0;
  let actualTeamGames = 0;

  for (
    const date
    of [...grouped.keys()].sort()
  ) {
    const league =
      (
        PRIOR_RUNS * PRIOR_GAMES +
        actualRuns
      ) /
      (
        PRIOR_GAMES +
        actualTeamGames
      );

    byDate.set(date, league);

    for (const g of grouped.get(date)) {
      actualRuns +=
        Number(g.awayScore) +
        Number(g.homeScore);

      actualTeamGames += 2;
    }
  }

  return byDate;
}

const leagueByDate =
  buildLeagueAverages();

/* ========================================
   V03 STARTER
======================================== */

function blendedEra(
  season,
  recent
) {
  const s = num(season);
  const r = num(recent);

  if (
    s === null &&
    r === null
  ) return null;

  if (s === null)
    return r;

  if (r === null)
    return s;

  return (
    s * 0.60 +
    r * 0.40
  );
}

/* ========================================
   V03 BASE PREDICTION
======================================== */

function predictBase(g) {
  const x =
    g.scoreModelInputs || {};

  const league =
    leagueByDate.get(g.date);

  if (!Number.isFinite(league))
    return null;

  const awayTeamExpectation =
    (
      Number(x.awayAvgRuns) +
      Number(x.homeAvgRunsAllowed)
    ) / 2;

  const homeTeamExpectation =
    (
      Number(x.homeAvgRuns) +
      Number(x.awayAvgRunsAllowed)
    ) / 2;

  let away =
    league *
      (1 - TEAM_WEIGHT) +
    awayTeamExpectation *
      TEAM_WEIGHT;

  let home =
    league *
      (1 - TEAM_WEIGHT) +
    homeTeamExpectation *
      TEAM_WEIGHT;

  const awayEra =
    blendedEra(
      x.awayStarterEra,
      x.awayStarterRecent5Era
    );

  const homeEra =
    blendedEra(
      x.homeStarterEra,
      x.homeStarterRecent5Era
    );

  const eraNeutral = league;

  if (homeEra !== null) {
    away +=
      (homeEra - eraNeutral) *
      STARTER_COEF;
  }

  if (awayEra !== null) {
    home +=
      (awayEra - eraNeutral) *
      STARTER_COEF;
  }

  return {
    away,
    home
  };
}

/* ========================================
   EXACT TWO-SIDED ML NO-VIG
======================================== */

function marketProb(g) {
  const vg =
    v06Map.get(g.gameId);

  const p =
    num(vg?.market?.awayNoVig);

  return p;
}

/* market probability -> implied margin
   V03 M4.5:
   correction is centered around 0.5.
*/

function predict(g) {
  const base =
    predictBase(g);

  if (!base)
    return null;

  const p =
    marketProb(g);

  if (p === null)
    return null;

  const baseMargin =
    base.away - base.home;

  const marketMargin =
    (p - 0.5) *
    2 *
    MARKET_RUNS;

  const correctedMargin =
    baseMargin +
    marketMargin;

  const total =
    base.away +
    base.home;

  return {
    away:
      total / 2 +
      correctedMargin / 2,

    home:
      total / 2 -
      correctedMargin / 2
  };
}

/* ========================================
   METRICS
======================================== */

function metrics(xs) {
  let teamAbs = 0;
  let totalAbs = 0;
  let diffAbs = 0;

  let within1 = 0;
  let within2 = 0;

  let winnerCorrect = 0;
  let winnerEligible = 0;

  let n = 0;

  for (const g of xs) {
    const p =
      predict(g);

    if (!p)
      continue;

    const a =
      Number(g.awayScore);

    const h =
      Number(g.homeScore);

    const ae =
      Math.abs(p.away - a);

    const he =
      Math.abs(p.home - h);

    teamAbs +=
      (ae + he) / 2;

    totalAbs +=
      Math.abs(
        (p.away + p.home) -
        (a + h)
      );

    diffAbs +=
      Math.abs(
        (p.away - p.home) -
        (a - h)
      );

    if (
      ae <= 1 &&
      he <= 1
    ) within1++;

    if (
      ae <= 2 &&
      he <= 2
    ) within2++;

    const actualMargin =
      a - h;

    const predMargin =
      p.away - p.home;

    if (actualMargin !== 0) {
      winnerEligible++;

      if (
        Math.sign(actualMargin) ===
        Math.sign(predMargin)
      ) {
        winnerCorrect++;
      }
    }

    n++;
  }

  return {
    n,

    teamMAE:
      teamAbs / n,

    totalMAE:
      totalAbs / n,

    diffMAE:
      diffAbs / n,

    within1:
      within1 / n,

    within2:
      within2 / n,

    winnerAcc:
      winnerEligible
        ? winnerCorrect /
          winnerEligible
        : null
  };
}

const D =
  metrics(discovery);

const I =
  metrics(internal);

const avgTeamMAE =
  (
    D.teamMAE +
    I.teamMAE
  ) / 2;

console.log();
console.log(
  "===== BRIDGE RESULT ====="
);

console.log(
  JSON.stringify(
    {
      discovery: D,
      internal: I,
      avgTeamMAE
    },
    null,
    2
  )
);

const TARGET =
  2.5209403214;

console.log();
console.log(
  "TARGET:",
  TARGET
);

console.log(
  "DELTA:",
  avgTeamMAE - TARGET
);

console.log(
  "REPRO EXACT:",
  Math.abs(
    avgTeamMAE - TARGET
  ) < 1e-9
);

console.log();
console.log(
  "FINAL OPENED:",
  false
);

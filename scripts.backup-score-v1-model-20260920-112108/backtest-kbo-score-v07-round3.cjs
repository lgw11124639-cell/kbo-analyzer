const fs = require("fs");

const OLD_PATH =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const V06_PATH =
  "data/kbo-score-features-v06.json";

const oldRoot =
  JSON.parse(fs.readFileSync(OLD_PATH, "utf8"));

const v06Root =
  JSON.parse(fs.readFileSync(V06_PATH, "utf8"));

const oldRows =
  Array.isArray(oldRoot)
    ? oldRoot
    : oldRoot.results ?? [];

const v06Games =
  Array.isArray(v06Root)
    ? v06Root
    : v06Root.games ?? [];

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

function clamp(v, lo, hi) {
  return Math.max(
    lo,
    Math.min(hi, v)
  );
}

function splitOf(g) {
  const month =
    Number(
      String(g.date).slice(5, 7)
    );

  if (month <= 4)
    return "DISCOVERY";

  if (month <= 6)
    return "INTERNAL";

  return "FINAL";
}

/*
 * 동일 실제경기의 ML/HANDICAP/TOTAL 후보가
 * 여러 행 있으므로 gameId 기준 하나만 사용.
 */
const gameMap =
  new Map();

for (const r of oldRows) {
  if (
    !r?.gameId ||
    !Number.isFinite(Number(r.awayScore)) ||
    !Number.isFinite(Number(r.homeScore))
  ) {
    continue;
  }

  if (!gameMap.has(r.gameId))
    gameMap.set(r.gameId, r);
}

const games =
  [...gameMap.values()]
    .sort(
      (a,b) =>
        String(a.date).localeCompare(
          String(b.date)
        ) ||
        String(a.gameId).localeCompare(
          String(b.gameId)
        )
    );

console.log(
  "UNIQUE SETTLED GAMES:",
  games.length
);

/*
 * V0.3 원본과 동일:
 * 당일 경기 결과를 당일 league 평균에
 * 절대 포함하지 않는다.
 */
function buildLeagueAverages(
  priorGames
) {
  const PRIOR_RUNS = 4.50;

  let completedGames = 0;
  let totalRuns = 0;

  const byDate =
    new Map();

  let i = 0;

  while (i < games.length) {
    const date =
      games[i].date;

    let j = i;

    while (
      j < games.length &&
      games[j].date === date
    ) {
      j++;
    }

    const teamGamesBefore =
      completedGames * 2;

    const leagueRuns =
      (
        PRIOR_RUNS *
          priorGames +
        totalRuns
      ) /
      (
        priorGames +
        teamGamesBefore
      );

    byDate.set(
      date,
      leagueRuns
    );

    for (
      let k = i;
      k < j;
      k++
    ) {
      totalRuns +=
        Number(
          games[k].awayScore
        ) +
        Number(
          games[k].homeScore
        );

      completedGames++;
    }

    i = j;
  }

  return byDate;
}

function blendedEra(
  season,
  recent
) {
  season = num(season);
  recent = num(recent);

  if (
    season === null &&
    recent === null
  ) {
    return null;
  }

  if (
    season !== null &&
    recent !== null
  ) {
    return (
      season * 0.60 +
      recent * 0.40
    );
  }

  return season ?? recent;
}

const leagueP80 =
  buildLeagueAverages(80);

/*
 * EXACT V0.3
 * P80 / W0.40 / STARTER
 */
function v03Base(g) {
  const x =
    g.scoreModelInputs;

  if (!x)
    return null;

  const ar =
    num(x.awayAvgRuns);

  const ara =
    num(
      x.awayAvgRunsAllowed
    );

  const hr =
    num(x.homeAvgRuns);

  const hra =
    num(
      x.homeAvgRunsAllowed
    );

  if (
    ar === null ||
    ara === null ||
    hr === null ||
    hra === null
  ) {
    return null;
  }

  const league =
    leagueP80.get(g.date);

  if (
    !Number.isFinite(league)
  ) {
    return null;
  }

  const awayTeamExpectation =
    (ar + hra) / 2;

  const homeTeamExpectation =
    (hr + ara) / 2;

  let away =
    league * 0.60 +
    awayTeamExpectation *
      0.40;

  let home =
    league * 0.60 +
    homeTeamExpectation *
      0.40;

  const homeEra =
    blendedEra(
      x.homeStarterEra,
      x.homeStarterRecent5Era
    );

  const awayEra =
    blendedEra(
      x.awayStarterEra,
      x.awayStarterRecent5Era
    );

  const eraNeutral =
    league;

  if (homeEra !== null) {
    away += clamp(
      (
        homeEra -
        eraNeutral
      ) * 0.09,
      -0.40,
      0.40
    );
  }

  if (awayEra !== null) {
    home += clamp(
      (
        awayEra -
        eraNeutral
      ) * 0.09,
      -0.40,
      0.40
    );
  }

  return {
    away:
      clamp(
        away,
        2.25,
        7.25
      ),

    home:
      clamp(
        home,
        2.25,
        7.25
      )
  };
}

/*
 * 원본 후보행에서 ML 양쪽 배당을 찾는다.
 */
const rowsByGame =
  new Map();

for (const r of oldRows) {
  if (!rowsByGame.has(r.gameId))
    rowsByGame.set(
      r.gameId,
      []
    );

  rowsByGame
    .get(r.gameId)
    .push(r);
}

function noVigMlProb(g) {
  const rows =
    rowsByGame.get(
      g.gameId
    ) ?? [];

  const ml =
    rows.filter(
      r =>
        r.market === "ML" &&
        Number(r.odds) > 1
    );

  if (ml.length < 2)
    return null;

  let awayOdds = null;
  let homeOdds = null;

  for (const r of ml) {
    const label =
      String(
        r.label ?? ""
      );

    if (
      label.includes(
        String(g.awayTeam)
      )
    ) {
      awayOdds =
        Number(r.odds);
    }

    if (
      label.includes(
        String(g.homeTeam)
      )
    ) {
      homeOdds =
        Number(r.odds);
    }
  }

  /*
   * label 매칭이 안 되는 경우
   * confidence 방향으로 추측하지 않는다.
   */
  if (
    !awayOdds ||
    !homeOdds
  ) {
    return null;
  }

  const ia =
    1 / awayOdds;

  const ih =
    1 / homeOdds;

  const sum =
    ia + ih;

  return {
    away:
      ia / sum,
    home:
      ih / sum
  };
}

/*
 * V0.3 champion:
 * FORM 0
 * MARKET 4.5
 */
function champion(g) {
  const base =
    v03Base(g);

  if (!base)
    return null;

  const market =
    noVigMlProb(g);

  let shift = 0;

  if (market) {
    const marketEdge =
      (
        market.away -
        0.50
      ) * 2;

    shift +=
      marketEdge * 4.50;
  }

  return {
    away:
      clamp(
        base.away +
          shift / 2,
        1.75,
        7.75
      ),

    home:
      clamp(
        base.home -
          shift / 2,
        1.75,
        7.75
      )
  };
}

function evaluate(split) {
  let n = 0;

  let teamErr = 0;
  let totalErr = 0;
  let diffErr = 0;

  let within1 = 0;
  let within2 = 0;

  let winnerHit = 0;
  let winnerN = 0;

  for (const g of games) {
    if (
      splitOf(g) !== split
    ) {
      continue;
    }

    const p =
      champion(g);

    if (!p)
      continue;

    const actualAway =
      Number(g.awayScore);

    const actualHome =
      Number(g.homeScore);

    const awayErr =
      Math.abs(
        p.away -
        actualAway
      );

    const homeErr =
      Math.abs(
        p.home -
        actualHome
      );

    teamErr +=
      (
        awayErr +
        homeErr
      ) / 2;

    totalErr +=
      Math.abs(
        (
          p.away +
          p.home
        ) -
        (
          actualAway +
          actualHome
        )
      );

    diffErr +=
      Math.abs(
        (
          p.away -
          p.home
        ) -
        (
          actualAway -
          actualHome
        )
      );

    if (
      awayErr <= 1 &&
      homeErr <= 1
    ) {
      within1++;
    }

    if (
      awayErr <= 2 &&
      homeErr <= 2
    ) {
      within2++;
    }

    const predDiff =
      p.away - p.home;

    const actualDiff =
      actualAway -
      actualHome;

    if (
      actualDiff !== 0 &&
      predDiff !== 0
    ) {
      winnerN++;

      if (
        Math.sign(predDiff) ===
        Math.sign(actualDiff)
      ) {
        winnerHit++;
      }
    }

    n++;
  }

  return {
    n,

    teamMAE:
      teamErr / n,

    totalMAE:
      totalErr / n,

    diffMAE:
      diffErr / n,

    within1:
      within1 / n,

    within2:
      within2 / n,

    winnerAcc:
      winnerN
        ? winnerHit /
          winnerN
        : null
  };
}

const discovery =
  evaluate(
    "DISCOVERY"
  );

const internal =
  evaluate(
    "INTERNAL"
  );

const avgTeamMAE =
  (
    discovery.teamMAE +
    internal.teamMAE
  ) / 2;

const TARGET =
  2.520940321359977;

console.log();
console.log(
  "===== EXACT V03 BRIDGE ====="
);

console.log(
  "DISCOVERY:",
  discovery
);

console.log(
  "INTERNAL:",
  internal
);

console.log(
  "AVG TEAM MAE:",
  avgTeamMAE
);

console.log(
  "TARGET:",
  TARGET
);

console.log(
  "REPRO DELTA:",
  avgTeamMAE -
    TARGET
);

/*
 * V06는 여기부터 추가 피처 전용.
 * 베이스 입력으로 절대 사용하지 않는다.
 */
const v06Map =
  new Map(
    v06Games.map(
      g => [
        g.gameId,
        g
      ]
    )
  );

let joinedD = 0;
let joinedI = 0;

for (const g of games) {
  if (!champion(g))
    continue;

  if (!v06Map.has(g.gameId))
    continue;

  if (
    splitOf(g) ===
    "DISCOVERY"
  ) {
    joinedD++;
  }

  if (
    splitOf(g) ===
    "INTERNAL"
  ) {
    joinedI++;
  }
}

console.log();
console.log(
  "===== V06 FEATURE JOIN ====="
);

console.log(
  "DISCOVERY JOINED:",
  joinedD
);

console.log(
  "INTERNAL JOINED:",
  joinedI
);

/*
=========================================================
V0.7 ROUND 1
DIRECT TEAM SCORE CORRECTION

BASE:
  exact V0.3 champion

TRAIN:
  DISCOVERY + INTERNAL ONLY

FINAL:
  NOT EVALUATED

Unlike previous margin-only experiments,
away/home score corrections are independent.
=========================================================
*/

console.log();
console.log("===== V0.7 ROUND 1 / DIRECT SCORE MODEL =====");

const V07_FEATURES = [
  {
    name:"R5_OFFENSE",
    away:"awayTeamForm.recent5.avgRuns",
    home:"homeTeamForm.recent5.avgRuns",
    center:"league"
  },
  {
    name:"R5_DEFENSE",
    away:"awayTeamForm.recent5.avgRunsAllowed",
    home:"homeTeamForm.recent5.avgRunsAllowed",
    center:"league"
  },
  {
    name:"R10_OFFENSE",
    away:"awayTeamForm.recent10.avgRuns",
    home:"homeTeamForm.recent10.avgRuns",
    center:"league"
  },
  {
    name:"R10_DEFENSE",
    away:"awayTeamForm.recent10.avgRunsAllowed",
    home:"homeTeamForm.recent10.avgRunsAllowed",
    center:"league"
  },
  {
    name:"R20_OFFENSE",
    away:"awayTeamForm.recent20.avgRuns",
    home:"homeTeamForm.recent20.avgRuns",
    center:"league"
  },
  {
    name:"R20_DEFENSE",
    away:"awayTeamForm.recent20.avgRunsAllowed",
    home:"homeTeamForm.recent20.avgRunsAllowed",
    center:"league"
  },
  {
    name:"VENUE_OFFENSE",
    away:"awayTeamForm.awayAvgRuns",
    home:"homeTeamForm.homeAvgRuns",
    center:"league"
  },
  {
    name:"VENUE_DEFENSE",
    away:"awayTeamForm.awayAvgRunsAllowed",
    home:"homeTeamForm.homeAvgRunsAllowed",
    center:"league"
  }
];

const V07_COEFS = [
  -0.30,
  -0.20,
  -0.10,
  -0.05,
  0.05,
  0.10,
  0.20,
  0.30
];

function v07DirectPredictor(feature, coef) {
  return g => {
    const base = champion(g);

    if (!base)
      return null;

    const x =
      v06Map.get(g.gameId);

    if (!x)
      return base;

    const getPath = (obj, path) => {
      const value = path
        .split(".")
        .reduce(
          (cur, key) =>
            cur == null
              ? null
              : cur[key],
          obj
        );

      if (
        value === null ||
        value === undefined ||
        value === ""
      ) {
        return null;
      }

      const n = Number(value);

      return Number.isFinite(n)
        ? n
        : null;
    };

    const av =
      getPath(
        x,
        feature.away
      );

    const hv =
      getPath(
        x,
        feature.home
      );

    const league =
      getPath(
        x,
        "environment.leagueRunsPerTeamD1"
      );

    if (
      av === null ||
      hv === null ||
      league === null
    ) {
      return base;
    }

    /*
      각 팀을 league 기준으로
      독립적으로 움직인다.

      예:
      최근 공격 6.0 / league 4.5
      coef +0.10
      => 해당 팀 예상득점 +0.15

      TOTAL도 자연스럽게 변한다.
    */

    const awaySignal =
      clamp(
        av - league,
        -4,
        4
      );

    const homeSignal =
      clamp(
        hv - league,
        -4,
        4
      );

    return {
      away:
        clamp(
          base.away +
          awaySignal * coef,
          1.50,
          8.00
        ),

      home:
        clamp(
          base.home +
          homeSignal * coef,
          1.50,
          8.00
        )
    };
  };
}


function evaluatePredictor(split, predictor) {
  let n = 0;

  let teamErr = 0;
  let totalErr = 0;
  let diffErr = 0;

  let within1 = 0;
  let within2 = 0;

  let winnerHit = 0;
  let winnerN = 0;

  for (const g of games) {
    if (
      splitOf(g) !== split
    ) {
      continue;
    }

    const p =
      predictor(g);

    if (!p)
      continue;

    const actualAway =
      Number(g.awayScore);

    const actualHome =
      Number(g.homeScore);

    if (
      !Number.isFinite(actualAway) ||
      !Number.isFinite(actualHome)
    ) {
      continue;
    }

    const awayErr =
      Math.abs(
        p.away -
        actualAway
      );

    const homeErr =
      Math.abs(
        p.home -
        actualHome
      );

    teamErr +=
      (
        awayErr +
        homeErr
      ) / 2;

    totalErr +=
      Math.abs(
        (
          p.away +
          p.home
        ) -
        (
          actualAway +
          actualHome
        )
      );

    diffErr +=
      Math.abs(
        (
          p.away -
          p.home
        ) -
        (
          actualAway -
          actualHome
        )
      );

    if (
      awayErr <= 1 &&
      homeErr <= 1
    ) {
      within1++;
    }

    if (
      awayErr <= 2 &&
      homeErr <= 2
    ) {
      within2++;
    }

    const predDiff =
      p.away -
      p.home;

    const actualDiff =
      actualAway -
      actualHome;

    if (
      actualDiff !== 0 &&
      predDiff !== 0
    ) {
      winnerN++;

      if (
        Math.sign(predDiff) ===
        Math.sign(actualDiff)
      ) {
        winnerHit++;
      }
    }

    n++;
  }

  return {
    n,

    teamMAE:
      n
        ? teamErr / n
        : null,

    totalMAE:
      n
        ? totalErr / n
        : null,

    diffMAE:
      n
        ? diffErr / n
        : null,

    within1:
      n
        ? within1 / n
        : null,

    within2:
      n
        ? within2 / n
        : null,

    winnerAcc:
      winnerN
        ? winnerHit / winnerN
        : null
  };
}

const V07_BASE_D =
  evaluatePredictor(
    "DISCOVERY",
    champion
  );

const V07_BASE_I =
  evaluatePredictor(
    "INTERNAL",
    champion
  );

const V07_BASE_AVG =
  (
    V07_BASE_D.teamMAE +
    V07_BASE_I.teamMAE
  ) / 2;

console.log();
console.log("===== BASELINE LOCK =====");

console.log(
  "D",
  V07_BASE_D.n,
  V07_BASE_D.teamMAE
);

console.log(
  "I",
  V07_BASE_I.n,
  V07_BASE_I.teamMAE
);

console.log(
  "AVG",
  V07_BASE_AVG
);

console.log(
  "TARGET",
  2.520940321359977
);

console.log(
  "REPRO DELTA",
  V07_BASE_AVG -
    2.520940321359977
);

const v07Results = [];

for (const feature of V07_FEATURES) {
  for (const coef of V07_COEFS) {

    const predictor =
      v07DirectPredictor(
        feature,
        coef
      );

    const d =
      evaluatePredictor(
        "DISCOVERY",
        predictor
      );

    const i =
      evaluatePredictor(
        "INTERNAL",
        predictor
      );

    const avgTeam =
      (
        d.teamMAE +
        i.teamMAE
      ) / 2;

    const avgTotal =
      (
        d.totalMAE +
        i.totalMAE
      ) / 2;

    const avgDiff =
      (
        d.diffMAE +
        i.diffMAE
      ) / 2;

    const avgWinner =
      (
        d.winnerAcc +
        i.winnerAcc
      ) / 2;

    v07Results.push({
      name:feature.name,
      coef,

      d,
      i,

      avgTeam,
      avgTotal,
      avgDiff,
      avgWinner,

      dDelta:
        d.teamMAE -
        V07_BASE_D.teamMAE,

      iDelta:
        i.teamMAE -
        V07_BASE_I.teamMAE,

      avgDelta:
        avgTeam -
        V07_BASE_AVG
    });
  }
}

v07Results.sort(
  (a,b) =>
    a.avgTeam -
    b.avgTeam
);

console.log();
console.log("===== V0.7 FAMILY BEST =====");

for (const feature of V07_FEATURES) {

  const family =
    v07Results
      .filter(
        x =>
          x.name ===
          feature.name
      )
      .sort(
        (a,b) =>
          a.avgTeam -
          b.avgTeam
      );

  const r =
    family[0];

  const robust =
    r.dDelta < 0 &&
    r.iDelta < 0;

  console.log(
    robust
      ? "ROBUST"
      : "FAIL",
    r.name,
    "coef=" + r.coef,
    "D=" +
      r.d.teamMAE.toFixed(6),
    "DΔ=" +
      r.dDelta.toFixed(6),
    "I=" +
      r.i.teamMAE.toFixed(6),
    "IΔ=" +
      r.iDelta.toFixed(6),
    "AVG=" +
      r.avgTeam.toFixed(6),
    "AVGΔ=" +
      r.avgDelta.toFixed(6),
    "TOTAL=" +
      r.avgTotal.toFixed(6),
    "DIFF=" +
      r.avgDiff.toFixed(6),
    "W=" +
      (
        r.avgWinner *
        100
      ).toFixed(1) +
      "%"
  );
}

console.log();
console.log("===== V0.7 ROBUST RANKING =====");

const robust =
  v07Results
    .filter(
      r =>
        r.dDelta < 0 &&
        r.iDelta < 0
    )
    .sort(
      (a,b) =>
        a.avgTeam -
        b.avgTeam
    );

for (
  let n = 0;
  n < Math.min(
    robust.length,
    20
  );
  n++
) {
  const r =
    robust[n];

  console.log(
    `${n + 1}.`,
    r.name,
    "coef=" + r.coef,
    "AVG=" +
      r.avgTeam.toFixed(6),
    "AVGΔ=" +
      r.avgDelta.toFixed(6),
    "DΔ=" +
      r.dDelta.toFixed(6),
    "IΔ=" +
      r.iDelta.toFixed(6),
    "TOTAL=" +
      r.avgTotal.toFixed(6),
    "DIFF=" +
      r.avgDiff.toFixed(6),
    "W=" +
      (
        r.avgWinner *
        100
      ).toFixed(1) +
      "%"
  );
}

console.log();

if (robust.length) {
  console.log(
    "BEST V0.7 ROUND1:",
    robust[0].name,
    "coef=" + robust[0].coef,
    "AVG=" + robust[0].avgTeam
  );
} else {
  console.log(
    "BEST V0.7 ROUND1: NONE"
  );
}

console.log();

console.log();
console.log("===== V0.7 ROUND 2 / COMBINATIONS =====");

/*
  Round 1 frozen coefficients.
  No coefficient retuning here.
*/

const R2 = {
  R5_DEFENSE: {
    name: "R5_DEFENSE",
    away: "awayTeamForm.recent5.avgRunsAllowed",
    home: "homeTeamForm.recent5.avgRunsAllowed",
    center: "league",
    coef: 0.20
  },

  VENUE_OFFENSE: {
    name: "VENUE_OFFENSE",
    away: "awayTeamForm.awayAvgRuns",
    home: "homeTeamForm.homeAvgRuns",
    center: "league",
    coef: -0.20
  },

  VENUE_DEFENSE: {
    name: "VENUE_DEFENSE",
    away: "awayTeamForm.awayAvgRunsAllowed",
    home: "homeTeamForm.homeAvgRunsAllowed",
    center: "league",
    coef: -0.10
  },

  R10_OFFENSE: {
    name: "R10_OFFENSE",
    away: "awayTeamForm.recent10.avgRuns",
    home: "homeTeamForm.recent10.avgRuns",
    center: "league",
    coef: -0.05
  },

  R20_OFFENSE: {
    name: "R20_OFFENSE",
    away: "awayTeamForm.recent20.avgRuns",
    home: "homeTeamForm.recent20.avgRuns",
    center: "league",
    coef: -0.05
  }
};

function r2Predictor(features) {
  const predictors =
    features.map(
      f =>
        v07DirectPredictor(
          f,
          f.coef
        )
    );

  return g => {
    const base =
      champion(g);

    if (!base)
      return null;

    let away =
      base.away;

    let home =
      base.home;

    for (const predictor of predictors) {
      const one =
        predictor(g);

      if (!one)
        continue;

      /*
        v07DirectPredictor returns
        champion + this feature's correction.

        Add only its correction so multiple
        features stack without adding champion twice.
      */

      away +=
        one.away -
        base.away;

      home +=
        one.home -
        base.home;
    }

    return {
      away:
        clamp(
          away,
          1.50,
          8.00
        ),

      home:
        clamp(
          home,
          1.50,
          8.00
        )
    };
  };
}

const R2_COMBOS = [
  {
    name: "R5D",
    features: [
      R2.R5_DEFENSE
    ]
  },

  {
    name: "R5D + VENUE_OFF",
    features: [
      R2.R5_DEFENSE,
      R2.VENUE_OFFENSE
    ]
  },

  {
    name: "R5D + VENUE_DEF",
    features: [
      R2.R5_DEFENSE,
      R2.VENUE_DEFENSE
    ]
  },

  {
    name: "R5D + R10_OFF",
    features: [
      R2.R5_DEFENSE,
      R2.R10_OFFENSE
    ]
  },

  {
    name: "R5D + R20_OFF",
    features: [
      R2.R5_DEFENSE,
      R2.R20_OFFENSE
    ]
  },

  {
    name: "R5D + VENUE_OFF + VENUE_DEF",
    features: [
      R2.R5_DEFENSE,
      R2.VENUE_OFFENSE,
      R2.VENUE_DEFENSE
    ]
  },

  {
    name: "R5D + VENUE_OFF + R10_OFF",
    features: [
      R2.R5_DEFENSE,
      R2.VENUE_OFFENSE,
      R2.R10_OFFENSE
    ]
  },

  {
    name: "R5D + VENUE_OFF + R20_OFF",
    features: [
      R2.R5_DEFENSE,
      R2.VENUE_OFFENSE,
      R2.R20_OFFENSE
    ]
  }
];

const r2BaseD =
  evaluatePredictor(
    "DISCOVERY",
    champion
  );

const r2BaseI =
  evaluatePredictor(
    "INTERNAL",
    champion
  );

const r2BaseAvg =
  (
    r2BaseD.teamMAE +
    r2BaseI.teamMAE
  ) / 2;

const r2Rows = [];

for (const combo of R2_COMBOS) {
  const predictor =
    r2Predictor(
      combo.features
    );

  const d =
    evaluatePredictor(
      "DISCOVERY",
      predictor
    );

  const i =
    evaluatePredictor(
      "INTERNAL",
      predictor
    );

  const avg =
    (
      d.teamMAE +
      i.teamMAE
    ) / 2;

  r2Rows.push({
    name: combo.name,
    d,
    i,
    avg,

    dDelta:
      d.teamMAE -
      r2BaseD.teamMAE,

    iDelta:
      i.teamMAE -
      r2BaseI.teamMAE,

    avgDelta:
      avg -
      r2BaseAvg,

    total:
      (
        d.totalMAE +
        i.totalMAE
      ) / 2,

    diff:
      (
        d.diffMAE +
        i.diffMAE
      ) / 2,

    winner:
      (
        d.winnerAcc +
        i.winnerAcc
      ) / 2,

    within1:
      (
        d.within1 +
        i.within1
      ) / 2,

    within2:
      (
        d.within2 +
        i.within2
      ) / 2
  });
}

r2Rows.sort(
  (a,b) =>
    a.avg -
    b.avg
);

console.log();
console.log("===== ROUND 2 RANKING =====");

for (
  let idx = 0;
  idx < r2Rows.length;
  idx++
) {
  const r =
    r2Rows[idx];

  const robust =
    r.dDelta < 0 &&
    r.iDelta < 0;

  console.log(
    `${idx + 1}.`,
    robust
      ? "ROBUST"
      : "FAIL",
    r.name,
    "AVG=" +
      r.avg.toFixed(6),
    "AVGΔ=" +
      r.avgDelta.toFixed(6),
    "D=" +
      r.d.teamMAE.toFixed(6),
    "DΔ=" +
      r.dDelta.toFixed(6),
    "I=" +
      r.i.teamMAE.toFixed(6),
    "IΔ=" +
      r.iDelta.toFixed(6),
    "TOTAL=" +
      r.total.toFixed(6),
    "DIFF=" +
      r.diff.toFixed(6),
    "±1=" +
      (
        r.within1 *
        100
      ).toFixed(1) +
      "%",
    "±2=" +
      (
        r.within2 *
        100
      ).toFixed(1) +
      "%",
    "W=" +
      (
        r.winner *
        100
      ).toFixed(1) +
      "%"
  );
}

const r2Robust =
  r2Rows.filter(
    r =>
      r.dDelta < 0 &&
      r.iDelta < 0
  );

console.log();

if (r2Robust.length) {
  console.log(
    "BEST V0.7 ROUND2:",
    r2Robust[0].name,
    "AVG=" +
      r2Robust[0].avg,
    "AVG_DELTA=" +
      r2Robust[0].avgDelta
  );
} else {
  console.log(
    "BEST V0.7 ROUND2: NONE"
  );
}


console.log();
console.log("===== V0.7 ROUND 3 / STARTER LINEUP BULLPEN =====");

/*
  Frozen Round2 champion:
  R5_DEFENSE   +0.20
  VENUE_OFF    -0.20
  VENUE_DEF    -0.10

  Final/Audit is NOT evaluated.
*/

const R3_BASE_FEATURES = [
  R2.R5_DEFENSE,
  R2.VENUE_OFFENSE,
  R2.VENUE_DEFENSE
];

const r3BasePredictor =
  r2Predictor(R3_BASE_FEATURES);

const r3Get = (obj, path) => {
  const v = path
    .split(".")
    .reduce(
      (cur, key) =>
        cur == null
          ? null
          : cur[key],
      obj
    );

  if (
    v === null ||
    v === undefined ||
    v === ""
  ) return null;

  const n = Number(v);

  return Number.isFinite(n)
    ? n
    : null;
};

/*
  All signals are applied to OPPONENT scoring.

  opposing starter worse -> batting team score up
  stronger lineup       -> own score up
  bullpen fatigue       -> opponent score up
*/

const R3_FEATURES = [
  {
    name: "STARTER_WHIP",
    kind: "opponent",
    awayPath: "starter.away.whip",
    homePath: "starter.home.whip",
    center: 1.40,
    scale: 1.0,
    coefs: [-0.30,-0.20,-0.10,-0.05,0.05,0.10,0.20,0.30]
  },

  {
    name: "STARTER_RECENT5_ERA",
    kind: "opponent",
    awayPath: "starter.away.recent5.era",
    homePath: "starter.home.recent5.era",
    center: 4.50,
    scale: 0.25,
    coefs: [-0.30,-0.20,-0.10,-0.05,0.05,0.10,0.20,0.30]
  },

  {
    name: "LINEUP_OPS",
    kind: "own",
    awayPath: "lineup.away.avgOps",
    homePath: "lineup.home.avgOps",
    center: 0.700,
    scale: 5.0,
    coefs: [-0.30,-0.20,-0.10,-0.05,0.05,0.10,0.20,0.30]
  },

  {
    name: "LINEUP_OBP",
    kind: "own",
    awayPath: "lineup.away.avgObp",
    homePath: "lineup.home.avgObp",
    center: 0.330,
    scale: 8.0,
    coefs: [-0.30,-0.20,-0.10,-0.05,0.05,0.10,0.20,0.30]
  },

  {
    name: "BULLPEN_FATIGUE",
    kind: "opponent",
    awayPath: "bullpen.awayFatigue",
    homePath: "bullpen.homeFatigue",
    center: 50,
    scale: 0.02,
    coefs: [-0.30,-0.20,-0.10,-0.05,0.05,0.10,0.20,0.30]
  }
];

function r3Predictor(feature, coef) {
  return g => {
    const base =
      r3BasePredictor(g);

    if (!base)
      return null;

    const x =
      v06Map.get(g.gameId);

    if (!x)
      return base;

    const av =
      r3Get(
        x,
        feature.awayPath
      );

    const hv =
      r3Get(
        x,
        feature.homePath
      );

    if (
      av === null ||
      hv === null
    ) {
      return base;
    }

    const aSignal =
      clamp(
        (av - feature.center) *
        feature.scale,
        -3,
        3
      );

    const hSignal =
      clamp(
        (hv - feature.center) *
        feature.scale,
        -3,
        3
      );

    let away = base.away;
    let home = base.home;

    if (feature.kind === "own") {
      away += aSignal * coef;
      home += hSignal * coef;
    } else {
      /*
        away starter affects HOME scoring.
        home starter affects AWAY scoring.
      */
      home += aSignal * coef;
      away += hSignal * coef;
    }

    return {
      away: clamp(away, 1.50, 8.00),
      home: clamp(home, 1.50, 8.00)
    };
  };
}

const r3BaseD =
  evaluatePredictor(
    "DISCOVERY",
    r3BasePredictor
  );

const r3BaseI =
  evaluatePredictor(
    "INTERNAL",
    r3BasePredictor
  );

const r3BaseAvg =
  (
    r3BaseD.teamMAE +
    r3BaseI.teamMAE
  ) / 2;

console.log(
  "ROUND3 BASE",
  "D=" + r3BaseD.teamMAE,
  "I=" + r3BaseI.teamMAE,
  "AVG=" + r3BaseAvg
);

console.log(
  "ROUND2 TARGET",
  2.501071010917739
);

console.log(
  "ROUND2 REPRO DELTA",
  r3BaseAvg -
  2.501071010917739
);

const r3Rows = [];

for (const feature of R3_FEATURES) {
  for (const coef of feature.coefs) {
    const predictor =
      r3Predictor(
        feature,
        coef
      );

    const d =
      evaluatePredictor(
        "DISCOVERY",
        predictor
      );

    const i =
      evaluatePredictor(
        "INTERNAL",
        predictor
      );

    const avg =
      (
        d.teamMAE +
        i.teamMAE
      ) / 2;

    r3Rows.push({
      name: feature.name,
      coef,
      d,
      i,
      avg,

      dDelta:
        d.teamMAE -
        r3BaseD.teamMAE,

      iDelta:
        i.teamMAE -
        r3BaseI.teamMAE,

      avgDelta:
        avg -
        r3BaseAvg,

      total:
        (
          d.totalMAE +
          i.totalMAE
        ) / 2,

      diff:
        (
          d.diffMAE +
          i.diffMAE
        ) / 2,

      winner:
        (
          d.winnerAcc +
          i.winnerAcc
        ) / 2
    });
  }
}

console.log();
console.log("===== ROUND 3 FAMILY BEST =====");

for (const feature of R3_FEATURES) {
  const family =
    r3Rows
      .filter(
        r =>
          r.name === feature.name
      )
      .sort(
        (a,b) =>
          a.avg - b.avg
      );

  const r = family[0];

  const robust =
    r.dDelta < 0 &&
    r.iDelta < 0;

  console.log(
    robust ? "ROBUST" : "FAIL",
    r.name,
    "coef=" + r.coef,
    "AVG=" + r.avg.toFixed(6),
    "AVGΔ=" + r.avgDelta.toFixed(6),
    "DΔ=" + r.dDelta.toFixed(6),
    "IΔ=" + r.iDelta.toFixed(6),
    "TOTAL=" + r.total.toFixed(6),
    "DIFF=" + r.diff.toFixed(6),
    "W=" +
      (r.winner * 100).toFixed(1) +
      "%"
  );
}

console.log();
console.log("===== ROUND 3 ROBUST RANKING =====");

const r3Robust =
  r3Rows
    .filter(
      r =>
        r.dDelta < 0 &&
        r.iDelta < 0
    )
    .sort(
      (a,b) =>
        a.avg - b.avg
    );

for (
  let i = 0;
  i < Math.min(20, r3Robust.length);
  i++
) {
  const r = r3Robust[i];

  console.log(
    `${i + 1}.`,
    r.name,
    "coef=" + r.coef,
    "AVG=" + r.avg.toFixed(6),
    "AVGΔ=" + r.avgDelta.toFixed(6),
    "DΔ=" + r.dDelta.toFixed(6),
    "IΔ=" + r.iDelta.toFixed(6),
    "TOTAL=" + r.total.toFixed(6),
    "DIFF=" + r.diff.toFixed(6),
    "W=" +
      (r.winner * 100).toFixed(1) +
      "%"
  );
}

console.log();

if (r3Robust.length) {
  console.log(
    "BEST V0.7 ROUND3:",
    r3Robust[0].name,
    "coef=" + r3Robust[0].coef,
    "AVG=" + r3Robust[0].avg,
    "AVG_DELTA=" +
      r3Robust[0].avgDelta
  );
} else {
  console.log(
    "BEST V0.7 ROUND3: NONE"
  );
}

console.log(
  "ROUND3 FINAL/AUDIT: NOT EVALUATED"
);


console.log(
  "ROUND2 FINAL/AUDIT: NOT EVALUATED"
);


console.log(
  "V0.7 FINAL HOLDOUT: NOT EVALUATED"
);



console.log(
  "FINAL HOLDOUT: NOT TOUCHED"
);

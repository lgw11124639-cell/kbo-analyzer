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

console.log();
console.log("===== V0.7 ROUND 4 / ROBUST COMBINATION =====");

/*
  Frozen Round3 base:
  R5_DEFENSE   +0.20
  VENUE_OFF    -0.20
  VENUE_DEF    -0.10

  Frozen Round3 additions:
  BULLPEN_FATIGUE -0.30
  LINEUP_OPS       -0.30
  LINEUP_OBP       -0.30

  No coefficient retuning.
  Final/Audit NOT evaluated.
*/

const R4_FIXED = {
  BULLPEN_FATIGUE: {
    name: "BULLPEN_FATIGUE",
    kind: "opponent",
    awayPath: "bullpen.awayFatigue",
    homePath: "bullpen.homeFatigue",
    center: 50,
    scale: 0.02,
    coef: -0.30
  },

  LINEUP_OPS: {
    name: "LINEUP_OPS",
    kind: "own",
    awayPath: "lineup.away.avgOps",
    homePath: "lineup.home.avgOps",
    center: 0.700,
    scale: 5.0,
    coef: -0.30
  },

  LINEUP_OBP: {
    name: "LINEUP_OBP",
    kind: "own",
    awayPath: "lineup.away.avgObp",
    homePath: "lineup.home.avgObp",
    center: 0.330,
    scale: 8.0,
    coef: -0.30
  }
};

function applyR4Feature(score, x, feature) {
  const av =
    r3Get(x, feature.awayPath);

  const hv =
    r3Get(x, feature.homePath);

  if (
    av === null ||
    hv === null
  ) {
    return score;
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

  let away = score.away;
  let home = score.home;

  if (feature.kind === "own") {
    away +=
      aSignal *
      feature.coef;

    home +=
      hSignal *
      feature.coef;
  } else {
    /*
      Away bullpen affects HOME scoring.
      Home bullpen affects AWAY scoring.
    */
    home +=
      aSignal *
      feature.coef;

    away +=
      hSignal *
      feature.coef;
  }

  return {
    away: clamp(
      away,
      1.50,
      8.00
    ),
    home: clamp(
      home,
      1.50,
      8.00
    )
  };
}

function r4Predictor(features) {
  return g => {
    const base =
      r3BasePredictor(g);

    if (!base)
      return null;

    const x =
      v06Map.get(g.gameId);

    if (!x)
      return base;

    let score = {
      away: base.away,
      home: base.home
    };

    for (const feature of features) {
      score =
        applyR4Feature(
          score,
          x,
          feature
        );
    }

    return score;
  };
}

const R4_COMBOS = [
  {
    name: "BULLPEN",
    features: [
      R4_FIXED.BULLPEN_FATIGUE
    ]
  },

  {
    name: "BULLPEN + OPS",
    features: [
      R4_FIXED.BULLPEN_FATIGUE,
      R4_FIXED.LINEUP_OPS
    ]
  },

  {
    name: "BULLPEN + OBP",
    features: [
      R4_FIXED.BULLPEN_FATIGUE,
      R4_FIXED.LINEUP_OBP
    ]
  },

  {
    name: "BULLPEN + OPS + OBP",
    features: [
      R4_FIXED.BULLPEN_FATIGUE,
      R4_FIXED.LINEUP_OPS,
      R4_FIXED.LINEUP_OBP
    ]
  }
];

const r4BasePredictor =
  r4Predictor([
    R4_FIXED.BULLPEN_FATIGUE
  ]);

const r4BaseD =
  evaluatePredictor(
    "DISCOVERY",
    r4BasePredictor
  );

const r4BaseI =
  evaluatePredictor(
    "INTERNAL",
    r4BasePredictor
  );

const r4BaseAvg =
  (
    r4BaseD.teamMAE +
    r4BaseI.teamMAE
  ) / 2;

console.log(
  "ROUND4 CURRENT BASE = BULLPEN"
);

console.log(
  "D=" + r4BaseD.teamMAE,
  "I=" + r4BaseI.teamMAE,
  "AVG=" + r4BaseAvg
);

console.log(
  "ROUND3 TARGET",
  2.4869630376576177
);

console.log(
  "ROUND3 REPRO DELTA",
  r4BaseAvg -
  2.4869630376576177
);

const r4Results = [];

for (const combo of R4_COMBOS) {
  const predictor =
    r4Predictor(
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

  const total =
    (
      d.totalMAE +
      i.totalMAE
    ) / 2;

  const diff =
    (
      d.diffMAE +
      i.diffMAE
    ) / 2;

  const winner =
    (
      d.winnerAcc +
      i.winnerAcc
    ) / 2;

  r4Results.push({
    name: combo.name,
    d,
    i,
    avg,
    total,
    diff,
    winner,

    dDelta:
      d.teamMAE -
      r4BaseD.teamMAE,

    iDelta:
      i.teamMAE -
      r4BaseI.teamMAE,

    avgDelta:
      avg -
      r4BaseAvg
  });
}

r4Results.sort(
  (a,b) =>
    a.avg - b.avg
);

console.log();
console.log(
  "===== ROUND 4 RESULTS ====="
);

for (const r of r4Results) {
  const isBase =
    r.name === "BULLPEN";

  const robust =
    isBase ||
    (
      r.dDelta < 0 &&
      r.iDelta < 0 &&
      r.avgDelta < 0
    );

  console.log(
    isBase
      ? "BASE"
      : robust
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

    "W=" +
      (
        r.winner * 100
      ).toFixed(1) +
      "%"
  );
}

const r4Robust =
  r4Results.filter(
    r =>
      r.name !== "BULLPEN" &&
      r.dDelta < 0 &&
      r.iDelta < 0 &&
      r.avgDelta < 0
  );

console.log();
console.log(
  "===== ROUND 4 DECISION ====="
);

if (r4Robust.length) {
  const best =
    r4Robust[0];

  console.log(
    "BEST V0.7 ROUND4:",
    best.name,
    "AVG=" + best.avg,
    "AVG_DELTA_VS_BULLPEN=" +
      best.avgDelta
  );
} else {
  console.log(
    "BEST V0.7 ROUND4: BULLPEN ONLY"
  );
}

console.log(
  "ROUND4 FINAL/AUDIT: NOT EVALUATED"
);


console.log();
console.log("===== V0.7 ROUND 5 / STABILITY CHECK =====");

/*
  NO RETUNING.
  Compare only:

  A = BULLPEN + OPS
  B = BULLPEN + OPS + OBP

  Discovery/Internal only.
  Final/Audit is NOT evaluated.
*/

const R5_A_NAME =
  "BULLPEN + OPS";

const R5_B_NAME =
  "BULLPEN + OPS + OBP";

const R5_A =
  r4Predictor([
    R4_FIXED.BULLPEN_FATIGUE,
    R4_FIXED.LINEUP_OPS
  ]);

const R5_B =
  r4Predictor([
    R4_FIXED.BULLPEN_FATIGUE,
    R4_FIXED.LINEUP_OPS,
    R4_FIXED.LINEUP_OBP
  ]);

function r5Period(date) {
  const d = String(date || "");

  if (d.startsWith("2026-03"))
    return "2026-03";

  if (d.startsWith("2026-04"))
    return "2026-04";

  if (d.startsWith("2026-05"))
    return "2026-05";

  if (d.startsWith("2026-06"))
    return "2026-06";

  return null;
}

function r5Actual(g) {
  const away =
    Number(g.awayScore);

  const home =
    Number(g.homeScore);

  if (
    !Number.isFinite(away) ||
    !Number.isFinite(home)
  ) {
    return null;
  }

  return {
    away,
    home
  };
}

function r5EvaluateFilter(
  predictor,
  filter
) {
  let n = 0;

  let teamAbs = 0;
  let totalAbs = 0;
  let diffAbs = 0;

  let winnerN = 0;
  let winnerHit = 0;

  let within1 = 0;
  let within2 = 0;

  for (const g of games) {
    if (!filter(g))
      continue;

    const actual =
      r5Actual(g);

    if (!actual)
      continue;

    const pred =
      predictor(g);

    if (!pred)
      continue;

    const pa =
      Number(pred.away);

    const ph =
      Number(pred.home);

    if (
      !Number.isFinite(pa) ||
      !Number.isFinite(ph)
    ) {
      continue;
    }

    n++;

    const ae =
      Math.abs(
        pa - actual.away
      );

    const he =
      Math.abs(
        ph - actual.home
      );

    teamAbs +=
      ae + he;

    totalAbs +=
      Math.abs(
        (pa + ph) -
        (
          actual.away +
          actual.home
        )
      );

    diffAbs +=
      Math.abs(
        (ph - pa) -
        (
          actual.home -
          actual.away
        )
      );

    if (
      ae <= 1 &&
      he <= 1
    ) {
      within1++;
    }

    if (
      ae <= 2 &&
      he <= 2
    ) {
      within2++;
    }

    const actualDiff =
      actual.home -
      actual.away;

    const predDiff =
      ph - pa;

    if (actualDiff !== 0) {
      winnerN++;

      if (
        Math.sign(actualDiff) ===
        Math.sign(predDiff)
      ) {
        winnerHit++;
      }
    }
  }

  if (!n) {
    return {
      n: 0,
      teamMAE: NaN,
      totalMAE: NaN,
      diffMAE: NaN,
      within1: NaN,
      within2: NaN,
      winnerAcc: NaN
    };
  }

  return {
    n,

    teamMAE:
      teamAbs /
      (n * 2),

    totalMAE:
      totalAbs / n,

    diffMAE:
      diffAbs / n,

    within1:
      within1 / n,

    within2:
      within2 / n,

    winnerAcc:
      winnerN
        ? winnerHit / winnerN
        : NaN
  };
}

function r5Print(
  label,
  a,
  b
) {
  const delta =
    b.teamMAE -
    a.teamMAE;

  const winner =
    delta < 0
      ? "OPS+OBP"
      : delta > 0
        ? "OPS"
        : "TIE";

  console.log(
    label,

    "n=" + a.n,

    "OPS=" +
      a.teamMAE.toFixed(6),

    "OPS+OBP=" +
      b.teamMAE.toFixed(6),

    "Δ(B-A)=" +
      delta.toFixed(6),

    "WIN=" +
      winner,

    "| OPS TOTAL=" +
      a.totalMAE.toFixed(6),

    "DIFF=" +
      a.diffMAE.toFixed(6),

    "±1=" +
      (
        a.within1 * 100
      ).toFixed(1) +
      "%",

    "±2=" +
      (
        a.within2 * 100
      ).toFixed(1) +
      "%",

    "W=" +
      (
        a.winnerAcc * 100
      ).toFixed(1) +
      "%",

    "| BOTH TOTAL=" +
      b.totalMAE.toFixed(6),

    "DIFF=" +
      b.diffMAE.toFixed(6),

    "±1=" +
      (
        b.within1 * 100
      ).toFixed(1) +
      "%",

    "±2=" +
      (
        b.within2 * 100
      ).toFixed(1) +
      "%",

    "W=" +
      (
        b.winnerAcc * 100
      ).toFixed(1) +
      "%"
  );

  return {
    delta,
    winner
  };
}

console.log();
console.log(
  "===== MONTHLY STABILITY ====="
);

const months = [
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06"
];

let monthOpsWins = 0;
let monthBothWins = 0;

for (const month of months) {
  const filter =
    g =>
      r5Period(g.date) === month;

  const a =
    r5EvaluateFilter(
      R5_A,
      filter
    );

  const b =
    r5EvaluateFilter(
      R5_B,
      filter
    );

  const result =
    r5Print(
      month,
      a,
      b
    );

  if (result.winner === "OPS")
    monthOpsWins++;

  if (result.winner === "OPS+OBP")
    monthBothWins++;
}

console.log();
console.log(
  "MONTH WINS",
  "OPS=" + monthOpsWins,
  "OPS+OBP=" + monthBothWins
);

/*
  Chronological walk-forward style folds.

  Fold 1:
  March -> April evaluation

  Fold 2:
  Mar-Apr -> May evaluation

  Fold 3:
  Mar-May -> June evaluation

  Since coefficients are already frozen,
  these are pure chronological evaluation
  windows, not retraining/tuning windows.
*/

const folds = [
  {
    name: "WF1 APR",
    month: "2026-04"
  },
  {
    name: "WF2 MAY",
    month: "2026-05"
  },
  {
    name: "WF3 JUN",
    month: "2026-06"
  }
];

console.log();
console.log(
  "===== WALK-FORWARD STABILITY ====="
);

let wfOpsWins = 0;
let wfBothWins = 0;

for (const fold of folds) {
  const filter =
    g =>
      r5Period(g.date) ===
      fold.month;

  const a =
    r5EvaluateFilter(
      R5_A,
      filter
    );

  const b =
    r5EvaluateFilter(
      R5_B,
      filter
    );

  const result =
    r5Print(
      fold.name,
      a,
      b
    );

  if (result.winner === "OPS")
    wfOpsWins++;

  if (result.winner === "OPS+OBP")
    wfBothWins++;
}

console.log();
console.log(
  "WF WINS",
  "OPS=" + wfOpsWins,
  "OPS+OBP=" + wfBothWins
);

console.log();
console.log(
  "===== FULL D/I CHECK ====="
);

const fullFilter =
  g => {
    const p =
      r5Period(g.date);

    return (
      p === "2026-03" ||
      p === "2026-04" ||
      p === "2026-05" ||
      p === "2026-06"
    );
  };

const fullA =
  r5EvaluateFilter(
    R5_A,
    fullFilter
  );

const fullB =
  r5EvaluateFilter(
    R5_B,
    fullFilter
  );

r5Print(
  "MAR-JUN",
  fullA,
  fullB
);

console.log();
console.log(
  "===== ROUND 5 DECISION ====="
);

/*
  OBP must show repeatable benefit.
  Tiny full-sample MAE improvement alone
  is NOT enough.

  Require:
  - OPS+OBP wins >= 3 of 4 months
  - OPS+OBP wins >= 2 of 3 WF windows

  Otherwise prefer simpler OPS model.
*/

if (
  monthBothWins >= 3 &&
  wfBothWins >= 2 &&
  fullB.teamMAE <
    fullA.teamMAE
) {
  console.log(
    "ROUND5 WINNER:",
    R5_B_NAME
  );

  console.log(
    "KEEP OBP: YES"
  );
} else {
  console.log(
    "ROUND5 WINNER:",
    R5_A_NAME
  );

  console.log(
    "KEEP OBP: NO"
  );
}

console.log(
  "ROUND5 FINAL/AUDIT: NOT EVALUATED"
);


console.log();
console.log("===== V0.7 ROUND 6 / NEW INDEPENDENT FEATURES =====");

/*
  FROZEN BASE:
  V0.3 Champion
  + R5_DEFENSE       +0.20
  + VENUE_OFFENSE    -0.20
  + VENUE_DEFENSE    -0.10
  + BULLPEN_FATIGUE  -0.30
  + LINEUP_OPS       -0.30

  OBP rejected in Round5.

  Round6:
  screen new features ONE AT A TIME.

  Final/Audit NOT evaluated.
*/

const R6_BASE =
  r4Predictor([
    R4_FIXED.BULLPEN_FATIGUE,
    R4_FIXED.LINEUP_OPS
  ]);

const r6Get = (obj, path) => {
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
  We derive neutral centers ONLY from Discovery.

  This avoids using Internal to define
  the feature center.
*/

function r6DiscoveryCenter(
  awayPath,
  homePath
) {
  const vals = [];

  for (const g of games) {
    const month =
      Number(
        String(g.date).slice(5, 7)
      );

    if (month > 4)
      continue;

    const x =
      v06Map.get(g.gameId);

    if (!x)
      continue;

    const a =
      r6Get(x, awayPath);

    const h =
      r6Get(x, homePath);

    if (a !== null)
      vals.push(a);

    if (h !== null)
      vals.push(h);
  }

  if (!vals.length)
    return null;

  return (
    vals.reduce(
      (sum, v) => sum + v,
      0
    ) / vals.length
  );
}

const R6_FEATURES = [
  {
    name: "STARTER_RECENT5_WHIP",
    kind: "opponent",
    awayPath:
      "starter.away.recent5.whip",
    homePath:
      "starter.home.recent5.whip",
    scale: 1.0,
    coefs: [
      -0.30,-0.20,-0.10,-0.05,
       0.05, 0.10, 0.20, 0.30
    ]
  },

  {
    name: "STARTER_RECENT5_KBB",
    kind: "opponentInverse",
    awayPath:
      "starter.away.recent5.kbb",
    homePath:
      "starter.home.recent5.kbb",
    scale: 0.20,
    coefs: [
      -0.30,-0.20,-0.10,-0.05,
       0.05, 0.10, 0.20, 0.30
    ]
  },

  {
    name: "STARTER_SEASON_WHIP",
    kind: "opponent",
    awayPath:
      "starter.away.whip",
    homePath:
      "starter.home.whip",
    scale: 1.0,
    coefs: [
      -0.30,-0.20,-0.10,-0.05,
       0.05, 0.10, 0.20, 0.30
    ]
  },

  {
    name: "STARTER_QS",
    kind: "opponentInverse",
    awayPath:
      "starter.away.qs",
    homePath:
      "starter.home.qs",
    scale: 0.10,
    coefs: [
      -0.30,-0.20,-0.10,-0.05,
       0.05, 0.10, 0.20, 0.30
    ]
  },

  {
    name: "REST_DAYS",
    kind: "own",
    awayPath:
      "awayTeamForm.restDays",
    homePath:
      "homeTeamForm.restDays",
    scale: 0.20,
    coefs: [
      -0.30,-0.20,-0.10,-0.05,
       0.05, 0.10, 0.20, 0.30
    ]
  },

  {
    name: "RECENT5_WINRATE",
    kind: "own",
    awayPath:
      "awayTeamForm.recent5.winRate",
    homePath:
      "homeTeamForm.recent5.winRate",
    scale: 1.0,
    coefs: [
      -0.30,-0.20,-0.10,-0.05,
       0.05, 0.10, 0.20, 0.30
    ]
  },

  {
    name: "RECENT10_WINRATE",
    kind: "own",
    awayPath:
      "awayTeamForm.recent10.winRate",
    homePath:
      "homeTeamForm.recent10.winRate",
    scale: 1.0,
    coefs: [
      -0.30,-0.20,-0.10,-0.05,
       0.05, 0.10, 0.20, 0.30
    ]
  }
];

for (const f of R6_FEATURES) {
  f.center =
    r6DiscoveryCenter(
      f.awayPath,
      f.homePath
    );
}

console.log();
console.log(
  "===== DISCOVERY-FROZEN CENTERS ====="
);

for (const f of R6_FEATURES) {
  console.log(
    f.name,
    "CENTER=" + f.center
  );
}

function r6Predictor(
  feature,
  coef
) {
  return g => {
    const base =
      R6_BASE(g);

    if (!base)
      return null;

    const x =
      v06Map.get(g.gameId);

    if (
      !x ||
      feature.center === null
    ) {
      return base;
    }

    const av =
      r6Get(
        x,
        feature.awayPath
      );

    const hv =
      r6Get(
        x,
        feature.homePath
      );

    if (
      av === null ||
      hv === null
    ) {
      return base;
    }

    let aSignal =
      (av - feature.center) *
      feature.scale;

    let hSignal =
      (hv - feature.center) *
      feature.scale;

    aSignal =
      clamp(
        aSignal,
        -3,
        3
      );

    hSignal =
      clamp(
        hSignal,
        -3,
        3
      );

    /*
      Inverse:
      higher KBB / QS = better starter,
      therefore opponent scoring should
      move in opposite direction.
    */
    if (
      feature.kind ===
      "opponentInverse"
    ) {
      aSignal *= -1;
      hSignal *= -1;
    }

    let away = base.away;
    let home = base.home;

    if (feature.kind === "own") {
      away +=
        aSignal * coef;

      home +=
        hSignal * coef;
    } else {
      /*
        away starter -> home offense
        home starter -> away offense
      */
      home +=
        aSignal * coef;

      away +=
        hSignal * coef;
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

const r6BaseD =
  evaluatePredictor(
    "DISCOVERY",
    R6_BASE
  );

const r6BaseI =
  evaluatePredictor(
    "INTERNAL",
    R6_BASE
  );

const r6BaseAvg =
  (
    r6BaseD.teamMAE +
    r6BaseI.teamMAE
  ) / 2;

console.log();
console.log(
  "===== ROUND6 BASE ====="
);

console.log(
  "D=" + r6BaseD.teamMAE,
  "I=" + r6BaseI.teamMAE,
  "AVG=" + r6BaseAvg
);

console.log(
  "EXPECTED ROUND5 BASE ≈ 2.477933"
);

const r6Rows = [];

for (const feature of R6_FEATURES) {
  if (feature.center === null) {
    console.log(
      "NO DATA:",
      feature.name
    );

    continue;
  }

  for (const coef of feature.coefs) {
    const predictor =
      r6Predictor(
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

    r6Rows.push({
      name: feature.name,
      coef,
      d,
      i,
      avg,

      dDelta:
        d.teamMAE -
        r6BaseD.teamMAE,

      iDelta:
        i.teamMAE -
        r6BaseI.teamMAE,

      avgDelta:
        avg -
        r6BaseAvg,

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
console.log(
  "===== ROUND 6 FAMILY BEST ====="
);

for (const feature of R6_FEATURES) {
  const rows =
    r6Rows
      .filter(
        r =>
          r.name ===
          feature.name
      )
      .sort(
        (a,b) =>
          a.avg - b.avg
      );

  if (!rows.length)
    continue;

  const r = rows[0];

  const robust =
    r.dDelta < 0 &&
    r.iDelta < 0 &&
    r.avgDelta < 0;

  console.log(
    robust
      ? "ROBUST"
      : "FAIL",

    r.name,

    "coef=" + r.coef,

    "AVG=" +
      r.avg.toFixed(6),

    "AVGΔ=" +
      r.avgDelta.toFixed(6),

    "DΔ=" +
      r.dDelta.toFixed(6),

    "IΔ=" +
      r.iDelta.toFixed(6),

    "TOTAL=" +
      r.total.toFixed(6),

    "DIFF=" +
      r.diff.toFixed(6),

    "W=" +
      (
        r.winner * 100
      ).toFixed(1) +
      "%"
  );
}

const robustRows =
  r6Rows
    .filter(
      r =>
        r.dDelta < 0 &&
        r.iDelta < 0 &&
        r.avgDelta < 0
    )
    .sort(
      (a,b) =>
        a.avg - b.avg
    );

console.log();
console.log(
  "===== ROUND 6 ROBUST RANKING ====="
);

if (!robustRows.length) {
  console.log(
    "NO ROBUST NEW FEATURE"
  );
} else {
  for (
    let i = 0;
    i <
      Math.min(
        robustRows.length,
        20
      );
    i++
  ) {
    const r =
      robustRows[i];

    console.log(
      `${i + 1}.`,
      r.name,
      "coef=" + r.coef,
      "AVG=" +
        r.avg.toFixed(6),
      "AVGΔ=" +
        r.avgDelta.toFixed(6),
      "DΔ=" +
        r.dDelta.toFixed(6),
      "IΔ=" +
        r.iDelta.toFixed(6),
      "TOTAL=" +
        r.total.toFixed(6),
      "DIFF=" +
        r.diff.toFixed(6),
      "W=" +
        (
          r.winner * 100
        ).toFixed(1) +
        "%"
    );
  }
}

console.log();

if (robustRows.length) {
  const best =
    robustRows[0];

  console.log(
    "BEST V0.7 ROUND6:",
    best.name,
    "coef=" + best.coef,
    "AVG=" + best.avg,
    "AVG_DELTA=" +
      best.avgDelta
  );
} else {
  console.log(
    "BEST V0.7 ROUND6: KEEP ROUND5 BASE"
  );
}

console.log(
  "ROUND6 FINAL/AUDIT: NOT EVALUATED"
);



console.log();
console.log("===== V0.7 ROUND 7 / ROBUST COMBINATION CHECK =====");

/*
  NO RETUNING.

  Frozen Round6 winner:
    RECENT5_WINRATE +0.30

  Test additions:
    REST_DAYS +0.30
    RECENT10_WINRATE +0.30

  Final/Audit NOT evaluated.
*/

const R7_R5 =
  R6_FEATURES.find(
    f => f.name === "RECENT5_WINRATE"
  );

const R7_REST =
  R6_FEATURES.find(
    f => f.name === "REST_DAYS"
  );

const R7_R10 =
  R6_FEATURES.find(
    f => f.name === "RECENT10_WINRATE"
  );

function r7Signal(
  x,
  feature,
  side
) {
  if (
    !x ||
    !feature ||
    feature.center === null
  ) return null;

  const path =
    side === "away"
      ? feature.awayPath
      : feature.homePath;

  const v =
    r6Get(x, path);

  if (v === null)
    return null;

  return clamp(
    (v - feature.center) *
      feature.scale,
    -3,
    3
  );
}

function r7Predictor(
  useRest,
  useR10
) {
  return g => {
    /*
      Start from frozen Round5 base:
      V03 + R5D + venue + bullpen + OPS
    */
    const base =
      R6_BASE(g);

    if (!base)
      return null;

    const x =
      v06Map.get(g.gameId);

    if (!x)
      return base;

    let away =
      base.away;

    let home =
      base.home;

    /*
      Frozen Round6 winner
      RECENT5_WINRATE +0.30
    */
    const r5a =
      r7Signal(
        x,
        R7_R5,
        "away"
      );

    const r5h =
      r7Signal(
        x,
        R7_R5,
        "home"
      );

    if (
      r5a !== null &&
      r5h !== null
    ) {
      away += r5a * 0.30;
      home += r5h * 0.30;
    }

    /*
      Optional REST_DAYS +0.30
    */
    if (useRest) {
      const a =
        r7Signal(
          x,
          R7_REST,
          "away"
        );

      const h =
        r7Signal(
          x,
          R7_REST,
          "home"
        );

      if (
        a !== null &&
        h !== null
      ) {
        away += a * 0.30;
        home += h * 0.30;
      }
    }

    /*
      Optional RECENT10_WINRATE +0.30
    */
    if (useR10) {
      const a =
        r7Signal(
          x,
          R7_R10,
          "away"
        );

      const h =
        r7Signal(
          x,
          R7_R10,
          "home"
        );

      if (
        a !== null &&
        h !== null
      ) {
        away += a * 0.30;
        home += h * 0.30;
      }
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

const R7_MODELS = [
  {
    name: "R5_WINRATE",
    predictor:
      r7Predictor(
        false,
        false
      )
  },
  {
    name:
      "R5_WINRATE + REST",
    predictor:
      r7Predictor(
        true,
        false
      )
  },
  {
    name:
      "R5_WINRATE + R10_WINRATE",
    predictor:
      r7Predictor(
        false,
        true
      )
  },
  {
    name:
      "R5_WINRATE + REST + R10_WINRATE",
    predictor:
      r7Predictor(
        true,
        true
      )
  }
];

const r7Rows = [];

for (const model of R7_MODELS) {
  const d =
    evaluatePredictor(
      "DISCOVERY",
      model.predictor
    );

  const i =
    evaluatePredictor(
      "INTERNAL",
      model.predictor
    );

  r7Rows.push({
    name: model.name,
    d,
    i,

    avg:
      (
        d.teamMAE +
        i.teamMAE
      ) / 2,

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

const r7Base =
  r7Rows.find(
    r =>
      r.name ===
      "R5_WINRATE"
  );

console.log();
console.log(
  "===== ROUND7 BASE REPRO ====="
);

console.log(
  "D=" +
    r7Base.d.teamMAE,

  "I=" +
    r7Base.i.teamMAE,

  "AVG=" +
    r7Base.avg
);

console.log(
  "ROUND6 TARGET=" +
    2.4724680867305495
);

console.log(
  "ROUND6 REPRO DELTA=" +
    (
      r7Base.avg -
      2.4724680867305495
    )
);

console.log();
console.log(
  "===== ROUND 7 RESULTS ====="
);

for (const r of r7Rows) {
  const dDelta =
    r.d.teamMAE -
    r7Base.d.teamMAE;

  const iDelta =
    r.i.teamMAE -
    r7Base.i.teamMAE;

  const avgDelta =
    r.avg -
    r7Base.avg;

  const robust =
    r.name ===
      "R5_WINRATE"
      ? true
      : (
          dDelta < 0 &&
          iDelta < 0 &&
          avgDelta < 0
        );

  console.log(
    robust
      ? "ROBUST"
      : "FAIL",

    r.name,

    "AVG=" +
      r.avg.toFixed(6),

    "AVGΔ=" +
      avgDelta.toFixed(6),

    "D=" +
      r.d.teamMAE.toFixed(6),

    "DΔ=" +
      dDelta.toFixed(6),

    "I=" +
      r.i.teamMAE.toFixed(6),

    "IΔ=" +
      iDelta.toFixed(6),

    "TOTAL=" +
      r.total.toFixed(6),

    "DIFF=" +
      r.diff.toFixed(6),

    "W=" +
      (
        r.winner * 100
      ).toFixed(1) +
      "%"
  );
}

const r7Robust =
  r7Rows
    .filter(r => {
      if (
        r.name ===
        "R5_WINRATE"
      ) return true;

      return (
        r.d.teamMAE <
          r7Base.d.teamMAE &&
        r.i.teamMAE <
          r7Base.i.teamMAE &&
        r.avg <
          r7Base.avg
      );
    })
    .sort(
      (a,b) =>
        a.avg - b.avg
    );

console.log();
console.log(
  "===== ROUND 7 ROBUST RANKING ====="
);

r7Robust.forEach(
  (r, idx) => {
    console.log(
      `${idx + 1}.`,
      r.name,
      "AVG=" +
        r.avg.toFixed(6),
      "D=" +
        r.d.teamMAE.toFixed(6),
      "I=" +
        r.i.teamMAE.toFixed(6),
      "TOTAL=" +
        r.total.toFixed(6),
      "DIFF=" +
        r.diff.toFixed(6),
      "W=" +
        (
          r.winner * 100
        ).toFixed(1) +
        "%"
    );
  }
);

const r7Best =
  r7Robust[0];

console.log();

console.log(
  "BEST V0.7 ROUND7:",
  r7Best.name,
  "AVG=" +
    r7Best.avg
);

console.log(
  "ROUND7 FINAL/AUDIT: NOT EVALUATED"
);



/*
==================================================
V0.7 ROUND 21
MARKET HIT-RATE DIAGNOSTIC

MODEL CHANGE: NO
TUNING: NO
FINAL/AUDIT: NOT EVALUATED

BASE:
  Frozen Round7
  R5_WINRATE + REST + R10_WINRATE

Purpose:
  현재 점수예측을 실제 시장 선택으로 변환했을 때

  ML
  HANDICAP
  TOTAL

  각각 어떤 구간에서 적중률이 높아지는지 확인.

Selection:
  ML:
    predicted score winner

  HANDICAP:
    predicted score + actual handicap line
    cover edge가 큰 쪽

  TOTAL:
    predicted total vs actual total line

Important:
  기존 row.confidence는
  현재 analyzer의 사전 confidence 참고값일 뿐
  R7 score model의 calibrated probability가 아니다.
==================================================
*/

console.log();
console.log(
  "=============================================="
);
console.log(
  "V0.7 ROUND 21 — MARKET HIT-RATE DIAGNOSTIC"
);
console.log(
  "=============================================="
);

const R21_MODEL =
  r7Predictor(
    true,
    true
  );

const R21_backtest =
  JSON.parse(
    fs.readFileSync(
      "data/kbo-backtest-2026-all-candidates-lineup-base.json",
      "utf8"
    )
  );

const R21_sourceRows =
  Array.isArray(
    R21_backtest?.results
  )
    ? R21_backtest.results
    : [];

const R21_rowsByGame =
  new Map();

for (
  const row
  of R21_sourceRows
) {
  if (
    !R21_rowsByGame.has(
      row.gameId
    )
  ) {
    R21_rowsByGame.set(
      row.gameId,
      []
    );
  }

  R21_rowsByGame
    .get(
      row.gameId
    )
    .push(
      row
    );
}


function R21_num(
  value
) {
  const n =
    Number(
      value
    );

  return Number.isFinite(n)
    ? n
    : null;
}


function R21_lineFromLabel(
  label
) {
  const match =
    String(
      label ?? ""
    ).match(
      /([+-]?\d+(?:\.\d+)?)\s*$/
    );

  if (!match) {
    return null;
  }

  const n =
    Number(
      match[1]
    );

  return Number.isFinite(n)
    ? n
    : null;
}


function R21_side(
  row,
  game
) {
  const label =
    String(
      row?.label ?? ""
    );

  if (
    row?.market === "TOTAL"
  ) {
    if (
      label.includes(
        "오버"
      )
    ) {
      return "OVER";
    }

    if (
      label.includes(
        "언더"
      )
    ) {
      return "UNDER";
    }

    return "UNKNOWN";
  }

  const awayTeam =
    String(
      game?.awayTeam ??
      row?.awayTeam ??
      ""
    );

  const homeTeam =
    String(
      game?.homeTeam ??
      row?.homeTeam ??
      ""
    );

  if (
    awayTeam &&
    label.includes(
      awayTeam
    )
  ) {
    return "AWAY";
  }

  if (
    homeTeam &&
    label.includes(
      homeTeam
    )
  ) {
    return "HOME";
  }

  return "UNKNOWN";
}


function R21_isSettled(
  row
) {
  return (
    row?.result === "WIN" ||
    row?.result === "LOSS"
  );
}


function R21_stat(
  rows
) {
  const settled =
    rows.filter(
      R21_isSettled
    );

  const n =
    settled.length;

  if (!n) {
    return {
      n: 0,
      wins: 0,
      hit: null,
      avgOdds: null,
      roi: null,
    };
  }

  const wins =
    settled.filter(
      x =>
        x.result === "WIN"
    ).length;

  const avgOdds =
    settled.reduce(
      (
        sum,
        x
      ) =>
        sum +
        (
          R21_num(
            x.odds
          ) ?? 0
        ),
      0
    ) / n;

  const returned =
    settled.reduce(
      (
        sum,
        x
      ) => {
        if (
          x.result !== "WIN"
        ) {
          return sum;
        }

        return (
          sum +
          (
            R21_num(
              x.odds
            ) ?? 0
          )
        );
      },
      0
    );

  return {
    n,
    wins,

    hit:
      wins /
      n,

    avgOdds,

    /*
      1 unit flat stake.
    */
    roi:
      (
        returned -
        n
      ) /
      n,
  };
}


function R21_fmtStat(
  name,
  rows
) {
  const s =
    R21_stat(
      rows
    );

  return (
    `${name} ` +
    `N=${s.n} ` +
    `HIT=${
      s.hit === null
        ? "NA"
        : (
            s.hit *
            100
          ).toFixed(1) +
          "%"
    } ` +
    `ODDS=${
      s.avgOdds === null
        ? "NA"
        : s.avgOdds.toFixed(3)
    } ` +
    `ROI=${
      s.roi === null
        ? "NA"
        : (
            s.roi *
            100
          ).toFixed(1) +
          "%"
    }`
  );
}


function R21_selectML(
  game,
  pred,
  rows
) {
  if (
    pred.away ===
    pred.home
  ) {
    return null;
  }

  const side =
    pred.away >
    pred.home
      ? "AWAY"
      : "HOME";

  const candidates =
    rows.filter(
      row =>
        row.market === "ML" &&
        R21_isSettled(
          row
        )
    );

  const selected =
    candidates.find(
      row =>
        R21_side(
          row,
          game
        ) === side
    );

  if (!selected) {
    return null;
  }

  return {
    ...selected,

    r21Market:
      "ML",

    r21Side:
      side,

    r21ScoreEdge:
      Math.abs(
        pred.away -
        pred.home
      ),

    r21PredAway:
      pred.away,

    r21PredHome:
      pred.home,
  };
}


function R21_selectHandicap(
  game,
  pred,
  rows
) {
  const candidates =
    rows
      .filter(
        row =>
          row.market ===
            "HANDICAP" &&
          R21_isSettled(
            row
          )
      )
      .map(
        row => {
          const side =
            R21_side(
              row,
              game
            );

          const line =
            R21_lineFromLabel(
              row.label
            );

          if (
            line === null ||
            (
              side !== "AWAY" &&
              side !== "HOME"
            )
          ) {
            return null;
          }

          const rawMargin =
            side === "AWAY"
              ? pred.away -
                pred.home
              : pred.home -
                pred.away;

          const coverEdge =
            rawMargin +
            line;

          return {
            ...row,

            r21Market:
              "HANDICAP",

            r21Side:
              side,

            r21Line:
              line,

            r21CoverEdge:
              coverEdge,

            r21ScoreEdge:
              Math.abs(
                coverEdge
              ),

            r21PredAway:
              pred.away,

            r21PredHome:
              pred.home,
          };
        }
      )
      .filter(Boolean);

  if (
    candidates.length === 0
  ) {
    return null;
  }

  candidates.sort(
    (
      a,
      b
    ) =>
      b.r21CoverEdge -
      a.r21CoverEdge
  );

  /*
    예측상 실제로 cover 우위인 쪽만.
  */
  if (
    candidates[0]
      .r21CoverEdge <= 0
  ) {
    return null;
  }

  return candidates[0];
}


function R21_selectTotal(
  game,
  pred,
  rows
) {
  const candidates =
    rows.filter(
      row =>
        row.market === "TOTAL" &&
        R21_isSettled(
          row
        )
    );

  if (
    candidates.length === 0
  ) {
    return null;
  }

  const withLine =
    candidates
      .map(
        row => {
          const line =
            R21_num(
              row.totalLine
            ) ??
            R21_lineFromLabel(
              row.label
            );

          if (
            line === null
          ) {
            return null;
          }

          return {
            row,
            line,
          };
        }
      )
      .filter(Boolean);

  if (
    withLine.length === 0
  ) {
    return null;
  }

  const totalLine =
    withLine[0]
      .line;

  const predTotal =
    pred.away +
    pred.home;

  if (
    Math.abs(
      predTotal -
      totalLine
    ) <
    1e-9
  ) {
    return null;
  }

  const targetSide =
    predTotal >
    totalLine
      ? "OVER"
      : "UNDER";

  const selected =
    withLine.find(
      x =>
        R21_side(
          x.row,
          game
        ) ===
        targetSide
    );

  if (!selected) {
    return null;
  }

  return {
    ...selected.row,

    r21Market:
      "TOTAL",

    r21Side:
      targetSide,

    r21Line:
      totalLine,

    r21PredTotal:
      predTotal,

    r21TotalEdge:
      predTotal -
      totalLine,

    r21ScoreEdge:
      Math.abs(
        predTotal -
        totalLine
      ),

    r21PredAway:
      pred.away,

    r21PredHome:
      pred.home,
  };
}


const R21_selected =
  [];

for (
  const game
  of games
) {
  const split =
    splitOf(
      game
    );

  /*
    Final/Audit 절대 열지 않음.
  */
  if (
    split !== "DISCOVERY" &&
    split !== "INTERNAL"
  ) {
    continue;
  }

  const pred =
    R21_MODEL(
      game
    );

  if (
    !pred ||
    !Number.isFinite(
      pred.away
    ) ||
    !Number.isFinite(
      pred.home
    )
  ) {
    continue;
  }

  const marketRows =
    R21_rowsByGame.get(
      game.gameId
    ) ?? [];

  const ml =
    R21_selectML(
      game,
      pred,
      marketRows
    );

  const handicap =
    R21_selectHandicap(
      game,
      pred,
      marketRows
    );

  const total =
    R21_selectTotal(
      game,
      pred,
      marketRows
    );

  for (
    const selected
    of [
      ml,
      handicap,
      total,
    ]
  ) {
    if (!selected) {
      continue;
    }

    R21_selected.push({
      ...selected,

      r21Split:
        split,

      r21Date:
        game.date,

      r21GameId:
        game.gameId,
    });
  }
}


function R21_rows(
  split,
  market = null
) {
  return R21_selected.filter(
    row =>
      row.r21Split === split &&
      (
        market === null ||
        row.r21Market ===
          market
      )
  );
}


function R21_printBase(
  split
) {
  console.log();
  console.log(
    `===== ROUND21 ${split} BASE =====`
  );

  for (
    const market
    of [
      "ML",
      "HANDICAP",
      "TOTAL",
    ]
  ) {
    console.log(
      R21_fmtStat(
        market,
        R21_rows(
          split,
          market
        )
      )
    );
  }
}


function R21_printConfidence(
  split,
  market
) {
  const baseRows =
    R21_rows(
      split,
      market
    );

  console.log();
  console.log(
    `===== ${split} ${market} / CONFIDENCE =====`
  );

  for (
    const threshold
    of [
      0.50,
      0.55,
      0.60,
      0.65,
      0.70,
    ]
  ) {
    console.log(
      R21_fmtStat(
        `CONF>=${(
          threshold *
          100
        ).toFixed(0)}%`,
        baseRows.filter(
          row =>
            (
              R21_num(
                row.confidence
              ) ?? 0
            ) >=
            threshold
        )
      )
    );
  }
}


function R21_printEdge(
  split,
  market
) {
  const baseRows =
    R21_rows(
      split,
      market
    );

  console.log();
  console.log(
    `===== ${split} ${market} / SCORE EDGE =====`
  );

  const thresholds =
    market === "ML"
      ? [
          0.25,
          0.50,
          1.00,
          1.50,
          2.00,
          2.50,
        ]
      : [
          0.25,
          0.50,
          1.00,
          1.50,
          2.00,
          2.50,
        ];

  for (
    const threshold
    of thresholds
  ) {
    console.log(
      R21_fmtStat(
        `EDGE>=${threshold.toFixed(2)}`,
        baseRows.filter(
          row =>
            (
              R21_num(
                row.r21ScoreEdge
              ) ?? 0
            ) >= threshold
        )
      )
    );
  }
}


function R21_printOdds(
  split,
  market
) {
  const baseRows =
    R21_rows(
      split,
      market
    );

  console.log();
  console.log(
    `===== ${split} ${market} / ODDS =====`
  );

  const bands = [
    [
      "1.00-1.49",
      1.00,
      1.50,
    ],
    [
      "1.50-1.69",
      1.50,
      1.70,
    ],
    [
      "1.70-1.89",
      1.70,
      1.90,
    ],
    [
      "1.90-2.19",
      1.90,
      2.20,
    ],
    [
      "2.20+",
      2.20,
      Infinity,
    ],
  ];

  for (
    const [
      name,
      lo,
      hi,
    ]
    of bands
  ) {
    console.log(
      R21_fmtStat(
        name,
        baseRows.filter(
          row => {
            const odds =
              R21_num(
                row.odds
              );

            return (
              odds !== null &&
              odds >= lo &&
              odds < hi
            );
          }
        )
      )
    );
  }
}


function R21_printCombined(
  split,
  market
) {
  const baseRows =
    R21_rows(
      split,
      market
    );

  console.log();
  console.log(
    `===== ${split} ${market} / EDGE + CONF =====`
  );

  const configs = [
    [
      "E0.50_C55",
      0.50,
      0.55,
    ],
    [
      "E1.00_C55",
      1.00,
      0.55,
    ],
    [
      "E1.00_C60",
      1.00,
      0.60,
    ],
    [
      "E1.50_C55",
      1.50,
      0.55,
    ],
    [
      "E1.50_C60",
      1.50,
      0.60,
    ],
    [
      "E2.00_C55",
      2.00,
      0.55,
    ],
    [
      "E2.00_C60",
      2.00,
      0.60,
    ],
  ];

  for (
    const [
      name,
      edge,
      confidence,
    ]
    of configs
  ) {
    console.log(
      R21_fmtStat(
        name,
        baseRows.filter(
          row =>
            (
              R21_num(
                row.r21ScoreEdge
              ) ?? 0
            ) >= edge &&
            (
              R21_num(
                row.confidence
              ) ?? 0
            ) >= confidence
        )
      )
    );
  }
}


for (
  const split
  of [
    "DISCOVERY",
    "INTERNAL",
  ]
) {
  R21_printBase(
    split
  );

  for (
    const market
    of [
      "ML",
      "HANDICAP",
      "TOTAL",
    ]
  ) {
    R21_printConfidence(
      split,
      market
    );

    R21_printEdge(
      split,
      market
    );

    R21_printCombined(
      split,
      market
    );

    R21_printOdds(
      split,
      market
    );
  }
}


console.log();
console.log(
  "===== ROUND21 COVERAGE ====="
);

for (
  const split
  of [
    "DISCOVERY",
    "INTERNAL",
  ]
) {
  const all =
    R21_rows(
      split
    );

  console.log(
    split,
    {
      all:
        all.length,

      ml:
        all.filter(
          x =>
            x.r21Market === "ML"
        ).length,

      handicap:
        all.filter(
          x =>
            x.r21Market ===
              "HANDICAP"
        ).length,

      total:
        all.filter(
          x =>
            x.r21Market === "TOTAL"
        ).length,
    }
  );
}


console.log();
console.log(
  "ROUND21 MODEL CHANGE: NO"
);

console.log(
  "ROUND21 PURPOSE: PICK FILTER DISCOVERY"
);

console.log(
  "ROUND21 FINAL/AUDIT: NOT EVALUATED"
);

fs.writeFileSync(
  "data/kbo-score-v07-round21.json",
  JSON.stringify(
    {
      generatedAt:
        new Date()
          .toISOString(),

      model:
        "V0.7 ROUND7",

      note:
        "Market hit-rate diagnostic only. No model change. Final not evaluated.",

      selected:
        R21_selected,
    },
    null,
    2
  )
);


/*
==================================================
V0.7 ROUND 22
PICK FILTER STABILITY

NO MODEL CHANGE.
NO NEW THRESHOLD SEARCH.
NO FINAL/AUDIT.

Fixed candidates from Round21:

ML:
  EDGE >= 1.00
  EDGE >= 1.50

HANDICAP:
  EDGE >= 1.50
  EDGE >= 2.00
  EDGE >= 2.50

TOTAL:
  EDGE >= 1.00
  EDGE >= 2.50

Purpose:
  monthly / chronological stability only.
==================================================
*/

console.log();
console.log(
  "=============================================="
);
console.log(
  "V0.7 ROUND 22 — PICK FILTER STABILITY"
);
console.log(
  "=============================================="
);


const R22_CONFIGS = [
  {
    name:
      "ML_EDGE_1.00",
    market:
      "ML",
    edge:
      1.00,
  },
  {
    name:
      "ML_EDGE_1.50",
    market:
      "ML",
    edge:
      1.50,
  },

  {
    name:
      "HCAP_EDGE_1.50",
    market:
      "HANDICAP",
    edge:
      1.50,
  },
  {
    name:
      "HCAP_EDGE_2.00",
    market:
      "HANDICAP",
    edge:
      2.00,
  },
  {
    name:
      "HCAP_EDGE_2.50",
    market:
      "HANDICAP",
    edge:
      2.50,
  },

  {
    name:
      "TOTAL_EDGE_1.00",
    market:
      "TOTAL",
    edge:
      1.00,
  },
  {
    name:
      "TOTAL_EDGE_2.50",
    market:
      "TOTAL",
    edge:
      2.50,
  },
];


function R22_filter(
  rows,
  config
) {
  return rows.filter(
    row =>
      row.r21Market ===
        config.market &&
      (
        Number(
          row.r21ScoreEdge
        ) || 0
      ) >=
        config.edge
  );
}


function R22_month(
  row
) {
  return String(
    row.r21Date ??
    row.date ??
    ""
  ).slice(
    0,
    7
  );
}


function R22_stat(
  rows
) {
  const settled =
    rows.filter(
      row =>
        row.result === "WIN" ||
        row.result === "LOSS"
    );

  const n =
    settled.length;

  if (!n) {
    return {
      n: 0,
      hit: null,
      odds: null,
      roi: null,
    };
  }

  const wins =
    settled.filter(
      row =>
        row.result === "WIN"
    ).length;

  const odds =
    settled.reduce(
      (
        sum,
        row
      ) =>
        sum +
        (
          Number(
            row.odds
          ) || 0
        ),
      0
    ) / n;

  const returned =
    settled.reduce(
      (
        sum,
        row
      ) =>
        sum +
        (
          row.result === "WIN"
            ? (
                Number(
                  row.odds
                ) || 0
              )
            : 0
        ),
      0
    );

  return {
    n,

    hit:
      wins /
      n,

    odds,

    roi:
      (
        returned -
        n
      ) /
      n,
  };
}


function R22_print(
  name,
  rows
) {
  const x =
    R22_stat(
      rows
    );

  console.log(
    `${name} ` +
    `N=${x.n} ` +
    `HIT=${
      x.hit === null
        ? "NA"
        : (
            x.hit *
            100
          ).toFixed(1) +
          "%"
    } ` +
    `ODDS=${
      x.odds === null
        ? "NA"
        : x.odds.toFixed(3)
    } ` +
    `ROI=${
      x.roi === null
        ? "NA"
        : (
            x.roi *
            100
          ).toFixed(1) +
          "%"
    }`
  );
}


console.log();
console.log(
  "===== ROUND22 DISCOVERY / INTERNAL ====="
);

for (
  const config
  of R22_CONFIGS
) {
  const discovery =
    R22_filter(
      R21_selected.filter(
        row =>
          row.r21Split ===
            "DISCOVERY"
      ),
      config
    );

  const internal =
    R22_filter(
      R21_selected.filter(
        row =>
          row.r21Split ===
            "INTERNAL"
      ),
      config
    );

  R22_print(
    `${config.name} D`,
    discovery
  );

  R22_print(
    `${config.name} I`,
    internal
  );

  console.log();
}


console.log();
console.log(
  "===== ROUND22 MONTHLY MAR-JUN ====="
);

const R22_DI =
  R21_selected.filter(
    row =>
      row.r21Split ===
        "DISCOVERY" ||
      row.r21Split ===
        "INTERNAL"
  );

for (
  const config
  of R22_CONFIGS
) {
  console.log();
  console.log(
    `--- ${config.name} ---`
  );

  const selected =
    R22_filter(
      R22_DI,
      config
    );

  for (
    const month
    of [
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]
  ) {
    R22_print(
      month,
      selected.filter(
        row =>
          R22_month(
            row
          ) === month
      )
    );
  }
}


console.log();
console.log(
  "===== ROUND22 TWO-MONTH WINDOWS ====="
);

const windows = [
  [
    "MAR_APR",
    [
      "2026-03",
      "2026-04",
    ],
  ],
  [
    "APR_MAY",
    [
      "2026-04",
      "2026-05",
    ],
  ],
  [
    "MAY_JUN",
    [
      "2026-05",
      "2026-06",
    ],
  ],
];


for (
  const config
  of R22_CONFIGS
) {
  console.log();
  console.log(
    `--- ${config.name} ---`
  );

  const selected =
    R22_filter(
      R22_DI,
      config
    );

  for (
    const [
      windowName,
      months,
    ]
    of windows
  ) {
    R22_print(
      windowName,
      selected.filter(
        row =>
          months.includes(
            R22_month(
              row
            )
          )
      )
    );
  }
}


console.log();
console.log(
  "===== ROUND22 MARKET SUMMARY ====="
);

/*
  Hit-rate 목적 기준 참고:
  - 65% 이상
  - 월별 극단 붕괴 여부
  - 표본 수
  - ROI는 보조 확인

  여기서 자동 freeze하지 않는다.
*/

for (
  const config
  of R22_CONFIGS
) {
  const selected =
    R22_filter(
      R22_DI,
      config
    );

  R22_print(
    config.name,
    selected
  );
}


console.log();
console.log(
  "ROUND22 MODEL CHANGE: NO"
);

console.log(
  "ROUND22 FILTER CHANGE: NO"
);

console.log(
  "ROUND22 FINAL/AUDIT: NOT EVALUATED"
);


/*
==================================================
V0.7 ROUND 23
FILTER SIDE / DIRECTION STABILITY

NO MODEL CHANGE.
NO THRESHOLD TUNING.
NO FINAL/AUDIT.

Fixed filters:

ML:
  EDGE >= 1.00

HANDICAP:
  EDGE >= 2.50

TOTAL:
  EDGE >= 2.50
==================================================
*/

console.log();
console.log(
  "=============================================="
);
console.log(
  "V0.7 ROUND 23 — SIDE / DIRECTION STABILITY"
);
console.log(
  "=============================================="
);


function R23_stat(
  rows
) {
  const settled =
    rows.filter(
      row =>
        row.result === "WIN" ||
        row.result === "LOSS"
    );

  const n =
    settled.length;

  if (!n) {
    return {
      n: 0,
      hit: null,
      odds: null,
      roi: null,
    };
  }

  const wins =
    settled.filter(
      row =>
        row.result === "WIN"
    ).length;

  const avgOdds =
    settled.reduce(
      (sum, row) =>
        sum +
        (
          Number(
            row.odds
          ) || 0
        ),
      0
    ) / n;

  const returned =
    settled.reduce(
      (sum, row) =>
        sum +
        (
          row.result === "WIN"
            ? (
                Number(
                  row.odds
                ) || 0
              )
            : 0
        ),
      0
    );

  return {
    n,
    hit:
      wins / n,
    odds:
      avgOdds,
    roi:
      (
        returned -
        n
      ) / n,
  };
}


function R23_print(
  name,
  rows
) {
  const x =
    R23_stat(
      rows
    );

  console.log(
    `${name} ` +
    `N=${x.n} ` +
    `HIT=${
      x.hit === null
        ? "NA"
        : (
            x.hit *
            100
          ).toFixed(1) +
          "%"
    } ` +
    `ODDS=${
      x.odds === null
        ? "NA"
        : x.odds.toFixed(3)
    } ` +
    `ROI=${
      x.roi === null
        ? "NA"
        : (
            x.roi *
            100
          ).toFixed(1) +
          "%"
    }`
  );
}


const R23_DI =
  R21_selected.filter(
    row =>
      row.r21Split ===
        "DISCOVERY" ||
      row.r21Split ===
        "INTERNAL"
  );


const R23_ML =
  R23_DI.filter(
    row =>
      row.r21Market === "ML" &&
      (
        Number(
          row.r21ScoreEdge
        ) || 0
      ) >= 1.00
  );


const R23_HCAP =
  R23_DI.filter(
    row =>
      row.r21Market ===
        "HANDICAP" &&
      (
        Number(
          row.r21ScoreEdge
        ) || 0
      ) >= 2.50
  );


const R23_TOTAL =
  R23_DI.filter(
    row =>
      row.r21Market ===
        "TOTAL" &&
      (
        Number(
          row.r21ScoreEdge
        ) || 0
      ) >= 2.50
  );


console.log();
console.log(
  "===== ROUND23 ML HOME / AWAY ====="
);

R23_print(
  "ML HOME",
  R23_ML.filter(
    row =>
      row.r21Side === "HOME"
  )
);

R23_print(
  "ML AWAY",
  R23_ML.filter(
    row =>
      row.r21Side === "AWAY"
  )
);


console.log();
console.log(
  "===== ROUND23 HANDICAP HOME / AWAY ====="
);

R23_print(
  "HCAP HOME",
  R23_HCAP.filter(
    row =>
      row.r21Side === "HOME"
  )
);

R23_print(
  "HCAP AWAY",
  R23_HCAP.filter(
    row =>
      row.r21Side === "AWAY"
  )
);


console.log();
console.log(
  "===== ROUND23 HANDICAP PLUS / MINUS ====="
);

R23_print(
  "HCAP PLUS",
  R23_HCAP.filter(
    row =>
      Number(
        row.r21Line
      ) > 0
  )
);

R23_print(
  "HCAP MINUS",
  R23_HCAP.filter(
    row =>
      Number(
        row.r21Line
      ) < 0
  )
);

R23_print(
  "HCAP ZERO",
  R23_HCAP.filter(
    row =>
      Number(
        row.r21Line
      ) === 0
  )
);


console.log();
console.log(
  "===== ROUND23 HANDICAP LINE ====="
);

const R23_lines =
  [
    ...new Set(
      R23_HCAP
        .map(
          row =>
            Number(
              row.r21Line
            )
        )
        .filter(
          Number.isFinite
        )
    ),
  ].sort(
    (a, b) =>
      a - b
  );

for (
  const line
  of R23_lines
) {
  R23_print(
    `LINE ${line}`,
    R23_HCAP.filter(
      row =>
        Number(
          row.r21Line
        ) === line
    )
  );
}


console.log();
console.log(
  "===== ROUND23 TOTAL OVER / UNDER ====="
);

R23_print(
  "TOTAL OVER",
  R23_TOTAL.filter(
    row =>
      row.r21Side === "OVER"
  )
);

R23_print(
  "TOTAL UNDER",
  R23_TOTAL.filter(
    row =>
      row.r21Side === "UNDER"
  )
);


console.log();
console.log(
  "===== ROUND23 SPLIT CHECK ====="
);

for (
  const split
  of [
    "DISCOVERY",
    "INTERNAL",
  ]
) {
  console.log();
  console.log(
    `--- ${split} ---`
  );

  const source =
    R21_selected.filter(
      row =>
        row.r21Split === split
    );

  const ml =
    source.filter(
      row =>
        row.r21Market === "ML" &&
        (
          Number(
            row.r21ScoreEdge
          ) || 0
        ) >= 1.00
    );

  const hc =
    source.filter(
      row =>
        row.r21Market ===
          "HANDICAP" &&
        (
          Number(
            row.r21ScoreEdge
          ) || 0
        ) >= 2.50
    );

  const total =
    source.filter(
      row =>
        row.r21Market ===
          "TOTAL" &&
        (
          Number(
            row.r21ScoreEdge
          ) || 0
        ) >= 2.50
    );

  R23_print(
    "ML HOME",
    ml.filter(
      x =>
        x.r21Side === "HOME"
    )
  );

  R23_print(
    "ML AWAY",
    ml.filter(
      x =>
        x.r21Side === "AWAY"
    )
  );

  R23_print(
    "HCAP PLUS",
    hc.filter(
      x =>
        Number(
          x.r21Line
        ) > 0
    )
  );

  R23_print(
    "HCAP MINUS",
    hc.filter(
      x =>
        Number(
          x.r21Line
        ) < 0
    )
  );

  R23_print(
    "TOTAL OVER",
    total.filter(
      x =>
        x.r21Side === "OVER"
    )
  );

  R23_print(
    "TOTAL UNDER",
    total.filter(
      x =>
        x.r21Side === "UNDER"
    )
  );
}


console.log();
console.log(
  "===== ROUND23 FIXED FILTER SUMMARY ====="
);

R23_print(
  "ML EDGE>=1.00",
  R23_ML
);

R23_print(
  "HCAP EDGE>=2.50",
  R23_HCAP
);

R23_print(
  "TOTAL EDGE>=2.50",
  R23_TOTAL
);


console.log();
console.log(
  "ROUND23 MODEL CHANGE: NO"
);

console.log(
  "ROUND23 FILTER CHANGE: NO"
);

console.log(
  "ROUND23 FINAL/AUDIT: NOT EVALUATED"
);


/*
==================================================
V0.7 ROUND 24
PLUS 2.5 DEFENSIVE PICK STRUCTURE

NO MODEL CHANGE.
NO FINAL/AUDIT.

Round23 finding:
  HCAP EDGE >= 2.50
  = all PLUS 2.5
  = 55 bets
  = 81.8% hit

Now inspect:
  +2.5 team predicted raw margin

  >= 0.0
  >= 0.5
  >= 1.0
  >= 1.5
  >= 2.0

Also:
  monthly
  Discovery/Internal
  ML result of same selected team

Purpose:
  understand whether defensive pick
  is genuinely score-model supported.
==================================================
*/

console.log();
console.log(
  "=============================================="
);
console.log(
  "V0.7 ROUND 24 — PLUS 2.5 DEFENSIVE STRUCTURE"
);
console.log(
  "=============================================="
);


function R24_num(
  value
) {
  const n =
    Number(
      value
    );

  return Number.isFinite(n)
    ? n
    : null;
}


function R24_stat(
  rows
) {
  const settled =
    rows.filter(
      row =>
        row.result === "WIN" ||
        row.result === "LOSS"
    );

  const n =
    settled.length;

  if (!n) {
    return {
      n: 0,
      hit: null,
      odds: null,
      roi: null,
    };
  }

  const wins =
    settled.filter(
      row =>
        row.result === "WIN"
    ).length;

  const avgOdds =
    settled.reduce(
      (sum, row) =>
        sum +
        (
          R24_num(
            row.odds
          ) ?? 0
        ),
      0
    ) / n;

  const returned =
    settled.reduce(
      (sum, row) =>
        sum +
        (
          row.result === "WIN"
            ? (
                R24_num(
                  row.odds
                ) ?? 0
              )
            : 0
        ),
      0
    );

  return {
    n,
    hit:
      wins / n,
    odds:
      avgOdds,
    roi:
      (
        returned -
        n
      ) / n,
  };
}


function R24_print(
  name,
  rows
) {
  const x =
    R24_stat(
      rows
    );

  console.log(
    `${name} ` +
    `N=${x.n} ` +
    `HIT=${
      x.hit === null
        ? "NA"
        : (
            x.hit *
            100
          ).toFixed(1) +
          "%"
    } ` +
    `ODDS=${
      x.odds === null
        ? "NA"
        : x.odds.toFixed(3)
    } ` +
    `ROI=${
      x.roi === null
        ? "NA"
        : (
            x.roi *
            100
          ).toFixed(1) +
          "%"
    }`
  );
}


const R24_HCAP =
  R21_selected.filter(
    row =>
      (
        row.r21Split ===
          "DISCOVERY" ||
        row.r21Split ===
          "INTERNAL"
      ) &&
      row.r21Market ===
        "HANDICAP" &&
      Number(
        row.r21Line
      ) === 2.5
  )
  .map(
    row => {
      /*
        coverEdge =
          predicted raw margin
          + handicap line

        therefore:
          rawMargin =
          coverEdge - 2.5
      */
      const rawMargin =
        (
          R24_num(
            row.r21CoverEdge
          ) ?? 0
        ) - 2.5;

      return {
        ...row,
        r24RawMargin:
          rawMargin,
      };
    }
  );


console.log();
console.log(
  "===== ROUND24 ALL PLUS 2.5 ====="
);

R24_print(
  "ALL +2.5",
  R24_HCAP
);


console.log();
console.log(
  "===== ROUND24 RAW MODEL MARGIN ====="
);

for (
  const threshold
  of [
    -2.0,
    -1.5,
    -1.0,
    -0.5,
    0.0,
    0.5,
    1.0,
    1.5,
    2.0,
  ]
) {
  R24_print(
    `MODEL_MARGIN>=${threshold.toFixed(1)}`,
    R24_HCAP.filter(
      row =>
        row.r24RawMargin >=
          threshold
    )
  );
}


console.log();
console.log(
  "===== ROUND24 FROZEN SAFE FILTER ====="
);

/*
  This is exactly Round23 fixed candidate:
  cover EDGE >= 2.5
  on +2.5 side

  Equivalent:
  raw predicted margin >= 0
*/

const R24_SAFE =
  R24_HCAP.filter(
    row =>
      row.r24RawMargin >= 0
  );

R24_print(
  "SAFE +2.5 / MODEL>=0",
  R24_SAFE
);


console.log();
console.log(
  "===== ROUND24 DISCOVERY / INTERNAL ====="
);

for (
  const split
  of [
    "DISCOVERY",
    "INTERNAL",
  ]
) {
  console.log();
  console.log(
    `--- ${split} ---`
  );

  const source =
    R24_HCAP.filter(
      row =>
        row.r21Split === split
    );

  for (
    const threshold
    of [
      0.0,
      0.5,
      1.0,
      1.5,
      2.0,
    ]
  ) {
    R24_print(
      `MARGIN>=${threshold.toFixed(1)}`,
      source.filter(
        row =>
          row.r24RawMargin >=
            threshold
      )
    );
  }
}


console.log();
console.log(
  "===== ROUND24 MONTHLY SAFE FILTER ====="
);

for (
  const month
  of [
    "2026-03",
    "2026-04",
    "2026-05",
    "2026-06",
  ]
) {
  R24_print(
    month,
    R24_SAFE.filter(
      row =>
        String(
          row.r21Date ??
          row.date ??
          ""
        ).slice(
          0,
          7
        ) === month
    )
  );
}


/*
==================================================
SAME TEAM ML RESULT

For each safe +2.5 pick,
find the same team's ML row.

This tells us:

  +2.5 hit rate
  vs
  outright win rate

If outright win rate itself is strong,
the +2.5 defensive structure is logical.
==================================================
*/

const R24_sameTeamMl =
  [];

for (
  const hcap
  of R24_SAFE
) {
  const rows =
    R21_rowsByGame.get(
      hcap.gameId
    ) ?? [];

  const matching =
    rows.find(
      row =>
        row.market === "ML" &&
        R21_side(
          row,
          {
            awayTeam:
              hcap.awayTeam,
            homeTeam:
              hcap.homeTeam,
          }
        ) ===
          hcap.r21Side &&
        (
          row.result === "WIN" ||
          row.result === "LOSS"
        )
    );

  if (
    matching
  ) {
    R24_sameTeamMl.push({
      ...matching,

      r21Split:
        hcap.r21Split,

      r24RawMargin:
        hcap.r24RawMargin,
    });
  }
}


console.log();
console.log(
  "===== ROUND24 SAME TEAM ML ====="
);

R24_print(
  "SAFE TEAM ML",
  R24_sameTeamMl
);


for (
  const split
  of [
    "DISCOVERY",
    "INTERNAL",
  ]
) {
  R24_print(
    `SAFE TEAM ML ${split}`,
    R24_sameTeamMl.filter(
      row =>
        row.r21Split ===
          split
    )
  );
}


console.log();
console.log(
  "===== ROUND24 HOME / AWAY ====="
);

R24_print(
  "SAFE HOME",
  R24_SAFE.filter(
    row =>
      row.r21Side ===
        "HOME"
  )
);

R24_print(
  "SAFE AWAY",
  R24_SAFE.filter(
    row =>
      row.r21Side ===
        "AWAY"
  )
);


console.log();
console.log(
  "===== ROUND24 DAILY AVAILABILITY ====="
);

const R24_days =
  new Map();

for (
  const row
  of R24_SAFE
) {
  const date =
    String(
      row.r21Date ??
      row.date ??
      ""
    ).slice(
      0,
      10
    );

  if (!date) {
    continue;
  }

  R24_days.set(
    date,
    (
      R24_days.get(
        date
      ) ?? 0
    ) + 1
  );
}


const R24_dayCounts =
  [
    ...R24_days.values()
  ];

console.log(
  "DAYS:",
  R24_days.size
);

console.log(
  "PICKS:",
  R24_SAFE.length
);

console.log(
  "AVG PICKS/DAY:",
  R24_days.size
    ? (
        R24_SAFE.length /
        R24_days.size
      ).toFixed(2)
    : "NA"
);

for (
  const n
  of [
    1,
    2,
    3,
    4,
    5,
  ]
) {
  console.log(
    `DAYS WITH >=${n}:`,
    R24_dayCounts.filter(
      x =>
        x >= n
    ).length
  );
}


console.log();
console.log(
  "ROUND24 MODEL CHANGE: NO"
);

console.log(
  "ROUND24 FINAL/AUDIT: NOT EVALUATED"
);


/*
==================================================
V0.7 ROUND 25
2~5 LEG COMBINATION DIAGNOSTIC

NO MODEL CHANGE.
NO FILTER CHANGE.
NO FINAL/AUDIT.

Fixed candidate pools:

D:
  HANDICAP +2.5
  model raw margin >= 0

M:
  ML score EDGE >= 1.00

T:
  TOTAL score EDGE >= 2.50

Rules:
  - distinct games only
  - 2 / 3 / 4 / 5 legs
  - enumerate all valid combinations
  - flat 1 unit per combination
  - Discovery / Internal separated

Important:
  repeated combinations from same day are
  not statistically independent.
  This is structure discovery only.
==================================================
*/

console.log();
console.log(
  "=============================================="
);
console.log(
  "V0.7 ROUND 25 — 2~5 LEG COMBINATION DIAGNOSTIC"
);
console.log(
  "=============================================="
);


function R25_num(
  value
) {
  const n =
    Number(
      value
    );

  return Number.isFinite(n)
    ? n
    : null;
}


function R25_date(
  row
) {
  return String(
    row.r21Date ??
    row.date ??
    ""
  ).slice(
    0,
    10
  );
}


function R25_gameId(
  row
) {
  return String(
    row.r21GameId ??
    row.gameId ??
    ""
  );
}


/*
==================================================
FIXED CANDIDATES
==================================================
*/

const R25_candidates =
  [];


/*
  D = SAFE +2.5
*/
for (
  const row
  of R24_SAFE
) {
  R25_candidates.push({
    ...row,

    r25Type:
      "D",

    r25Edge:
      row.r24RawMargin,

    r25Date:
      R25_date(
        row
      ),

    r25GameId:
      R25_gameId(
        row
      ),
  });
}


/*
  M = ML EDGE >= 1.0
*/
for (
  const row
  of R21_selected
) {
  if (
    (
      row.r21Split !==
        "DISCOVERY" &&
      row.r21Split !==
        "INTERNAL"
    ) ||
    row.r21Market !==
      "ML" ||
    (
      R25_num(
        row.r21ScoreEdge
      ) ?? 0
    ) < 1.0
  ) {
    continue;
  }

  R25_candidates.push({
    ...row,

    r25Type:
      "M",

    r25Edge:
      row.r21ScoreEdge,

    r25Date:
      R25_date(
        row
      ),

    r25GameId:
      R25_gameId(
        row
      ),
  });
}


/*
  T = TOTAL EDGE >= 2.5
*/
for (
  const row
  of R21_selected
) {
  if (
    (
      row.r21Split !==
        "DISCOVERY" &&
      row.r21Split !==
        "INTERNAL"
    ) ||
    row.r21Market !==
      "TOTAL" ||
    (
      R25_num(
        row.r21ScoreEdge
      ) ?? 0
    ) < 2.5
  ) {
    continue;
  }

  R25_candidates.push({
    ...row,

    r25Type:
      "T",

    r25Edge:
      row.r21ScoreEdge,

    r25Date:
      R25_date(
        row
      ),

    r25GameId:
      R25_gameId(
        row
      ),
  });
}


/*
==================================================
CANDIDATE COVERAGE
==================================================
*/

console.log();
console.log(
  "===== ROUND25 CANDIDATE COVERAGE ====="
);

for (
  const split
  of [
    "DISCOVERY",
    "INTERNAL",
  ]
) {
  const source =
    R25_candidates.filter(
      row =>
        row.r21Split ===
          split
    );

  console.log(
    split,
    {
      total:
        source.length,

      D:
        source.filter(
          x =>
            x.r25Type === "D"
        ).length,

      M:
        source.filter(
          x =>
            x.r25Type === "M"
        ).length,

      T:
        source.filter(
          x =>
            x.r25Type === "T"
        ).length,

      days:
        new Set(
          source.map(
            x =>
              x.r25Date
          )
        ).size,
    }
  );
}


/*
==================================================
COMBINATION GENERATOR
==================================================
*/

function R25_generate(
  rows,
  legCount
) {
  const combos =
    [];

  function walk(
    start,
    picked,
    gameIds
  ) {
    if (
      picked.length ===
      legCount
    ) {
      combos.push(
        [
          ...picked
        ]
      );

      return;
    }

    for (
      let i = start;
      i < rows.length;
      i++
    ) {
      const row =
        rows[i];

      if (
        gameIds.has(
          row.r25GameId
        )
      ) {
        continue;
      }

      gameIds.add(
        row.r25GameId
      );

      picked.push(
        row
      );

      walk(
        i + 1,
        picked,
        gameIds
      );

      picked.pop();

      gameIds.delete(
        row.r25GameId
      );
    }
  }

  walk(
    0,
    [],
    new Set()
  );

  return combos;
}


function R25_comboType(
  legs
) {
  const counts = {
    D: 0,
    M: 0,
    T: 0,
  };

  for (
    const leg
    of legs
  ) {
    counts[
      leg.r25Type
    ]++;
  }

  return [
    counts.D
      ? `D${counts.D}`
      : "",
    counts.M
      ? `M${counts.M}`
      : "",
    counts.T
      ? `T${counts.T}`
      : "",
  ]
    .filter(Boolean)
    .join("+");
}


function R25_comboResult(
  legs
) {
  if (
    legs.some(
      leg =>
        leg.result ===
          "LOSS"
    )
  ) {
    return "LOSS";
  }

  if (
    legs.every(
      leg =>
        leg.result ===
          "WIN"
    )
  ) {
    return "WIN";
  }

  return "VOID";
}


function R25_comboOdds(
  legs
) {
  let product =
    1;

  for (
    const leg
    of legs
  ) {
    const odds =
      R25_num(
        leg.odds
      );

    if (
      odds === null ||
      odds <= 0
    ) {
      return null;
    }

    product *=
      odds;
  }

  return product;
}


/*
==================================================
BUILD ALL COMBOS
==================================================
*/

const R25_combos =
  [];

for (
  const split
  of [
    "DISCOVERY",
    "INTERNAL",
  ]
) {
  const source =
    R25_candidates.filter(
      row =>
        row.r21Split ===
          split
    );

  const byDate =
    new Map();

  for (
    const row
    of source
  ) {
    if (
      !row.r25Date
    ) {
      continue;
    }

    if (
      !byDate.has(
        row.r25Date
      )
    ) {
      byDate.set(
        row.r25Date,
        []
      );
    }

    byDate
      .get(
        row.r25Date
      )
      .push(
        row
      );
  }

  for (
    const [
      date,
      rows,
    ]
    of byDate
  ) {
    for (
      const legCount
      of [
        2,
        3,
        4,
        5,
      ]
    ) {
      const combos =
        R25_generate(
          rows,
          legCount
        );

      for (
        const legs
        of combos
      ) {
        const odds =
          R25_comboOdds(
            legs
          );

        if (
          odds === null
        ) {
          continue;
        }

        R25_combos.push({
          split,
          date,
          legCount,

          type:
            R25_comboType(
              legs
            ),

          odds,

          result:
            R25_comboResult(
              legs
            ),

          legs,
        });
      }
    }
  }
}


/*
==================================================
STAT
==================================================
*/

function R25_stat(
  combos
) {
  const settled =
    combos.filter(
      combo =>
        combo.result === "WIN" ||
        combo.result === "LOSS"
    );

  const n =
    settled.length;

  if (!n) {
    return {
      n: 0,
      win: 0,
      hit: null,
      odds: null,
      roi: null,
    };
  }

  const wins =
    settled.filter(
      combo =>
        combo.result === "WIN"
    );

  const avgOdds =
    settled.reduce(
      (
        sum,
        combo
      ) =>
        sum +
        combo.odds,
      0
    ) /
    n;

  const returned =
    wins.reduce(
      (
        sum,
        combo
      ) =>
        sum +
        combo.odds,
      0
    );

  return {
    n,

    win:
      wins.length,

    hit:
      wins.length /
      n,

    odds:
      avgOdds,

    roi:
      (
        returned -
        n
      ) /
      n,
  };
}


function R25_print(
  name,
  combos
) {
  const x =
    R25_stat(
      combos
    );

  console.log(
    `${name} ` +
    `N=${x.n} ` +
    `WIN=${x.win} ` +
    `HIT=${
      x.hit === null
        ? "NA"
        : (
            x.hit *
            100
          ).toFixed(1) +
          "%"
    } ` +
    `ODDS=${
      x.odds === null
        ? "NA"
        : x.odds.toFixed(3)
    } ` +
    `ROI=${
      x.roi === null
        ? "NA"
        : (
            x.roi *
            100
          ).toFixed(1) +
          "%"
    }`
  );
}


/*
==================================================
OVERALL BY LEG COUNT
==================================================
*/

console.log();
console.log(
  "===== ROUND25 BY LEG COUNT ====="
);

for (
  const split
  of [
    "DISCOVERY",
    "INTERNAL",
  ]
) {
  console.log();
  console.log(
    `--- ${split} ---`
  );

  for (
    const legCount
    of [
      2,
      3,
      4,
      5,
    ]
  ) {
    R25_print(
      `${legCount}LEG`,
      R25_combos.filter(
        combo =>
          combo.split ===
            split &&
          combo.legCount ===
            legCount
      )
    );
  }
}


/*
==================================================
COMPOSITION
==================================================
*/

console.log();
console.log(
  "===== ROUND25 COMPOSITION ====="
);

for (
  const split
  of [
    "DISCOVERY",
    "INTERNAL",
  ]
) {
  console.log();
  console.log(
    `--- ${split} ---`
  );

  for (
    const legCount
    of [
      2,
      3,
      4,
      5,
    ]
  ) {
    console.log();
    console.log(
      `${legCount}LEG`
    );

    const source =
      R25_combos.filter(
        combo =>
          combo.split ===
            split &&
          combo.legCount ===
            legCount
      );

    const types =
      [
        ...new Set(
          source.map(
            combo =>
              combo.type
          )
        ),
      ];

    const stats =
      types
        .map(
          type => ({
            type,

            combos:
              source.filter(
                combo =>
                  combo.type ===
                    type
              ),
          })
        )
        .map(
          item => ({
            type:
              item.type,

            ...R25_stat(
              item.combos
            ),
          })
        )
        .filter(
          x =>
            x.n >= 3
        )
        .sort(
          (
            a,
            b
          ) => {
            if (
              b.n !== a.n
            ) {
              return (
                b.n -
                a.n
              );
            }

            return (
              (
                b.hit ?? 0
              ) -
              (
                a.hit ?? 0
              )
            );
          }
        );

    for (
      const x
      of stats
    ) {
      console.log(
        `${x.type} ` +
        `N=${x.n} ` +
        `HIT=${
          x.hit === null
            ? "NA"
            : (
                x.hit *
                100
              ).toFixed(1) +
              "%"
        } ` +
        `ODDS=${
          x.odds === null
            ? "NA"
            : x.odds.toFixed(3)
        } ` +
        `ROI=${
          x.roi === null
            ? "NA"
            : (
                x.roi *
                100
              ).toFixed(1) +
              "%"
        }`
      );
    }
  }
}


/*
==================================================
DEFENSIVE PRESENCE

At least one D pick.
==================================================
*/

console.log();
console.log(
  "===== ROUND25 WITH DEFENSIVE PICK ====="
);

for (
  const split
  of [
    "DISCOVERY",
    "INTERNAL",
  ]
) {
  console.log();
  console.log(
    `--- ${split} ---`
  );

  for (
    const legCount
    of [
      2,
      3,
      4,
      5,
    ]
  ) {
    R25_print(
      `${legCount}LEG +D`,
      R25_combos.filter(
        combo =>
          combo.split ===
            split &&
          combo.legCount ===
            legCount &&
          combo.legs.some(
            leg =>
              leg.r25Type === "D"
          )
      )
    );
  }
}


/*
==================================================
NO TOTAL vs WITH TOTAL
==================================================
*/

console.log();
console.log(
  "===== ROUND25 TOTAL EFFECT ====="
);

for (
  const split
  of [
    "DISCOVERY",
    "INTERNAL",
  ]
) {
  console.log();
  console.log(
    `--- ${split} ---`
  );

  for (
    const legCount
    of [
      2,
      3,
      4,
      5,
    ]
  ) {
    const source =
      R25_combos.filter(
        combo =>
          combo.split ===
            split &&
          combo.legCount ===
            legCount
      );

    R25_print(
      `${legCount}LEG NO-T`,
      source.filter(
        combo =>
          !combo.legs.some(
            leg =>
              leg.r25Type === "T"
          )
      )
    );

    R25_print(
      `${legCount}LEG WITH-T`,
      source.filter(
        combo =>
          combo.legs.some(
            leg =>
              leg.r25Type === "T"
          )
      )
    );
  }
}


/*
==================================================
DAILY AVAILABILITY

How many distinct games are available per day?
==================================================
*/

console.log();
console.log(
  "===== ROUND25 DAILY DISTINCT GAME COVERAGE ====="
);

for (
  const split
  of [
    "DISCOVERY",
    "INTERNAL",
  ]
) {
  const source =
    R25_candidates.filter(
      row =>
        row.r21Split ===
          split
    );

  const byDate =
    new Map();

  for (
    const row
    of source
  ) {
    if (
      !byDate.has(
        row.r25Date
      )
    ) {
      byDate.set(
        row.r25Date,
        new Set()
      );
    }

    byDate
      .get(
        row.r25Date
      )
      .add(
        row.r25GameId
      );
  }

  const counts =
    [
      ...byDate.values()
    ].map(
      set =>
        set.size
    );

  console.log();
  console.log(
    `--- ${split} ---`
  );

  console.log(
    "DAYS:",
    counts.length
  );

  for (
    const legCount
    of [
      2,
      3,
      4,
      5,
    ]
  ) {
    console.log(
      `DAYS >=${legCount}:`,
      counts.filter(
        n =>
          n >= legCount
      ).length
    );
  }
}


console.log();
console.log(
  "ROUND25 MODEL CHANGE: NO"
);

console.log(
  "ROUND25 FILTER CHANGE: NO"
);

console.log(
  "ROUND25 FINAL/AUDIT: NOT EVALUATED"
);


/*
==================================================
V0.7 ROUND 26
ONE COMBO PER DAY VALIDATION

NO MODEL CHANGE.
NO FILTER CHANGE.
NO FINAL/AUDIT.

Structures frozen from Round25 signal:

DEFENSE:
  D1 + T1

VALUE:
  M1 + T1

THREE:
  D1 + M1 + T1

Only ONE combo per day per structure.

Selection:
  highest total normalized edge score.

Distinct games required.
==================================================
*/

console.log();
console.log(
  "=============================================="
);
console.log(
  "V0.7 ROUND 26 — ONE COMBO PER DAY"
);
console.log(
  "=============================================="
);


function R26_scoreLeg(
  leg
) {
  const edge =
    Number(
      leg.r25Edge
    );

  if (
    !Number.isFinite(edge)
  ) {
    return 0;
  }

  /*
    Normalize only for ranking.
    Thresholds are frozen.

    D:
      raw model margin >= 0
      range is relatively small.

    M:
      score edge >= 1.0

    T:
      total edge >= 2.5
  */

  if (
    leg.r25Type === "D"
  ) {
    return edge / 0.5;
  }

  if (
    leg.r25Type === "M"
  ) {
    return edge / 1.0;
  }

  if (
    leg.r25Type === "T"
  ) {
    return edge / 2.5;
  }

  return 0;
}


function R26_comboScore(
  combo
) {
  return combo.legs.reduce(
    (
      sum,
      leg
    ) =>
      sum +
      R26_scoreLeg(
        leg
      ),
    0
  );
}


function R26_pickDaily(
  split,
  type
) {
  const source =
    R25_combos.filter(
      combo =>
        combo.split === split &&
        combo.type === type
    );

  const byDate =
    new Map();

  for (
    const combo
    of source
  ) {
    if (
      !byDate.has(
        combo.date
      )
    ) {
      byDate.set(
        combo.date,
        []
      );
    }

    byDate
      .get(
        combo.date
      )
      .push(
        combo
      );
  }

  const selected =
    [];

  for (
    const [
      date,
      combos,
    ]
    of byDate
  ) {
    combos.sort(
      (
        a,
        b
      ) => {
        const scoreDiff =
          R26_comboScore(
            b
          ) -
          R26_comboScore(
            a
          );

        if (
          Math.abs(
            scoreDiff
          ) >
          1e-9
        ) {
          return scoreDiff;
        }

        /*
          Tie:
          lower combo odds first.
          Defensive deterministic tie-break.
        */
        return (
          a.odds -
          b.odds
        );
      }
    );

    selected.push({
      ...combos[0],

      r26Score:
        R26_comboScore(
          combos[0]
        ),
    });
  }

  return selected.sort(
    (
      a,
      b
    ) =>
      String(
        a.date
      ).localeCompare(
        String(
          b.date
        )
      )
  );
}


function R26_stat(
  combos
) {
  const settled =
    combos.filter(
      combo =>
        combo.result === "WIN" ||
        combo.result === "LOSS"
    );

  const n =
    settled.length;

  if (!n) {
    return {
      n: 0,
      win: 0,
      hit: null,
      odds: null,
      roi: null,
      profit: null,
    };
  }

  const wins =
    settled.filter(
      combo =>
        combo.result === "WIN"
    );

  const avgOdds =
    settled.reduce(
      (
        sum,
        combo
      ) =>
        sum +
        combo.odds,
      0
    ) / n;

  const returned =
    wins.reduce(
      (
        sum,
        combo
      ) =>
        sum +
        combo.odds,
      0
    );

  return {
    n,

    win:
      wins.length,

    hit:
      wins.length /
      n,

    odds:
      avgOdds,

    roi:
      (
        returned -
        n
      ) / n,

    profit:
      returned -
      n,
  };
}


function R26_print(
  name,
  combos
) {
  const x =
    R26_stat(
      combos
    );

  console.log(
    `${name} ` +
    `N=${x.n} ` +
    `WIN=${x.win} ` +
    `HIT=${
      x.hit === null
        ? "NA"
        : (
            x.hit *
            100
          ).toFixed(1) +
          "%"
    } ` +
    `ODDS=${
      x.odds === null
        ? "NA"
        : x.odds.toFixed(3)
    } ` +
    `ROI=${
      x.roi === null
        ? "NA"
        : (
            x.roi *
            100
          ).toFixed(1) +
          "%"
    }`
  );
}


const R26_STRUCTURES = [
  {
    name:
      "DEFENSE_D+T",

    type:
      "D1+T1",
  },

  {
    name:
      "VALUE_M+T",

    type:
      "M1+T1",
  },

  {
    name:
      "THREE_D+M+T",

    type:
      "D1+M1+T1",
  },
];


const R26_results =
  [];


console.log();
console.log(
  "===== ROUND26 DISCOVERY / INTERNAL ====="
);

for (
  const structure
  of R26_STRUCTURES
) {
  console.log();
  console.log(
    `--- ${structure.name} ---`
  );

  for (
    const split
    of [
      "DISCOVERY",
      "INTERNAL",
    ]
  ) {
    const selected =
      R26_pickDaily(
        split,
        structure.type
      );

    R26_print(
      split,
      selected
    );

    R26_results.push({
      structure:
        structure.name,

      split,

      selected,
    });
  }
}


/*
==================================================
MONTHLY
==================================================
*/

console.log();
console.log(
  "===== ROUND26 MONTHLY ====="
);

for (
  const structure
  of R26_STRUCTURES
) {
  console.log();
  console.log(
    `--- ${structure.name} ---`
  );

  const all =
    [
      ...R26_pickDaily(
        "DISCOVERY",
        structure.type
      ),

      ...R26_pickDaily(
        "INTERNAL",
        structure.type
      ),
    ];

  for (
    const month
    of [
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]
  ) {
    R26_print(
      month,
      all.filter(
        combo =>
          String(
            combo.date
          ).slice(
            0,
            7
          ) === month
      )
    );
  }
}


/*
==================================================
CHRONOLOGICAL TWO-MONTH WINDOWS
==================================================
*/

console.log();
console.log(
  "===== ROUND26 TWO-MONTH WINDOWS ====="
);

const R26_WINDOWS = [
  {
    name:
      "MAR_APR",

    months: [
      "2026-03",
      "2026-04",
    ],
  },

  {
    name:
      "APR_MAY",

    months: [
      "2026-04",
      "2026-05",
    ],
  },

  {
    name:
      "MAY_JUN",

    months: [
      "2026-05",
      "2026-06",
    ],
  },
];


for (
  const structure
  of R26_STRUCTURES
) {
  console.log();
  console.log(
    `--- ${structure.name} ---`
  );

  const all =
    [
      ...R26_pickDaily(
        "DISCOVERY",
        structure.type
      ),

      ...R26_pickDaily(
        "INTERNAL",
        structure.type
      ),
    ];

  for (
    const window
    of R26_WINDOWS
  ) {
    R26_print(
      window.name,
      all.filter(
        combo =>
          window.months.includes(
            String(
              combo.date
            ).slice(
              0,
              7
            )
          )
      )
    );
  }
}


/*
==================================================
COMBINED D+I
==================================================
*/

console.log();
console.log(
  "===== ROUND26 COMBINED D+I ====="
);

for (
  const structure
  of R26_STRUCTURES
) {
  const combined =
    [
      ...R26_pickDaily(
        "DISCOVERY",
        structure.type
      ),

      ...R26_pickDaily(
        "INTERNAL",
        structure.type
      ),
    ];

  R26_print(
    structure.name,
    combined
  );
}


/*
==================================================
DAILY DETAILS

Useful because sample sizes are small.
==================================================
*/

console.log();
console.log(
  "===== ROUND26 DAILY DETAILS ====="
);

for (
  const structure
  of R26_STRUCTURES
) {
  console.log();
  console.log(
    `--- ${structure.name} ---`
  );

  for (
    const split
    of [
      "DISCOVERY",
      "INTERNAL",
    ]
  ) {
    const selected =
      R26_pickDaily(
        split,
        structure.type
      );

    for (
      const combo
      of selected
    ) {
      console.log(
        split,
        combo.date,
        combo.result,
        `ODDS=${combo.odds.toFixed(3)}`,
        `SCORE=${combo.r26Score.toFixed(3)}`,
        combo.legs
          .map(
            leg =>
              `${leg.r25Type}:${leg.label}`
          )
          .join(
            " | "
          )
      );
    }
  }
}


console.log();
console.log(
  "ROUND26 MODEL CHANGE: NO"
);

console.log(
  "ROUND26 FILTER CHANGE: NO"
);

console.log(
  "ROUND26 PRODUCTION CHANGE: NO"
);

console.log(
  "ROUND26 FINAL/AUDIT: NOT EVALUATED"
);


/*
==================================================
V0.7 ROUND 27
D+M+T STRUCTURE DIAGNOSTIC

NO MODEL CHANGE.
NO FILTER CHANGE.
NO FINAL/AUDIT.

Purpose:
  Analyze why D+M+T worked.

Do NOT create new production rule yet.
==================================================
*/

console.log();
console.log(
  "=============================================="
);
console.log(
  "V0.7 ROUND 27 — D+M+T STRUCTURE DIAGNOSTIC"
);
console.log(
  "=============================================="
);


function R27_num(
  value
) {
  const n =
    Number(
      value
    );

  return Number.isFinite(n)
    ? n
    : null;
}


function R27_dailyThree(
  split
) {
  return R26_pickDaily(
    split,
    "D1+M1+T1"
  );
}


const R27_all =
  [
    ...R27_dailyThree(
      "DISCOVERY"
    ),
    ...R27_dailyThree(
      "INTERNAL"
    ),
  ].map(
    combo => {
      const d =
        combo.legs.find(
          x =>
            x.r25Type === "D"
        );

      const m =
        combo.legs.find(
          x =>
            x.r25Type === "M"
        );

      const t =
        combo.legs.find(
          x =>
            x.r25Type === "T"
        );

      const dEdge =
        R27_num(
          d?.r25Edge
        ) ?? 0;

      const mEdge =
        R27_num(
          m?.r25Edge
        ) ?? 0;

      const tEdge =
        R27_num(
          t?.r25Edge
        ) ?? 0;

      return {
        ...combo,

        r27D:
          d,

        r27M:
          m,

        r27T:
          t,

        r27DEdge:
          dEdge,

        r27MEdge:
          mEdge,

        r27TEdge:
          tEdge,

        r27MinEdge:
          Math.min(
            dEdge,
            mEdge,
            tEdge
          ),

        r27SumEdge:
          dEdge +
          mEdge +
          tEdge,
      };
    }
  );


function R27_stat(
  rows
) {
  const n =
    rows.length;

  if (!n) {
    return {
      n: 0,
      win: 0,
      hit: null,
      odds: null,
      roi: null,
    };
  }

  const wins =
    rows.filter(
      x =>
        x.result === "WIN"
    );

  const avgOdds =
    rows.reduce(
      (
        sum,
        x
      ) =>
        sum +
        x.odds,
      0
    ) / n;

  const returned =
    wins.reduce(
      (
        sum,
        x
      ) =>
        sum +
        x.odds,
      0
    );

  return {
    n,

    win:
      wins.length,

    hit:
      wins.length /
      n,

    odds:
      avgOdds,

    roi:
      (
        returned -
        n
      ) / n,
  };
}


function R27_print(
  name,
  rows
) {
  const x =
    R27_stat(
      rows
    );

  console.log(
    `${name} ` +
    `N=${x.n} ` +
    `WIN=${x.win} ` +
    `HIT=${
      x.hit === null
        ? "NA"
        : (
            x.hit *
            100
          ).toFixed(1) +
          "%"
    } ` +
    `ODDS=${
      x.odds === null
        ? "NA"
        : x.odds.toFixed(3)
    } ` +
    `ROI=${
      x.roi === null
        ? "NA"
        : (
            x.roi *
            100
          ).toFixed(1) +
          "%"
    }`
  );
}


console.log();
console.log(
  "===== ROUND27 BASE ====="
);

R27_print(
  "ALL D+M+T",
  R27_all
);


console.log();
console.log(
  "===== ROUND27 EACH COMBO ====="
);

for (
  const x
  of R27_all
) {
  console.log(
    x.split,
    x.date,
    x.result,

    `ODDS=${x.odds.toFixed(3)}`,

    `D=${x.r27DEdge.toFixed(3)}`,

    `M=${x.r27MEdge.toFixed(3)}`,

    `T=${x.r27TEdge.toFixed(3)}`,

    `MIN=${x.r27MinEdge.toFixed(3)}`,

    `SUM=${x.r27SumEdge.toFixed(3)}`,

    "||",

    x.legs
      .map(
        leg =>
          `${leg.r25Type}:${leg.label}`
      )
      .join(
        " | "
      )
  );
}


/*
==================================================
D EDGE
==================================================
*/

console.log();
console.log(
  "===== ROUND27 D EDGE ====="
);

for (
  const threshold
  of [
    0.0,
    0.1,
    0.2,
    0.3,
    0.4,
    0.5,
  ]
) {
  R27_print(
    `D>=${threshold.toFixed(1)}`,
    R27_all.filter(
      x =>
        x.r27DEdge >=
          threshold
    )
  );
}


/*
==================================================
M EDGE
==================================================
*/

console.log();
console.log(
  "===== ROUND27 M EDGE ====="
);

for (
  const threshold
  of [
    1.0,
    1.25,
    1.5,
    1.75,
    2.0,
  ]
) {
  R27_print(
    `M>=${threshold.toFixed(2)}`,
    R27_all.filter(
      x =>
        x.r27MEdge >=
          threshold
    )
  );
}


/*
==================================================
T EDGE
==================================================
*/

console.log();
console.log(
  "===== ROUND27 T EDGE ====="
);

for (
  const threshold
  of [
    2.5,
    3.0,
    3.5,
    4.0,
    4.5,
  ]
) {
  R27_print(
    `T>=${threshold.toFixed(1)}`,
    R27_all.filter(
      x =>
        x.r27TEdge >=
          threshold
    )
  );
}


/*
==================================================
COMBO ODDS
==================================================
*/

console.log();
console.log(
  "===== ROUND27 ODDS BAND ====="
);

const R27_ODDS = [
  [
    "2.50-2.99",
    2.50,
    3.00,
  ],
  [
    "3.00-3.29",
    3.00,
    3.30,
  ],
  [
    "3.30-3.59",
    3.30,
    3.60,
  ],
  [
    "3.60+",
    3.60,
    Infinity,
  ],
];

for (
  const [
    name,
    lo,
    hi
  ]
  of R27_ODDS
) {
  R27_print(
    name,
    R27_all.filter(
      x =>
        x.odds >= lo &&
        x.odds < hi
    )
  );
}


/*
==================================================
WIN / LOSS FEATURE AVERAGES
==================================================
*/

console.log();
console.log(
  "===== ROUND27 WIN VS LOSS ====="
);

for (
  const result
  of [
    "WIN",
    "LOSS",
  ]
) {
  const rows =
    R27_all.filter(
      x =>
        x.result === result
    );

  if (!rows.length) {
    console.log(
      result,
      "N=0"
    );

    continue;
  }

  const avg =
    key =>
      rows.reduce(
        (
          sum,
          x
        ) =>
          sum +
          x[key],
        0
      ) /
      rows.length;

  console.log(
    result,
    `N=${rows.length}`,
    `D=${avg("r27DEdge").toFixed(3)}`,
    `M=${avg("r27MEdge").toFixed(3)}`,
    `T=${avg("r27TEdge").toFixed(3)}`,
    `MIN=${avg("r27MinEdge").toFixed(3)}`,
    `SUM=${avg("r27SumEdge").toFixed(3)}`,
    `ODDS=${(
      rows.reduce(
        (
          sum,
          x
        ) =>
          sum +
          x.odds,
        0
      ) /
      rows.length
    ).toFixed(3)}`
  );
}


/*
==================================================
LEGS ACTUAL RESULT
==================================================
*/

console.log();
console.log(
  "===== ROUND27 LEG FAILURE ====="
);

for (
  const x
  of R27_all
) {
  const failed =
    x.legs.filter(
      leg =>
        leg.result !==
          "WIN"
    );

  console.log(
    x.date,
    x.result,

    failed.length
      ? failed
          .map(
            leg =>
              `${leg.r25Type}:${leg.label}:${leg.result}`
          )
          .join(
            " | "
          )
      : "ALL WIN"
  );
}


console.log();
console.log(
  "ROUND27 MODEL CHANGE: NO"
);

console.log(
  "ROUND27 FILTER CHANGE: NO"
);

console.log(
  "ROUND27 PRODUCTION CHANGE: NO"
);

console.log(
  "ROUND27 FINAL/AUDIT: NOT EVALUATED"
);

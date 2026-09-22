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



console.log();
console.log("===== V0.7 ROUND 8 / STABILITY CHECK =====");

/*
  NO RETUNING.
  NO FINAL/AUDIT.

  A = R5_WINRATE
  B = R5_WINRATE + REST
  C = R5_WINRATE + REST + R10_WINRATE

  Check:
    - monthly Mar/Apr/May/Jun
    - chronological Apr/May/Jun
    - full Mar-Jun weighted metrics
*/

const R8_MODELS = [
  {
    name: "A_R5",
    predictor: r7Predictor(false, false)
  },
  {
    name: "B_R5_REST",
    predictor: r7Predictor(true, false)
  },
  {
    name: "C_R5_REST_R10",
    predictor: r7Predictor(true, true)
  }
];

function r8EvaluateRange(
  predictor,
  startDate,
  endDate
) {
  let teamErr = 0;
  let totalErr = 0;
  let diffErr = 0;
  let winnerCorrect = 0;
  let winnerN = 0;
  let within1 = 0;
  let within2 = 0;
  let n = 0;

  for (const g of games) {
    if (
      String(g.date) < startDate ||
      String(g.date) > endDate
    ) continue;

    const p = predictor(g);

    if (!p)
      continue;

    const actualAway =
      Number(g.awayScore);

    const actualHome =
      Number(g.homeScore);

    if (
      !Number.isFinite(actualAway) ||
      !Number.isFinite(actualHome)
    ) continue;

    const aeAway =
      Math.abs(
        p.away - actualAway
      );

    const aeHome =
      Math.abs(
        p.home - actualHome
      );

    teamErr +=
      (aeAway + aeHome) / 2;

    totalErr +=
      Math.abs(
        (p.away + p.home) -
        (actualAway + actualHome)
      );

    diffErr +=
      Math.abs(
        (p.home - p.away) -
        (actualHome - actualAway)
      );

    if (
      aeAway <= 1 &&
      aeHome <= 1
    ) {
      within1++;
    }

    if (
      aeAway <= 2 &&
      aeHome <= 2
    ) {
      within2++;
    }

    const predDiff =
      p.home - p.away;

    const actualDiff =
      actualHome - actualAway;

    if (
      predDiff !== 0 &&
      actualDiff !== 0
    ) {
      winnerN++;

      if (
        Math.sign(predDiff) ===
        Math.sign(actualDiff)
      ) {
        winnerCorrect++;
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
        ? winnerCorrect / winnerN
        : null
  };
}

function r8Fmt(v) {
  return Number.isFinite(v)
    ? v.toFixed(6)
    : "NA";
}

function r8Pct(v) {
  return Number.isFinite(v)
    ? (v * 100).toFixed(1) + "%"
    : "NA";
}

const R8_WINDOWS = [
  {
    name: "2026-03",
    start: "2026-03-01",
    end: "2026-03-31"
  },
  {
    name: "2026-04",
    start: "2026-04-01",
    end: "2026-04-30"
  },
  {
    name: "2026-05",
    start: "2026-05-01",
    end: "2026-05-31"
  },
  {
    name: "2026-06",
    start: "2026-06-01",
    end: "2026-06-30"
  }
];

console.log();
console.log(
  "===== ROUND8 MONTHLY ====="
);

const monthlyWins = {
  A_R5: 0,
  B_R5_REST: 0,
  C_R5_REST_R10: 0
};

for (const w of R8_WINDOWS) {
  const rows =
    R8_MODELS.map(m => ({
      name: m.name,
      result:
        r8EvaluateRange(
          m.predictor,
          w.start,
          w.end
        )
    }));

  rows.sort(
    (a,b) =>
      a.result.teamMAE -
      b.result.teamMAE
  );

  if (rows.length) {
    monthlyWins[
      rows[0].name
    ]++;
  }

  console.log();
  console.log(
    "---",
    w.name,
    "---"
  );

  for (const r of rows) {
    console.log(
      r.name,
      "n=" + r.result.n,
      "TEAM=" +
        r8Fmt(
          r.result.teamMAE
        ),
      "TOTAL=" +
        r8Fmt(
          r.result.totalMAE
        ),
      "DIFF=" +
        r8Fmt(
          r.result.diffMAE
        ),
      "±1=" +
        r8Pct(
          r.result.within1
        ),
      "±2=" +
        r8Pct(
          r.result.within2
        ),
      "W=" +
        r8Pct(
          r.result.winnerAcc
        )
    );
  }

  console.log(
    "WINNER=" +
      rows[0].name
  );
}

console.log();
console.log(
  "MONTHLY WINS:",
  monthlyWins
);

/*
  Chronological forward windows.
  No future data used for selection here;
  this is stability reporting only.
*/
const R8_WF = [
  {
    name: "APR",
    start: "2026-04-01",
    end: "2026-04-30"
  },
  {
    name: "MAY",
    start: "2026-05-01",
    end: "2026-05-31"
  },
  {
    name: "JUN",
    start: "2026-06-01",
    end: "2026-06-30"
  }
];

console.log();
console.log(
  "===== ROUND8 CHRONOLOGICAL WINDOWS ====="
);

const wfWins = {
  A_R5: 0,
  B_R5_REST: 0,
  C_R5_REST_R10: 0
};

for (const w of R8_WF) {
  const rows =
    R8_MODELS.map(m => ({
      name: m.name,
      result:
        r8EvaluateRange(
          m.predictor,
          w.start,
          w.end
        )
    }))
    .sort(
      (a,b) =>
        a.result.teamMAE -
        b.result.teamMAE
    );

  wfWins[
    rows[0].name
  ]++;

  console.log(
    w.name,
    "WINNER=" +
      rows[0].name,
    rows
      .map(
        r =>
          r.name +
          "=" +
          r8Fmt(
            r.result.teamMAE
          )
      )
      .join(" | ")
  );
}

console.log(
  "WF WINS:",
  wfWins
);

console.log();
console.log(
  "===== ROUND8 FULL MAR-JUN ====="
);

const fullRows =
  R8_MODELS
    .map(m => ({
      name: m.name,
      result:
        r8EvaluateRange(
          m.predictor,
          "2026-03-01",
          "2026-06-30"
        )
    }))
    .sort(
      (a,b) =>
        a.result.teamMAE -
        b.result.teamMAE
    );

for (const r of fullRows) {
  console.log(
    r.name,
    "n=" + r.result.n,
    "TEAM=" +
      r8Fmt(
        r.result.teamMAE
      ),
    "TOTAL=" +
      r8Fmt(
        r.result.totalMAE
      ),
    "DIFF=" +
      r8Fmt(
        r.result.diffMAE
      ),
    "±1=" +
      r8Pct(
        r.result.within1
      ),
    "±2=" +
      r8Pct(
        r.result.within2
      ),
    "W=" +
      r8Pct(
        r.result.winnerAcc
      )
  );
}

const r8Winner =
  fullRows[0];

console.log();
console.log(
  "ROUND8 FULL WINNER:",
  r8Winner.name,
  "TEAM=" +
    r8Winner.result.teamMAE
);

console.log(
  "ROUND8 FINAL/AUDIT: NOT EVALUATED"
);



console.log();
console.log("===== V0.7 ROUND 9 / ERROR DIAGNOSTICS =====");

/*
  DIAGNOSTIC ONLY.
  NO RETUNING.
  NO MODEL SELECTION.
  NO FINAL/AUDIT.

  Frozen model:
    R5_WINRATE
    + REST
    + R10_WINRATE

  Base underneath already contains:
    V03 champion
    + R5 defense
    + venue offense
    + venue defense
    + bullpen
    + lineup OPS
*/

const R9_MODEL =
  r7Predictor(true, true);

function r9Num(v) {
  const n = Number(v);
  return Number.isFinite(n)
    ? n
    : null;
}

function r9Row(g) {
  const p = R9_MODEL(g);

  if (!p)
    return null;

  const actualAway =
    r9Num(g.awayScore);

  const actualHome =
    r9Num(g.homeScore);

  if (
    actualAway === null ||
    actualHome === null
  ) return null;

  const x =
    v06Map.get(g.gameId);

  const awayErr =
    Math.abs(
      p.away - actualAway
    );

  const homeErr =
    Math.abs(
      p.home - actualHome
    );

  const predTotal =
    p.away + p.home;

  const actualTotal =
    actualAway + actualHome;

  const predDiff =
    p.home - p.away;

  const actualDiff =
    actualHome - actualAway;

  const awayR5Whip =
    x
      ? r6Get(
          x,
          "starter.away.recent5.whip"
        )
      : null;

  const homeR5Whip =
    x
      ? r6Get(
          x,
          "starter.home.recent5.whip"
        )
      : null;

  return {
    g,
    p,
    x,

    actualAway,
    actualHome,

    awayErr,
    homeErr,

    teamErr:
      (awayErr + homeErr) / 2,

    predTotal,
    actualTotal,

    totalErr:
      Math.abs(
        predTotal - actualTotal
      ),

    diffErr:
      Math.abs(
        predDiff - actualDiff
      ),

    winnerCorrect:
      predDiff !== 0 &&
      actualDiff !== 0
        ? Math.sign(predDiff) ===
          Math.sign(actualDiff)
        : null,

    bothWithin1:
      awayErr <= 1 &&
      homeErr <= 1,

    bothWithin2:
      awayErr <= 2 &&
      homeErr <= 2,

    starterRecentBoth:
      awayR5Whip !== null &&
      homeR5Whip !== null
  };
}

const R9_ROWS =
  games
    .filter(g => {
      const m =
        Number(
          String(g.date).slice(5, 7)
        );

      return m >= 3 && m <= 6;
    })
    .map(r9Row)
    .filter(Boolean);

function r9Metrics(rows) {
  if (!rows.length) {
    return {
      n: 0,
      teamMAE: null,
      awayMAE: null,
      homeMAE: null,
      totalMAE: null,
      diffMAE: null,
      within1: null,
      within2: null,
      winnerAcc: null
    };
  }

  const mean = fn =>
    rows.reduce(
      (sum, r) =>
        sum + fn(r),
      0
    ) / rows.length;

  const winnerRows =
    rows.filter(
      r =>
        r.winnerCorrect !== null
    );

  return {
    n: rows.length,

    teamMAE:
      mean(r => r.teamErr),

    awayMAE:
      mean(r => r.awayErr),

    homeMAE:
      mean(r => r.homeErr),

    totalMAE:
      mean(r => r.totalErr),

    diffMAE:
      mean(r => r.diffErr),

    within1:
      mean(
        r =>
          r.bothWithin1
            ? 1
            : 0
      ),

    within2:
      mean(
        r =>
          r.bothWithin2
            ? 1
            : 0
      ),

    winnerAcc:
      winnerRows.length
        ? winnerRows.filter(
            r =>
              r.winnerCorrect
          ).length /
          winnerRows.length
        : null
  };
}

function r9F(v) {
  return Number.isFinite(v)
    ? v.toFixed(3)
    : "NA";
}

function r9P(v) {
  return Number.isFinite(v)
    ? (v * 100).toFixed(1) + "%"
    : "NA";
}

function r9Print(
  name,
  rows
) {
  const m =
    r9Metrics(rows);

  console.log(
    name,
    "n=" + m.n,
    "TEAM=" + r9F(m.teamMAE),
    "AWAY=" + r9F(m.awayMAE),
    "HOME=" + r9F(m.homeMAE),
    "TOTAL=" + r9F(m.totalMAE),
    "DIFF=" + r9F(m.diffMAE),
    "±1=" + r9P(m.within1),
    "±2=" + r9P(m.within2),
    "W=" + r9P(m.winnerAcc)
  );
}

console.log();
console.log(
  "===== ROUND9 BASE ====="
);

r9Print(
  "FULL_MAR_JUN",
  R9_ROWS
);

/*
  --------------------------------------------------
  1. HOME / AWAY SIDE ERROR
  --------------------------------------------------
*/

console.log();
console.log(
  "===== ROUND9 HOME VS AWAY ERROR ====="
);

const full =
  r9Metrics(R9_ROWS);

console.log(
  "AWAY_MAE=" +
    r9F(full.awayMAE),

  "HOME_MAE=" +
    r9F(full.homeMAE),

  "HOME_MINUS_AWAY=" +
    r9F(
      full.homeMAE -
      full.awayMAE
    )
);

/*
  --------------------------------------------------
  2. PREDICTED TOTAL BUCKET
  --------------------------------------------------
*/

console.log();
console.log(
  "===== ROUND9 PREDICTED TOTAL BUCKET ====="
);

const predBuckets = [
  ["PRED_LT_7", -Infinity, 7],
  ["PRED_7_8", 7, 9],
  ["PRED_9_10", 9, 11],
  ["PRED_11_PLUS", 11, Infinity]
];

for (
  const [name, lo, hi]
  of predBuckets
) {
  r9Print(
    name,
    R9_ROWS.filter(
      r =>
        r.predTotal >= lo &&
        r.predTotal < hi
    )
  );
}

/*
  --------------------------------------------------
  3. ACTUAL TOTAL BUCKET
  Diagnostic only — actual result is NOT a predictor.
  --------------------------------------------------
*/

console.log();
console.log(
  "===== ROUND9 ACTUAL TOTAL BUCKET / DIAGNOSTIC ONLY ====="
);

const actualBuckets = [
  ["ACTUAL_0_6", -Infinity, 7],
  ["ACTUAL_7_9", 7, 10],
  ["ACTUAL_10_12", 10, 13],
  ["ACTUAL_13_PLUS", 13, Infinity]
];

for (
  const [name, lo, hi]
  of actualBuckets
) {
  r9Print(
    name,
    R9_ROWS.filter(
      r =>
        r.actualTotal >= lo &&
        r.actualTotal < hi
    )
  );
}

/*
  --------------------------------------------------
  4. STARTER RECENT DATA COVERAGE
  --------------------------------------------------
*/

console.log();
console.log(
  "===== ROUND9 STARTER RECENT COVERAGE ====="
);

r9Print(
  "STARTER_RECENT_BOTH",
  R9_ROWS.filter(
    r => r.starterRecentBoth
  )
);

r9Print(
  "STARTER_RECENT_MISSING",
  R9_ROWS.filter(
    r => !r.starterRecentBoth
  )
);

/*
  --------------------------------------------------
  5. ACTUAL MARGIN / CLOSE VS BLOWOUT
  Diagnostic only.
  --------------------------------------------------
*/

console.log();
console.log(
  "===== ROUND9 ACTUAL MARGIN / DIAGNOSTIC ONLY ====="
);

r9Print(
  "CLOSE_0_2",
  R9_ROWS.filter(
    r =>
      Math.abs(
        r.actualHome -
        r.actualAway
      ) <= 2
  )
);

r9Print(
  "MARGIN_3_5",
  R9_ROWS.filter(r => {
    const d =
      Math.abs(
        r.actualHome -
        r.actualAway
      );

    return d >= 3 && d <= 5;
  })
);

r9Print(
  "BLOWOUT_6_PLUS",
  R9_ROWS.filter(
    r =>
      Math.abs(
        r.actualHome -
        r.actualAway
      ) >= 6
  )
);

/*
  --------------------------------------------------
  6. MONTHLY
  --------------------------------------------------
*/

console.log();
console.log(
  "===== ROUND9 MONTHLY ====="
);

for (
  const month of [3,4,5,6]
) {
  r9Print(
    "MONTH_" +
      String(month).padStart(2, "0"),

    R9_ROWS.filter(
      r =>
        Number(
          String(
            r.g.date
          ).slice(5,7)
        ) === month
    )
  );
}

/*
  --------------------------------------------------
  7. WORST 20 GAMES
  --------------------------------------------------
*/

console.log();
console.log(
  "===== ROUND9 WORST 20 ====="
);

const worst =
  [...R9_ROWS]
    .sort(
      (a,b) =>
        b.teamErr -
        a.teamErr
    )
    .slice(0,20);

for (const r of worst) {
  console.log(
    r.g.date,
    r.g.gameId,
    `${r.g.awayTeam}@${r.g.homeTeam}`,
    "PRED=" +
      r.p.away.toFixed(1) +
      ":" +
      r.p.home.toFixed(1),
    "ACTUAL=" +
      r.actualAway +
      ":" +
      r.actualHome,
    "TEAM_ERR=" +
      r.teamErr.toFixed(3),
    "TOTAL_ERR=" +
      r.totalErr.toFixed(3),
    "STARTER_R5=" +
      (
        r.starterRecentBoth
          ? "YES"
          : "NO"
      )
  );
}

console.log();
console.log(
  "ROUND9 MODEL CHANGED: NO"
);

console.log(
  "ROUND9 FINAL/AUDIT: NOT EVALUATED"
);



/*
==================================================
SCORE MODEL ROUND 21 — ERROR CAUSE DIAGNOSTIC

BASE:
  Frozen V0.7 Round7
  R5_WINRATE + REST + R10_WINRATE

NO MODEL CHANGE.
NO COEFFICIENT TUNING.
NO FINAL/AUDIT.

Purpose:
  Find what separates normal-error games
  from large-error games.

Investigate:
  - recent scoring volatility
  - recent allowed-runs volatility proxy
  - recent-vs-season shift
  - venue offense/defense deviation
  - rest-day asymmetry
  - predicted total / predicted margin
==================================================
*/

console.log();
console.log(
  "=================================================="
);
console.log(
  "SCORE ROUND21 — ERROR CAUSE DIAGNOSTIC"
);
console.log(
  "=================================================="
);

const SR21_MODEL =
  r7Predictor(
    true,
    true
  );


function SR21_num(
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


function SR21_abs(
  value
) {
  const n =
    SR21_num(
      value
    );

  return n === null
    ? null
    : Math.abs(n);
}


function SR21_avgAvailable(
  values
) {
  const clean =
    values.filter(
      value =>
        value !== null &&
        Number.isFinite(
          value
        )
    );

  if (!clean.length) {
    return null;
  }

  return (
    clean.reduce(
      (a, b) =>
        a + b,
      0
    ) /
    clean.length
  );
}


function SR21_sideFeatures(
  form
) {
  if (!form) {
    return null;
  }

  const seasonRuns =
    SR21_num(
      form.seasonAvgRuns
    );

  const seasonAllowed =
    SR21_num(
      form.seasonAvgRunsAllowed
    );

  const r5Runs =
    SR21_num(
      form.recent5?.avgRuns
    );

  const r10Runs =
    SR21_num(
      form.recent10?.avgRuns
    );

  const r20Runs =
    SR21_num(
      form.recent20?.avgRuns
    );

  const r5Allowed =
    SR21_num(
      form.recent5?.avgRunsAllowed
    );

  const r10Allowed =
    SR21_num(
      form.recent10?.avgRunsAllowed
    );

  const r20Allowed =
    SR21_num(
      form.recent20?.avgRunsAllowed
    );

  const homeRuns =
    SR21_num(
      form.homeAvgRuns
    );

  const awayRuns =
    SR21_num(
      form.awayAvgRuns
    );

  const homeAllowed =
    SR21_num(
      form.homeAvgRunsAllowed
    );

  const awayAllowed =
    SR21_num(
      form.awayAvgRunsAllowed
    );

  /*
    This is not true standard deviation.
    It is a D-1 safe instability proxy using
    disagreement between recent windows.
  */
  const offenseWindowSpread =
    (
      r5Runs !== null &&
      r10Runs !== null &&
      r20Runs !== null
    )
      ? (
          Math.max(
            r5Runs,
            r10Runs,
            r20Runs
          ) -
          Math.min(
            r5Runs,
            r10Runs,
            r20Runs
          )
        )
      : null;

  const defenseWindowSpread =
    (
      r5Allowed !== null &&
      r10Allowed !== null &&
      r20Allowed !== null
    )
      ? (
          Math.max(
            r5Allowed,
            r10Allowed,
            r20Allowed
          ) -
          Math.min(
            r5Allowed,
            r10Allowed,
            r20Allowed
          )
        )
      : null;

  const recentOffenseShift =
    (
      r5Runs !== null &&
      seasonRuns !== null
    )
      ? r5Runs -
        seasonRuns
      : null;

  const recentDefenseShift =
    (
      r5Allowed !== null &&
      seasonAllowed !== null
    )
      ? r5Allowed -
        seasonAllowed
      : null;

  const venueOffenseGap =
    (
      homeRuns !== null &&
      awayRuns !== null
    )
      ? Math.abs(
          homeRuns -
          awayRuns
        )
      : null;

  const venueDefenseGap =
    (
      homeAllowed !== null &&
      awayAllowed !== null
    )
      ? Math.abs(
          homeAllowed -
          awayAllowed
        )
      : null;

  return {
    offenseWindowSpread,
    defenseWindowSpread,

    recentOffenseShift:
      SR21_abs(
        recentOffenseShift
      ),

    recentDefenseShift:
      SR21_abs(
        recentDefenseShift
      ),

    venueOffenseGap,
    venueDefenseGap,

    restDays:
      SR21_num(
        form.restDays
      ),

    seasonGames:
      SR21_num(
        form.seasonGames
      ),
  };
}


function SR21_row(
  g
) {
  const split =
    splitOf(
      g
    );

  if (
    split !== "DISCOVERY" &&
    split !== "INTERNAL"
  ) {
    return null;
  }

  const p =
    SR21_MODEL(
      g
    );

  if (
    !p ||
    !Number.isFinite(
      p.away
    ) ||
    !Number.isFinite(
      p.home
    )
  ) {
    return null;
  }

  const actualAway =
    Number(
      g.awayScore
    );

  const actualHome =
    Number(
      g.homeScore
    );

  if (
    !Number.isFinite(
      actualAway
    ) ||
    !Number.isFinite(
      actualHome
    )
  ) {
    return null;
  }

  const x =
    v06Map.get(
      g.gameId
    );

  if (!x) {
    return null;
  }

  const awayF =
    SR21_sideFeatures(
      x.awayTeamForm
    );

  const homeF =
    SR21_sideFeatures(
      x.homeTeamForm
    );

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

  const teamErr =
    (
      awayErr +
      homeErr
    ) / 2;

  const predTotal =
    p.away +
    p.home;

  const actualTotal =
    actualAway +
    actualHome;

  const predDiff =
    p.away -
    p.home;

  const actualDiff =
    actualAway -
    actualHome;

  const restGap =
    (
      awayF?.restDays !== null &&
      awayF?.restDays !== undefined &&
      homeF?.restDays !== null &&
      homeF?.restDays !== undefined
    )
      ? Math.abs(
          awayF.restDays -
          homeF.restDays
        )
      : null;

  return {
    split,

    date:
      g.date,

    gameId:
      g.gameId,

    awayTeam:
      g.awayTeam,

    homeTeam:
      g.homeTeam,

    predAway:
      p.away,

    predHome:
      p.home,

    actualAway,
    actualHome,

    awayErr,
    homeErr,
    teamErr,

    totalErr:
      Math.abs(
        predTotal -
        actualTotal
      ),

    diffErr:
      Math.abs(
        predDiff -
        actualDiff
      ),

    predTotal,

    predMargin:
      Math.abs(
        predDiff
      ),

    offenseSpread:
      SR21_avgAvailable([
        awayF?.offenseWindowSpread ??
          null,
        homeF?.offenseWindowSpread ??
          null,
      ]),

    defenseSpread:
      SR21_avgAvailable([
        awayF?.defenseWindowSpread ??
          null,
        homeF?.defenseWindowSpread ??
          null,
      ]),

    offenseShift:
      SR21_avgAvailable([
        awayF?.recentOffenseShift ??
          null,
        homeF?.recentOffenseShift ??
          null,
      ]),

    defenseShift:
      SR21_avgAvailable([
        awayF?.recentDefenseShift ??
          null,
        homeF?.recentDefenseShift ??
          null,
      ]),

    venueOffenseGap:
      SR21_avgAvailable([
        awayF?.venueOffenseGap ??
          null,
        homeF?.venueOffenseGap ??
          null,
      ]),

    venueDefenseGap:
      SR21_avgAvailable([
        awayF?.venueDefenseGap ??
          null,
        homeF?.venueDefenseGap ??
          null,
      ]),

    restGap,

    sampleGames:
      SR21_avgAvailable([
        awayF?.seasonGames ??
          null,
        homeF?.seasonGames ??
          null,
      ]),
  };
}


const SR21_ROWS =
  games
    .map(
      SR21_row
    )
    .filter(Boolean);


function SR21_mean(
  rows,
  key
) {
  const values =
    rows
      .map(
        row =>
          SR21_num(
            row[key]
          )
      )
      .filter(
        value =>
          value !== null
      );

  if (!values.length) {
    return null;
  }

  return (
    values.reduce(
      (a, b) =>
        a + b,
      0
    ) /
    values.length
  );
}


function SR21_stat(
  rows
) {
  return {
    n:
      rows.length,

    teamMAE:
      SR21_mean(
        rows,
        "teamErr"
      ),

    totalMAE:
      SR21_mean(
        rows,
        "totalErr"
      ),

    diffMAE:
      SR21_mean(
        rows,
        "diffErr"
      ),
  };
}


function SR21_printStat(
  name,
  rows
) {
  const s =
    SR21_stat(
      rows
    );

  console.log(
    `${name} ` +
    `N=${s.n} ` +
    `TEAM=${
      s.teamMAE === null
        ? "NA"
        : s.teamMAE.toFixed(3)
    } ` +
    `TOTAL=${
      s.totalMAE === null
        ? "NA"
        : s.totalMAE.toFixed(3)
    } ` +
    `DIFF=${
      s.diffMAE === null
        ? "NA"
        : s.diffMAE.toFixed(3)
    }`
  );
}


console.log();
console.log(
  "===== SR21 BASE REPRO ====="
);

for (
  const split
  of [
    "DISCOVERY",
    "INTERNAL",
  ]
) {
  SR21_printStat(
    split,
    SR21_ROWS.filter(
      row =>
        row.split === split
    )
  );
}


/*
==================================================
ERROR BUCKETS
==================================================
*/

console.log();
console.log(
  "===== SR21 ERROR BUCKETS ====="
);

const SR21_ERROR_BUCKETS = [
  [
    "ERR_LT_1.5",
    0,
    1.5,
  ],
  [
    "ERR_1.5_2.5",
    1.5,
    2.5,
  ],
  [
    "ERR_2.5_3.5",
    2.5,
    3.5,
  ],
  [
    "ERR_3.5_5.0",
    3.5,
    5.0,
  ],
  [
    "ERR_5_PLUS",
    5.0,
    Infinity,
  ],
];

for (
  const [
    name,
    lo,
    hi,
  ]
  of SR21_ERROR_BUCKETS
) {
  const rows =
    SR21_ROWS.filter(
      row =>
        row.teamErr >= lo &&
        row.teamErr < hi
    );

  console.log();
  SR21_printStat(
    name,
    rows
  );

  console.log(
    "  offenseSpread=",
    SR21_mean(
      rows,
      "offenseSpread"
    )?.toFixed(3) ??
      "NA",

    "defenseSpread=",
    SR21_mean(
      rows,
      "defenseSpread"
    )?.toFixed(3) ??
      "NA",

    "offenseShift=",
    SR21_mean(
      rows,
      "offenseShift"
    )?.toFixed(3) ??
      "NA",

    "defenseShift=",
    SR21_mean(
      rows,
      "defenseShift"
    )?.toFixed(3) ??
      "NA",

    "venueOffGap=",
    SR21_mean(
      rows,
      "venueOffenseGap"
    )?.toFixed(3) ??
      "NA",

    "venueDefGap=",
    SR21_mean(
      rows,
      "venueDefenseGap"
    )?.toFixed(3) ??
      "NA",

    "restGap=",
    SR21_mean(
      rows,
      "restGap"
    )?.toFixed(3) ??
      "NA"
  );
}


/*
==================================================
FEATURE QUARTILE-LIKE BANDS
Use fixed interpretable thresholds only.
No tuning.
==================================================
*/

function SR21_featureBands(
  title,
  key,
  bands
) {
  console.log();
  console.log(
    `===== SR21 ${title} =====`
  );

  for (
    const [
      name,
      lo,
      hi,
    ]
    of bands
  ) {
    const rows =
      SR21_ROWS.filter(
        row => {
          const value =
            SR21_num(
              row[key]
            );

          return (
            value !== null &&
            value >= lo &&
            value < hi
          );
        }
      );

    SR21_printStat(
      name,
      rows
    );
  }
}


SR21_featureBands(
  "OFFENSE WINDOW SPREAD",
  "offenseSpread",
  [
    [
      "OFF_SPREAD_LT_0.5",
      0,
      0.5,
    ],
    [
      "OFF_SPREAD_0.5_1.0",
      0.5,
      1.0,
    ],
    [
      "OFF_SPREAD_1.0_1.5",
      1.0,
      1.5,
    ],
    [
      "OFF_SPREAD_1.5_PLUS",
      1.5,
      Infinity,
    ],
  ]
);


SR21_featureBands(
  "DEFENSE WINDOW SPREAD",
  "defenseSpread",
  [
    [
      "DEF_SPREAD_LT_0.5",
      0,
      0.5,
    ],
    [
      "DEF_SPREAD_0.5_1.0",
      0.5,
      1.0,
    ],
    [
      "DEF_SPREAD_1.0_1.5",
      1.0,
      1.5,
    ],
    [
      "DEF_SPREAD_1.5_PLUS",
      1.5,
      Infinity,
    ],
  ]
);


SR21_featureBands(
  "RECENT OFFENSE SHIFT",
  "offenseShift",
  [
    [
      "OFF_SHIFT_LT_0.5",
      0,
      0.5,
    ],
    [
      "OFF_SHIFT_0.5_1.0",
      0.5,
      1.0,
    ],
    [
      "OFF_SHIFT_1.0_1.5",
      1.0,
      1.5,
    ],
    [
      "OFF_SHIFT_1.5_PLUS",
      1.5,
      Infinity,
    ],
  ]
);


SR21_featureBands(
  "RECENT DEFENSE SHIFT",
  "defenseShift",
  [
    [
      "DEF_SHIFT_LT_0.5",
      0,
      0.5,
    ],
    [
      "DEF_SHIFT_0.5_1.0",
      0.5,
      1.0,
    ],
    [
      "DEF_SHIFT_1.0_1.5",
      1.0,
      1.5,
    ],
    [
      "DEF_SHIFT_1.5_PLUS",
      1.5,
      Infinity,
    ],
  ]
);


SR21_featureBands(
  "VENUE OFFENSE GAP",
  "venueOffenseGap",
  [
    [
      "VENUE_OFF_LT_0.5",
      0,
      0.5,
    ],
    [
      "VENUE_OFF_0.5_1.0",
      0.5,
      1.0,
    ],
    [
      "VENUE_OFF_1.0_1.5",
      1.0,
      1.5,
    ],
    [
      "VENUE_OFF_1.5_PLUS",
      1.5,
      Infinity,
    ],
  ]
);


SR21_featureBands(
  "VENUE DEFENSE GAP",
  "venueDefenseGap",
  [
    [
      "VENUE_DEF_LT_0.5",
      0,
      0.5,
    ],
    [
      "VENUE_DEF_0.5_1.0",
      0.5,
      1.0,
    ],
    [
      "VENUE_DEF_1.0_1.5",
      1.0,
      1.5,
    ],
    [
      "VENUE_DEF_1.5_PLUS",
      1.5,
      Infinity,
    ],
  ]
);


SR21_featureBands(
  "REST GAP",
  "restGap",
  [
    [
      "REST_GAP_0",
      0,
      0.5,
    ],
    [
      "REST_GAP_1",
      0.5,
      1.5,
    ],
    [
      "REST_GAP_2_PLUS",
      1.5,
      Infinity,
    ],
  ]
);


SR21_featureBands(
  "PREDICTED TOTAL",
  "predTotal",
  [
    [
      "PRED_TOTAL_LT_8",
      0,
      8,
    ],
    [
      "PRED_TOTAL_8_9",
      8,
      9,
    ],
    [
      "PRED_TOTAL_9_10",
      9,
      10,
    ],
    [
      "PRED_TOTAL_10_PLUS",
      10,
      Infinity,
    ],
  ]
);


SR21_featureBands(
  "PREDICTED MARGIN",
  "predMargin",
  [
    [
      "PRED_MARGIN_LT_0.5",
      0,
      0.5,
    ],
    [
      "PRED_MARGIN_0.5_1.0",
      0.5,
      1.0,
    ],
    [
      "PRED_MARGIN_1.0_1.5",
      1.0,
      1.5,
    ],
    [
      "PRED_MARGIN_1.5_PLUS",
      1.5,
      Infinity,
    ],
  ]
);


/*
==================================================
DISCOVERY vs INTERNAL feature direction
==================================================
*/

console.log();
console.log(
  "===== SR21 D/I HIGH-RISK CHECK ====="
);

const SR21_RISK_RULES = [
  [
    "OFF_SPREAD>=1.0",
    row =>
      (
        SR21_num(
          row.offenseSpread
        ) ?? -1
      ) >= 1.0,
  ],

  [
    "DEF_SPREAD>=1.0",
    row =>
      (
        SR21_num(
          row.defenseSpread
        ) ?? -1
      ) >= 1.0,
  ],

  [
    "OFF_SHIFT>=1.0",
    row =>
      (
        SR21_num(
          row.offenseShift
        ) ?? -1
      ) >= 1.0,
  ],

  [
    "DEF_SHIFT>=1.0",
    row =>
      (
        SR21_num(
          row.defenseShift
        ) ?? -1
      ) >= 1.0,
  ],

  [
    "VENUE_OFF>=1.0",
    row =>
      (
        SR21_num(
          row.venueOffenseGap
        ) ?? -1
      ) >= 1.0,
  ],

  [
    "VENUE_DEF>=1.0",
    row =>
      (
        SR21_num(
          row.venueDefenseGap
        ) ?? -1
      ) >= 1.0,
  ],

  [
    "REST_GAP>=2",
    row =>
      (
        SR21_num(
          row.restGap
        ) ?? -1
      ) >= 2.0,
  ],
];


for (
  const [
    name,
    fn,
  ]
  of SR21_RISK_RULES
) {
  console.log();
  console.log(
    `--- ${name} ---`
  );

  for (
    const split
    of [
      "DISCOVERY",
      "INTERNAL",
    ]
  ) {
    const rows =
      SR21_ROWS.filter(
        row =>
          row.split === split &&
          fn(
            row
          )
      );

    SR21_printStat(
      split,
      rows
    );
  }
}


/*
==================================================
WORST GAMES
==================================================
*/

console.log();
console.log(
  "===== SR21 WORST 25 ====="
);

const SR21_WORST =
  [
    ...SR21_ROWS
  ]
    .sort(
      (
        a,
        b
      ) =>
        b.teamErr -
        a.teamErr
    )
    .slice(
      0,
      25
    );

for (
  const row
  of SR21_WORST
) {
  console.log(
    row.split,
    row.date,
    row.gameId,
    `${row.awayTeam}@${row.homeTeam}`,
    `PRED=${row.predAway.toFixed(1)}:${row.predHome.toFixed(1)}`,
    `ACTUAL=${row.actualAway}:${row.actualHome}`,
    `TEAM_ERR=${row.teamErr.toFixed(3)}`,
    `OFF_SP=${row.offenseSpread?.toFixed(2) ?? "NA"}`,
    `DEF_SP=${row.defenseSpread?.toFixed(2) ?? "NA"}`,
    `OFF_SHIFT=${row.offenseShift?.toFixed(2) ?? "NA"}`,
    `DEF_SHIFT=${row.defenseShift?.toFixed(2) ?? "NA"}`,
    `VEN_OFF=${row.venueOffenseGap?.toFixed(2) ?? "NA"}`,
    `VEN_DEF=${row.venueDefenseGap?.toFixed(2) ?? "NA"}`,
    `REST_GAP=${row.restGap?.toFixed(1) ?? "NA"}`
  );
}


console.log();
console.log(
  "SCORE ROUND21 MODEL CHANGE: NO"
);

console.log(
  "SCORE ROUND21 FINAL/AUDIT: NOT EVALUATED"
);


/*
==================================================
SCORE MODEL ROUND 22
VENUE SAMPLE RELIABILITY DIAGNOSTIC

BASE:
  Frozen V0.7 Round7

NO MODEL CHANGE.
NO TUNING.
NO FINAL/AUDIT.

Question:
  Are home/away split features unreliable
  when venue sample size is very small?
==================================================
*/

console.log();
console.log(
  "=================================================="
);
console.log(
  "SCORE ROUND22 — VENUE SAMPLE RELIABILITY"
);
console.log(
  "=================================================="
);


function SR22_num(
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


const SR22_ROWS =
  SR21_ROWS.map(
    row => {
      const x =
        v06Map.get(
          row.gameId
        );

      if (!x) {
        return null;
      }

      const awayForm =
        x.awayTeamForm;

      const homeForm =
        x.homeTeamForm;

      const awayVenueGames =
        SR22_num(
          awayForm?.awayGames
        );

      const homeVenueGames =
        SR22_num(
          homeForm?.homeGames
        );

      const minVenueGames =
        (
          awayVenueGames !== null &&
          homeVenueGames !== null
        )
          ? Math.min(
              awayVenueGames,
              homeVenueGames
            )
          : null;

      const avgVenueGames =
        (
          awayVenueGames !== null &&
          homeVenueGames !== null
        )
          ? (
              awayVenueGames +
              homeVenueGames
            ) / 2
          : null;

      return {
        ...row,

        awayVenueGames,
        homeVenueGames,
        minVenueGames,
        avgVenueGames,
      };
    }
  )
  .filter(Boolean);


function SR22_mean(
  rows,
  key
) {
  const values =
    rows
      .map(
        row =>
          SR22_num(
            row[key]
          )
      )
      .filter(
        value =>
          value !== null
      );

  if (!values.length) {
    return null;
  }

  return (
    values.reduce(
      (a, b) =>
        a + b,
      0
    ) /
    values.length
  );
}


function SR22_print(
  name,
  rows
) {
  console.log(
    `${name} ` +
    `N=${rows.length} ` +
    `TEAM=${
      SR22_mean(
        rows,
        "teamErr"
      )?.toFixed(3) ??
      "NA"
    } ` +
    `TOTAL=${
      SR22_mean(
        rows,
        "totalErr"
      )?.toFixed(3) ??
      "NA"
    } ` +
    `DIFF=${
      SR22_mean(
        rows,
        "diffErr"
      )?.toFixed(3) ??
      "NA"
    } ` +
    `VEN_OFF=${
      SR22_mean(
        rows,
        "venueOffenseGap"
      )?.toFixed(3) ??
      "NA"
    } ` +
    `VEN_DEF=${
      SR22_mean(
        rows,
        "venueDefenseGap"
      )?.toFixed(3) ??
      "NA"
    }`
  );
}


/*
==================================================
BASE
==================================================
*/

console.log();
console.log(
  "===== SR22 BASE ====="
);

for (
  const split
  of [
    "DISCOVERY",
    "INTERNAL",
  ]
) {
  SR22_print(
    split,
    SR22_ROWS.filter(
      row =>
        row.split === split
    )
  );
}


/*
==================================================
MIN VENUE GAMES
==================================================
*/

console.log();
console.log(
  "===== SR22 MIN VENUE SAMPLE ====="
);

const SR22_BANDS = [
  [
    "MIN_0",
    0,
    1,
  ],
  [
    "MIN_1",
    1,
    2,
  ],
  [
    "MIN_2",
    2,
    3,
  ],
  [
    "MIN_3_4",
    3,
    5,
  ],
  [
    "MIN_5_9",
    5,
    10,
  ],
  [
    "MIN_10_PLUS",
    10,
    Infinity,
  ],
];

for (
  const [
    name,
    lo,
    hi,
  ]
  of SR22_BANDS
) {
  const rows =
    SR22_ROWS.filter(
      row => {
        const n =
          SR22_num(
            row.minVenueGames
          );

        return (
          n !== null &&
          n >= lo &&
          n < hi
        );
      }
    );

  SR22_print(
    name,
    rows
  );
}


/*
==================================================
THRESHOLD VIEW
==================================================
*/

console.log();
console.log(
  "===== SR22 VENUE SAMPLE THRESHOLDS ====="
);

for (
  const threshold
  of [
    1,
    2,
    3,
    4,
    5,
    7,
    10,
  ]
) {
  const low =
    SR22_ROWS.filter(
      row =>
        (
          SR22_num(
            row.minVenueGames
          ) ?? 999
        ) <
        threshold
    );

  const high =
    SR22_ROWS.filter(
      row =>
        (
          SR22_num(
            row.minVenueGames
          ) ?? -1
        ) >=
        threshold
    );

  console.log();
  console.log(
    `--- THRESHOLD ${threshold} ---`
  );

  SR22_print(
    `<${threshold}`,
    low
  );

  SR22_print(
    `>=${threshold}`,
    high
  );
}


/*
==================================================
DISCOVERY / INTERNAL DIRECTION
==================================================
*/

console.log();
console.log(
  "===== SR22 D/I SAMPLE CHECK ====="
);

for (
  const threshold
  of [
    2,
    3,
    5,
  ]
) {
  console.log();
  console.log(
    `--- MIN VENUE < ${threshold} ---`
  );

  for (
    const split
    of [
      "DISCOVERY",
      "INTERNAL",
    ]
  ) {
    SR22_print(
      split,
      SR22_ROWS.filter(
        row =>
          row.split === split &&
          (
            SR22_num(
              row.minVenueGames
            ) ?? 999
          ) <
            threshold
      )
    );
  }

  console.log(
    `--- MIN VENUE >= ${threshold} ---`
  );

  for (
    const split
    of [
      "DISCOVERY",
      "INTERNAL",
    ]
  ) {
    SR22_print(
      split,
      SR22_ROWS.filter(
        row =>
          row.split === split &&
          (
            SR22_num(
              row.minVenueGames
            ) ?? -1
          ) >=
            threshold
      )
    );
  }
}


/*
==================================================
EARLY EXTREME VENUE GAP
==================================================
*/

console.log();
console.log(
  "===== SR22 EXTREME VENUE GAP ====="
);

for (
  const threshold
  of [
    1.0,
    1.5,
    2.0,
    3.0,
    5.0,
  ]
) {
  const rows =
    SR22_ROWS.filter(
      row =>
        (
          (
            SR22_num(
              row.venueOffenseGap
            ) ?? 0
          ) >= threshold
        ) ||
        (
          (
            SR22_num(
              row.venueDefenseGap
            ) ?? 0
          ) >= threshold
        )
    );

  SR22_print(
    `VEN_GAP>=${threshold.toFixed(1)}`,
    rows
  );
}


/*
==================================================
LOW SAMPLE + EXTREME GAP
==================================================
*/

console.log();
console.log(
  "===== SR22 LOW SAMPLE + EXTREME GAP ====="
);

for (
  const sample
  of [
    2,
    3,
    5,
  ]
) {
  const rows =
    SR22_ROWS.filter(
      row =>
        (
          SR22_num(
            row.minVenueGames
          ) ?? 999
        ) <
          sample &&
        (
          (
            SR22_num(
              row.venueOffenseGap
            ) ?? 0
          ) >= 1.5 ||
          (
            SR22_num(
              row.venueDefenseGap
            ) ?? 0
          ) >= 1.5
        )
    );

  SR22_print(
    `MIN<${sample} + GAP>=1.5`,
    rows
  );
}


/*
==================================================
WORST LOW-SAMPLE VENUE GAMES
==================================================
*/

console.log();
console.log(
  "===== SR22 WORST LOW-SAMPLE 20 ====="
);

const SR22_worst =
  SR22_ROWS
    .filter(
      row =>
        (
          SR22_num(
            row.minVenueGames
          ) ?? 999
        ) < 5
    )
    .sort(
      (
        a,
        b
      ) =>
        b.teamErr -
        a.teamErr
    )
    .slice(
      0,
      20
    );

for (
  const row
  of SR22_worst
) {
  console.log(
    row.split,
    row.date,
    row.gameId,
    `${row.awayTeam}@${row.homeTeam}`,
    `MIN_VEN=${row.minVenueGames}`,
    `A_VEN=${row.awayVenueGames}`,
    `H_VEN=${row.homeVenueGames}`,
    `VEN_OFF=${row.venueOffenseGap?.toFixed(2) ?? "NA"}`,
    `VEN_DEF=${row.venueDefenseGap?.toFixed(2) ?? "NA"}`,
    `TEAM_ERR=${row.teamErr.toFixed(3)}`
  );
}


console.log();
console.log(
  "SCORE ROUND22 MODEL CHANGE: NO"
);

console.log(
  "SCORE ROUND22 FINAL/AUDIT: NOT EVALUATED"
);

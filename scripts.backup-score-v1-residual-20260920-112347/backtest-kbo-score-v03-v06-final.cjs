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

console.log(
  "FINAL HOLDOUT: NOT TOUCHED"
);

/*
 * =========================================================
 * ROUND 3 — SINGLE FEATURE ROBUST SCREEN
 * BASE = EXACT V0.3 CHAMPION
 * FINAL HOLDOUT MUST REMAIN LOCKED
 * =========================================================
 */

function featurePair(v, path) {
  const parts = path.split(".");

  let cur = v;

  for (const p of parts) {
    if (
      cur === null ||
      cur === undefined
    ) {
      return null;
    }

    cur = cur[p];
  }

  return num(cur);
}

function evaluatePredictor(
  split,
  predictor
) {
  let n = 0;
  let teamErr = 0;
  let totalErr = 0;
  let diffErr = 0;
  let winnerHit = 0;
  let winnerN = 0;

  for (const g of games) {
    if (splitOf(g) !== split)
      continue;

    const p = predictor(g);

    if (!p)
      continue;

    const aa = Number(g.awayScore);
    const ah = Number(g.homeScore);

    const ae =
      Math.abs(p.away - aa);

    const he =
      Math.abs(p.home - ah);

    teamErr += (ae + he) / 2;

    totalErr +=
      Math.abs(
        p.away +
        p.home -
        aa -
        ah
      );

    diffErr +=
      Math.abs(
        (
          p.away -
          p.home
        ) -
        (
          aa -
          ah
        )
      );

    const pd =
      p.away - p.home;

    const ad =
      aa - ah;

    if (
      pd !== 0 &&
      ad !== 0
    ) {
      winnerN++;

      if (
        Math.sign(pd) ===
        Math.sign(ad)
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
    winnerAcc:
      winnerN
        ? winnerHit / winnerN
        : null
  };
}

/*
 * 모든 보정은 기본적으로
 * 상대적인 AWAY-HOME 차이를 이용한다.
 *
 * shift > 0:
 * away 예상득점 증가,
 * home 예상득점 감소.
 *
 * 따라서 총점은 가능한 한 유지하고
 * 승패/점수차 방향만 조정한다.
 */
const FEATURES = [

  /*
   * 최근 팀 득실
   */
  {
    name: "RECENT5_RUNS",
    away:
      "awayTeamForm.recent5.avgRuns",
    home:
      "homeTeamForm.recent5.avgRuns",
    scale: 1
  },

  {
    name: "RECENT5_ALLOWED",
    away:
      "awayTeamForm.recent5.avgRunsAllowed",
    home:
      "homeTeamForm.recent5.avgRunsAllowed",
    scale: -1
  },

  {
    name: "RECENT10_RUNS",
    away:
      "awayTeamForm.recent10.avgRuns",
    home:
      "homeTeamForm.recent10.avgRuns",
    scale: 1
  },

  {
    name: "RECENT10_ALLOWED",
    away:
      "awayTeamForm.recent10.avgRunsAllowed",
    home:
      "homeTeamForm.recent10.avgRunsAllowed",
    scale: -1
  },

  {
    name: "RECENT20_RUNS",
    away:
      "awayTeamForm.recent20.avgRuns",
    home:
      "homeTeamForm.recent20.avgRuns",
    scale: 1
  },

  /*
   * 선발
   * 투수 수치는 낮을수록 좋으므로 scale=-1
   */
  {
    name: "STARTER_ERA",
    away:
      "starter.away.era",
    home:
      "starter.home.era",
    scale: -1
  },

  {
    name: "STARTER_WHIP",
    away:
      "starter.away.whip",
    home:
      "starter.home.whip",
    scale: -1
  },

  {
    name: "STARTER_RECENT5_ERA",
    away:
      "starter.away.recent5.era",
    home:
      "starter.home.recent5.era",
    scale: -1
  },

  {
    name: "STARTER_RECENT5_WHIP",
    away:
      "starter.away.recent5.whip",
    home:
      "starter.home.recent5.whip",
    scale: -1
  },

  {
    name: "STARTER_KBB",
    away:
      "starter.away.recent5.kbb",
    home:
      "starter.home.recent5.kbb",
    scale: 1
  },

  /*
   * 라인업
   */
  {
    name: "LINEUP_OPS",
    away:
      "lineup.away.avgOps",
    home:
      "lineup.home.avgOps",
    scale: 1
  },

  {
    name: "LINEUP_OBP",
    away:
      "lineup.away.avgObp",
    home:
      "lineup.home.avgObp",
    scale: 1
  },

  {
    name: "LINEUP_SLG",
    away:
      "lineup.away.avgSlg",
    home:
      "lineup.home.avgSlg",
    scale: 1
  },

  /*
   * 불펜 피로도:
   * 높을수록 상대 공격에 유리.
   * awayFatigue는 away 투수진이므로
   * home 쪽에 유리하다.
   */
  {
    name: "BULLPEN_FATIGUE",
    away:
      "bullpen.homeFatigue",
    home:
      "bullpen.awayFatigue",
    scale: 1
  },

  /*
   * 상대 선발 상대 득점
   */
  {
    name: "VS_STARTER",
    away:
      "vsStarter.awayVsHomeStarter.avgRuns",
    home:
      "vsStarter.homeVsAwayStarter.avgRuns",
    scale: 1
  },

  /*
   * 홈/원정 환경 성적
   */
  {
    name: "VENUE_RUNS",
    away:
      "awayTeamForm.awayAvgRuns",
    home:
      "homeTeamForm.homeAvgRuns",
    scale: 1
  },

  /*
   * 휴식
   */
  {
    name: "REST_DAYS",
    away:
      "awayTeamForm.restDays",
    home:
      "homeTeamForm.restDays",
    scale: 1
  }
];

/*
 * 작은 계수만 스크리닝.
 * 0은 exact reproduction 확인용.
 */
const COEFS = [
  -0.50,
  -0.25,
  -0.10,
  -0.05,
   0,
   0.05,
   0.10,
   0.25,
   0.50
];

const BASE_D =
  evaluatePredictor(
    "DISCOVERY",
    champion
  );

const BASE_I =
  evaluatePredictor(
    "INTERNAL",
    champion
  );

const BASE_AVG =
  (
    BASE_D.teamMAE +
    BASE_I.teamMAE
  ) / 2;

console.log();
console.log(
  "===== ROUND 3 BASELINE ====="
);

console.log(
  "DISCOVERY:",
  BASE_D
);

console.log(
  "INTERNAL:",
  BASE_I
);

console.log(
  "AVG TEAM MAE:",
  BASE_AVG
);

console.log(
  "TARGET:",
  TARGET
);

console.log(
  "REPRO DELTA:",
  BASE_AVG - TARGET
);

const results = [];

for (const f of FEATURES) {

  for (const coef of COEFS) {

    const predictor =
      (g) => {

        const base =
          champion(g);

        if (!base)
          return null;

        if (coef === 0)
          return base;

        const extra =
          v06Map.get(
            g.gameId
          );

        if (!extra)
          return base;

        const av =
          featurePair(
            extra,
            f.away
          );

        const hv =
          featurePair(
            extra,
            f.home
          );

        /*
         * 피처가 없는 경기는
         * 표본에서 제거하지 않고
         * V0.3 baseline 그대로 유지.
         */
        if (
          av === null ||
          hv === null
        ) {
          return base;
        }

        let delta =
          (av - hv) *
          f.scale;

        /*
         * 극단값 하나가 결과를 지배하지 않도록
         * raw feature difference만 제한.
         */
        delta =
          clamp(
            delta,
            -5,
            5
          );

        const shift =
          delta * coef;

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
      };

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

    results.push({
      feature: f.name,
      coef,
      d,
      i,
      avgTeamMAE: avg,
      avgDelta:
        avg - BASE_AVG,
      discoveryDelta:
        d.teamMAE -
        BASE_D.teamMAE,
      internalDelta:
        i.teamMAE -
        BASE_I.teamMAE
    });
  }
}

console.log();
console.log(
  "===== ZERO COEF REPRO CHECK ====="
);

for (const f of FEATURES) {

  const r =
    results.find(
      x =>
        x.feature === f.name &&
        x.coef === 0
    );

  console.log(
    f.name,
    "AVG=",
    r.avgTeamMAE,
    "DELTA=",
    r.avgDelta
  );
}

/*
 * 각 family에서 D/I 양쪽 모두 개선한
 * 최선의 coefficient만 추출.
 */
const familyBest = [];

for (const f of FEATURES) {

  const robust =
    results
      .filter(
        x =>
          x.feature === f.name &&
          x.coef !== 0 &&
          x.discoveryDelta < 0 &&
          x.internalDelta < 0
      )
      .sort(
        (a,b) =>
          a.avgTeamMAE -
          b.avgTeamMAE
      );

  if (robust.length)
    familyBest.push(
      robust[0]
    );
}

familyBest.sort(
  (a,b) =>
    a.avgTeamMAE -
    b.avgTeamMAE
);

console.log();
console.log(
  "===== ROBUST FAMILY BEST ====="
);

if (!familyBest.length) {
  console.log(
    "NO ROBUST SINGLE FEATURE"
  );
}

for (const r of familyBest) {

  console.log();
  console.log(
    r.feature,
    "coef=",
    r.coef
  );

  console.log(
    " D",
    "n=" + r.d.n,
    "team=" +
      r.d.teamMAE.toFixed(6),
    "delta=" +
      r.discoveryDelta.toFixed(6),
    "diff=" +
      r.d.diffMAE.toFixed(6),
    "W=" +
      (
        r.d.winnerAcc * 100
      ).toFixed(1) +
      "%"
  );

  console.log(
    " I",
    "n=" + r.i.n,
    "team=" +
      r.i.teamMAE.toFixed(6),
    "delta=" +
      r.internalDelta.toFixed(6),
    "diff=" +
      r.i.diffMAE.toFixed(6),
    "W=" +
      (
        r.i.winnerAcc * 100
      ).toFixed(1) +
      "%"
  );

  console.log(
    " AVG=" +
      r.avgTeamMAE.toFixed(6),
    "DELTA=" +
      r.avgDelta.toFixed(6)
  );
}

console.log();
console.log(
  "===== TOP 20 ALL NONZERO ====="
);

for (
  const r of results
    .filter(x => x.coef !== 0)
    .sort(
      (a,b) =>
        a.avgTeamMAE -
        b.avgTeamMAE
    )
    .slice(0,20)
) {
  console.log(
    r.feature,
    "coef=" + r.coef,
    "AVG=" +
      r.avgTeamMAE.toFixed(6),
    "DΔ=" +
      r.discoveryDelta.toFixed(6),
    "IΔ=" +
      r.internalDelta.toFixed(6)
  );
}

console.log();
console.log("===== ROUND 4 COMBINATION =====");

const R4 = [
  ["BASE", []],
  ["R5", [
    ["awayTeamForm.recent5.avgRunsAllowed",
     "homeTeamForm.recent5.avgRunsAllowed", -1, -0.25]
  ]],
  ["R5+VENUE", [
    ["awayTeamForm.recent5.avgRunsAllowed",
     "homeTeamForm.recent5.avgRunsAllowed", -1, -0.25],
    ["awayTeamForm.awayAvgRuns",
     "homeTeamForm.homeAvgRuns", 1, -0.10]
  ]],
  ["R5+R20", [
    ["awayTeamForm.recent5.avgRunsAllowed",
     "homeTeamForm.recent5.avgRunsAllowed", -1, -0.25],
    ["awayTeamForm.recent20.avgRuns",
     "homeTeamForm.recent20.avgRuns", 1, -0.05]
  ]],
  ["R5+VENUE+R20", [
    ["awayTeamForm.recent5.avgRunsAllowed",
     "homeTeamForm.recent5.avgRunsAllowed", -1, -0.25],
    ["awayTeamForm.awayAvgRuns",
     "homeTeamForm.homeAvgRuns", 1, -0.10],
    ["awayTeamForm.recent20.avgRuns",
     "homeTeamForm.recent20.avgRuns", 1, -0.05]
  ]]
];

const r4Results = [];

for (const [name, fs] of R4) {
  const predictor = g => {
    const base = champion(g);
    if (!base) return null;

    const extra = v06Map.get(g.gameId);
    if (!extra || !fs.length) return base;

    let shift = 0;

    for (const [ap, hp, scale, coef] of fs) {
      const av = featurePair(extra, ap);
      const hv = featurePair(extra, hp);

      if (av === null || hv === null) continue;

      const delta =
        clamp((av - hv) * scale, -5, 5);

      shift += delta * coef;
    }

    return {
      away: clamp(base.away + shift / 2, 1.75, 7.75),
      home: clamp(base.home - shift / 2, 1.75, 7.75)
    };
  };

  const d = evaluatePredictor("DISCOVERY", predictor);
  const i = evaluatePredictor("INTERNAL", predictor);

  const avg = (d.teamMAE + i.teamMAE) / 2;

  r4Results.push({
    name,
    d,
    i,
    avg,
    dDelta: d.teamMAE - BASE_D.teamMAE,
    iDelta: i.teamMAE - BASE_I.teamMAE,
    avgDelta: avg - BASE_AVG
  });
}

for (const r of r4Results) {
  console.log(
    r.name,
    "D=" + r.d.teamMAE.toFixed(6),
    "DΔ=" + r.dDelta.toFixed(6),
    "I=" + r.i.teamMAE.toFixed(6),
    "IΔ=" + r.iDelta.toFixed(6),
    "AVG=" + r.avg.toFixed(6),
    "AVGΔ=" + r.avgDelta.toFixed(6),
    "TOTAL=" +
      ((r.d.totalMAE + r.i.totalMAE) / 2).toFixed(6),
    "DIFF=" +
      ((r.d.diffMAE + r.i.diffMAE) / 2).toFixed(6),
    "W=" +
      (((r.d.winnerAcc + r.i.winnerAcc) / 2) * 100)
        .toFixed(1) + "%"
  );
}

console.log();
console.log("===== ROUND 4 ROBUST =====");

const robust = r4Results
  .filter(r =>
    r.name !== "BASE" &&
    r.dDelta < 0 &&
    r.iDelta < 0
  )
  .sort((a,b) => a.avg - b.avg);

for (const r of robust) {
  console.log(
    r.name,
    "AVG=" + r.avg.toFixed(6),
    "AVGΔ=" + r.avgDelta.toFixed(6)
  );
}

if (robust.length) {
  console.log(
    "BEST:",
    robust[0].name,
    robust[0].avg
  );
} else {
  console.log("BEST: NONE");
}


console.log();

/*
 * ROUND 5
 * Frozen base:
 *   R5_ALLOWED = -0.25
 *   VENUE      = -0.10
 *
 * Test one extra feature at a time.
 * FINAL remains locked.
 */

console.log();
console.log("===== ROUND 5 FROZEN BASE + EXTRA =====");

const R5_BASE_FEATURES = [
  [
    "awayTeamForm.recent5.avgRunsAllowed",
    "homeTeamForm.recent5.avgRunsAllowed",
    -1,
    -0.25
  ],
  [
    "awayTeamForm.awayAvgRuns",
    "homeTeamForm.homeAvgRuns",
    1,
    -0.10
  ]
];

/*
 * Round 3에서 사용했던 feature 이름/경로/계수 후보를
 * 그대로 재사용한다.
 *
 * 즉 새 계수 최적화가 아니라
 * R5+VENUE 위 incremental test.
 */

const R5_CANDIDATE_NAMES = [
  "RECENT5_RUNS",
  "RECENT10_RUNS",
  "RECENT10_ALLOWED",
  "RECENT20_RUNS",
  "RECENT20_ALLOWED",
  "STARTER_ERA",
  "STARTER_WHIP",
  "STARTER_AVG",
  "STARTER_IP",
  "STARTER_KBB",
  "STARTER_QS",
  "BULLPEN",
  "LINEUP_OPS",
  "LINEUP_OBP",
  "LINEUP_SLG",
  "REST"
];

/*
 * Round3에 존재하는 feature grid에서
 * 이름이 같은 후보를 가져온다.
 */
const r3FeatureSource =
  typeof FEATURE_FAMILIES !== "undefined"
    ? FEATURE_FAMILIES
    : (
        typeof FEATURES !== "undefined"
          ? FEATURES
          : null
      );

if (!r3FeatureSource) {
  console.log(
    "ROUND5 FEATURE SOURCE NOT FOUND - SSH SESSION KEPT OPEN"
  );
} else {
  const frozenBasePredictor = g => {
    const base = champion(g);
    if (!base) return null;

    const extra = v06Map.get(g.gameId);
    if (!extra) return base;

    let shift = 0;

    for (const [ap, hp, scale, coef] of R5_BASE_FEATURES) {
      const av = featurePair(extra, ap);
      const hv = featurePair(extra, hp);

      if (av === null || hv === null) continue;

      shift +=
        clamp(
          (av - hv) * scale,
          -5,
          5
        ) * coef;
    }

    return {
      away: clamp(
        base.away + shift / 2,
        1.75,
        7.75
      ),
      home: clamp(
        base.home - shift / 2,
        1.75,
        7.75
      )
    };
  };

  const FROZEN_D =
    evaluatePredictor(
      "DISCOVERY",
      frozenBasePredictor
    );

  const FROZEN_I =
    evaluatePredictor(
      "INTERNAL",
      frozenBasePredictor
    );

  const FROZEN_AVG =
    (
      FROZEN_D.teamMAE +
      FROZEN_I.teamMAE
    ) / 2;

  console.log(
    "FROZEN R5+VENUE",
    "D=" + FROZEN_D.teamMAE,
    "I=" + FROZEN_I.teamMAE,
    "AVG=" + FROZEN_AVG
  );

  console.log(
    "EXPECTED AVG=2.5047742302999376",
    "DELTA=" +
      (
        FROZEN_AVG -
        2.5047742302999376
      )
  );

  /*
   * Normalize Round3 feature definitions.
   */
  const flat = [];

  if (Array.isArray(r3FeatureSource)) {
    for (const x of r3FeatureSource) {
      if (!x) continue;

      if (
        x.name &&
        Array.isArray(x.coefs)
      ) {
        for (const coef of x.coefs) {
          flat.push({
            ...x,
            coef
          });
        }
      } else {
        flat.push(x);
      }
    }
  } else {
    for (const [name, x] of Object.entries(r3FeatureSource)) {
      if (!x) continue;

      if (Array.isArray(x.coefs)) {
        for (const coef of x.coefs) {
          flat.push({
            name,
            ...x,
            coef
          });
        }
      } else {
        flat.push({
          name,
          ...x
        });
      }
    }
  }

  const selected =
    flat.filter(x =>
      R5_CANDIDATE_NAMES.includes(
        String(x.name || "")
      )
    );

  console.log(
    "ROUND5 CANDIDATE DEFINITIONS:",
    selected.length
  );

  const results = [];

  for (const f of selected) {
    const ap =
      f.away ||
      f.awayPath;

    const hp =
      f.home ||
      f.homePath;

    const scale =
      Number.isFinite(Number(f.scale))
        ? Number(f.scale)
        : 1;

    const coef =
      Number(f.coef);

    if (
      !ap ||
      !hp ||
      !Number.isFinite(coef)
    ) {
      continue;
    }

    const predictor = g => {
      const frozen =
        frozenBasePredictor(g);

      if (!frozen) return null;

      const extra =
        v06Map.get(g.gameId);

      if (!extra)
        return frozen;

      const av =
        featurePair(extra, ap);

      const hv =
        featurePair(extra, hp);

      if (
        av === null ||
        hv === null
      ) {
        return frozen;
      }

      const delta =
        clamp(
          (av - hv) * scale,
          -5,
          5
        );

      const shift =
        delta * coef;

      return {
        away: clamp(
          frozen.away +
          shift / 2,
          1.75,
          7.75
        ),
        home: clamp(
          frozen.home -
          shift / 2,
          1.75,
          7.75
        )
      };
    };

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

    results.push({
      name: f.name,
      coef,
      d,
      i,
      avg,
      dDelta:
        d.teamMAE -
        FROZEN_D.teamMAE,
      iDelta:
        i.teamMAE -
        FROZEN_I.teamMAE,
      avgDelta:
        avg -
        FROZEN_AVG,
      avgTotal:
        (
          d.totalMAE +
          i.totalMAE
        ) / 2,
      avgDiff:
        (
          d.diffMAE +
          i.diffMAE
        ) / 2,
      avgWinner:
        (
          d.winnerAcc +
          i.winnerAcc
        ) / 2
    });
  }

  results.sort(
    (a,b) =>
      a.avg -
      b.avg
  );

  console.log();
  console.log(
    "===== ROUND 5 ALL ====="
  );

  for (const r of results) {
    console.log(
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
        r.avgTotal.toFixed(6),
      "DIFF=" +
        r.avgDiff.toFixed(6),
      "W=" +
        (
          r.avgWinner * 100
        ).toFixed(1) +
        "%"
    );
  }

  const robust =
    results.filter(r =>
      r.dDelta < 0 &&
      r.iDelta < 0
    );

  console.log();
  console.log(
    "===== ROUND 5 ROBUST ONLY ====="
  );

  if (!robust.length) {
    console.log(
      "NO ADDITIONAL ROBUST FEATURE"
    );
  }

  for (const r of robust) {
    console.log(
      r.name,
      "coef=" + r.coef,
      "AVG=" +
        r.avg.toFixed(6),
      "AVGΔ=" +
        r.avgDelta.toFixed(6),
      "DΔ=" +
        r.dDelta.toFixed(6),
      "IΔ=" +
        r.iDelta.toFixed(6)
    );
  }

  if (robust.length) {
    console.log();
    console.log(
      "BEST ROUND5:",
      robust[0].name,
      "coef=" + robust[0].coef,
      "AVG=" + robust[0].avg
    );
  }
}

console.log();
console.log(
  "ROUND 5 FINAL HOLDOUT: NOT TOUCHED"
);


/*
 * FINAL HOLDOUT
 *
 * FROZEN BEFORE OPEN:
 *
 * BASE = exact V0.3 champion
 *
 * CHALLENGER =
 *   BASE
 *   + recent5 runs allowed (-0.25)
 *   + venue runs (-0.10)
 *
 * NO TUNING AFTER FINAL.
 */

console.log();
console.log("===== FINAL HOLDOUT OPEN =====");

const FINAL_FROZEN_FEATURES = [
  [
    "awayTeamForm.recent5.avgRunsAllowed",
    "homeTeamForm.recent5.avgRunsAllowed",
    -1,
    -0.25
  ],
  [
    "awayTeamForm.awayAvgRuns",
    "homeTeamForm.homeAvgRuns",
    1,
    -0.10
  ]
];

const finalFrozenPredictor = g => {
  const base = champion(g);

  if (!base) return null;

  const extra =
    v06Map.get(g.gameId);

  if (!extra)
    return base;

  let shift = 0;

  for (
    const [ap, hp, scale, coef]
    of FINAL_FROZEN_FEATURES
  ) {
    const av =
      featurePair(extra, ap);

    const hv =
      featurePair(extra, hp);

    if (
      av === null ||
      hv === null
    ) {
      continue;
    }

    const delta =
      clamp(
        (av - hv) * scale,
        -5,
        5
      );

    shift +=
      delta * coef;
  }

  return {
    away: clamp(
      base.away + shift / 2,
      1.75,
      7.75
    ),
    home: clamp(
      base.home - shift / 2,
      1.75,
      7.75
    )
  };
};

const FINAL_BASE =
  evaluatePredictor(
    "FINAL",
    champion
  );

const FINAL_CHALLENGER =
  evaluatePredictor(
    "FINAL",
    finalFrozenPredictor
  );

function finalSummary(name, x) {
  console.log();
  console.log(name);
  console.log(
    "n=" + x.n
  );
  console.log(
    "teamMAE=" + x.teamMAE
  );
  console.log(
    "totalMAE=" + x.totalMAE
  );
  console.log(
    "diffMAE=" + x.diffMAE
  );
  console.log(
    "within1=" +
      (x.within1 * 100).toFixed(2) +
      "%"
  );
  console.log(
    "within2=" +
      (x.within2 * 100).toFixed(2) +
      "%"
  );
  console.log(
    "winnerAcc=" +
      (x.winnerAcc * 100).toFixed(2) +
      "%"
  );
}

finalSummary(
  "FINAL BASE V0.3",
  FINAL_BASE
);

finalSummary(
  "FINAL R5+VENUE",
  FINAL_CHALLENGER
);

console.log();
console.log(
  "===== FINAL DELTA / CHALLENGER - BASE ====="
);

console.log(
  "teamMAE Δ=" +
  (
    FINAL_CHALLENGER.teamMAE -
    FINAL_BASE.teamMAE
  )
);

console.log(
  "totalMAE Δ=" +
  (
    FINAL_CHALLENGER.totalMAE -
    FINAL_BASE.totalMAE
  )
);

console.log(
  "diffMAE Δ=" +
  (
    FINAL_CHALLENGER.diffMAE -
    FINAL_BASE.diffMAE
  )
);

console.log(
  "within1 Δ=" +
  (
    (
      FINAL_CHALLENGER.within1 -
      FINAL_BASE.within1
    ) * 100
  ).toFixed(2) +
  "pp"
);

console.log(
  "within2 Δ=" +
  (
    (
      FINAL_CHALLENGER.within2 -
      FINAL_BASE.within2
    ) * 100
  ).toFixed(2) +
  "pp"
);

console.log(
  "winnerAcc Δ=" +
  (
    (
      FINAL_CHALLENGER.winnerAcc -
      FINAL_BASE.winnerAcc
    ) * 100
  ).toFixed(2) +
  "pp"
);

console.log();

const finalPass =
  FINAL_CHALLENGER.teamMAE <
  FINAL_BASE.teamMAE;

console.log(
  "FINAL TEAM MAE:",
  finalPass
    ? "PASS"
    : "FAIL"
);

console.log(
  "FROZEN MODEL:",
  "R5_ALLOWED=-0.25 / VENUE_RUNS=-0.10"
);

console.log(
  "IMPORTANT:",
  "FINAL RESULT MUST NOT BE USED FOR RETUNING"
);

console.log(
  "===== FINAL HOLDOUT CLOSED ====="
);


console.log(
  "FINAL HOLDOUT: NOT TOUCHED"
);


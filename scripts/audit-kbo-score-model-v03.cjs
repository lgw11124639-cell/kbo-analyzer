const fs = require("fs");

const BACKTEST =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw = JSON.parse(
  fs.readFileSync(BACKTEST, "utf8")
);

const sourceRows =
  Array.isArray(raw)
    ? raw
    : Array.isArray(raw.results)
      ? raw.results
      : Array.isArray(raw.rows)
        ? raw.rows
        : [];

const num = (v) =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : null;

const clamp = (v, lo, hi) =>
  Math.max(lo, Math.min(hi, v));

const gameKey = (r) =>
  r.gameId ||
  [
    r.date,
    r.awayTeam,
    r.homeTeam
  ].join("|");

/*
  후보 row가 시장별로 여러 개이므로
  실제 경기당 1개만 사용.
*/
const byGame = new Map();

for (const r of sourceRows) {
  if (
    !r.date ||
    num(r.awayScore) === null ||
    num(r.homeScore) === null ||
    !r.scoreModelInputs
  ) {
    continue;
  }

  const key = gameKey(r);

  if (!byGame.has(key)) {
    byGame.set(key, r);
  }
}

const games = [...byGame.values()]
  .sort((a, b) =>
    String(a.date).localeCompare(String(b.date)) ||
    String(gameKey(a)).localeCompare(String(gameKey(b)))
  );

console.log("===== SCORE MODEL V0.3 =====");
console.log("SOURCE ROWS:", sourceRows.length);
console.log("UNIQUE SETTLED GAMES:", games.length);

/*
  ------------------------------------------------------------
  기간 분리

  Discovery : 3~4월
  Internal  : 5~6월
  Final     : 7월 이후

  Final은 모델 선정 전까지 출력하지 않는다.
  ------------------------------------------------------------
*/
function periodOf(date) {
  const month = Number(String(date).slice(5, 7));

  if (month <= 4) return "DISCOVERY";
  if (month <= 6) return "INTERNAL";
  return "FINAL";
}

/*
  ------------------------------------------------------------
  D-1 동적 리그 팀당 평균득점

  같은 날짜 경기 결과는 그 날짜 예측에 절대 사용하지 않는다.

  시즌 초반 과도한 변동 방지:
  prior 4.50점 × 40 team-games를 가상 표본으로 둔다.

  이 prior 강도 자체도 뒤에서 후보 비교한다.
  ------------------------------------------------------------
*/
function buildLeagueAverages(priorGames) {
  const PRIOR_RUNS = 4.50;

  let completedGames = 0;
  let totalRuns = 0;

  const byDate = new Map();

  let i = 0;

  while (i < games.length) {
    const date = games[i].date;

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
        PRIOR_RUNS * priorGames +
        totalRuns
      ) /
      (
        priorGames +
        teamGamesBefore
      );

    byDate.set(date, leagueRuns);

    /*
      날짜의 모든 예측 기준값을 먼저 저장한 뒤
      그 날짜 실제 점수를 누적한다.
    */
    for (let k = i; k < j; k++) {
      totalRuns +=
        games[k].awayScore +
        games[k].homeScore;

      completedGames++;
    }

    i = j;
  }

  return byDate;
}

function blendedEra(season, recent) {
  season = num(season);
  recent = num(recent);

  if (season === null && recent === null)
    return null;

  if (season !== null && recent !== null)
    return season * 0.60 + recent * 0.40;

  return season ?? recent;
}

/*
  현재 V0.2 재현.
*/
function predictV02(g) {
  const x = g.scoreModelInputs;

  const ar = num(x.awayAvgRuns);
  const ara = num(x.awayAvgRunsAllowed);
  const hr = num(x.homeAvgRuns);
  const hra = num(x.homeAvgRunsAllowed);

  if (
    ar === null ||
    ara === null ||
    hr === null ||
    hra === null
  ) {
    return null;
  }

  const league = 4.50;

  const awayRecent =
    (ar + hra) / 2;

  const homeRecent =
    (hr + ara) / 2;

  let away =
    league * 0.45 +
    awayRecent * 0.55;

  let home =
    league * 0.45 +
    homeRecent * 0.55;

  const homeEra = blendedEra(
    x.homeStarterEra,
    x.homeStarterRecent5Era
  );

  const awayEra = blendedEra(
    x.awayStarterEra,
    x.awayStarterRecent5Era
  );

  if (homeEra !== null) {
    away += clamp(
      (homeEra - 4.50) * 0.09,
      -0.40,
      0.40
    );
  }

  if (awayEra !== null) {
    home += clamp(
      (awayEra - 4.50) * 0.09,
      -0.40,
      0.40
    );
  }

  const homeFatigue =
    num(x.homeBullpenFatigue);

  const awayFatigue =
    num(x.awayBullpenFatigue);

  if (homeFatigue !== null) {
    away += clamp(
      (homeFatigue - 50) * 0.003,
      -0.18,
      0.18
    );
  }

  if (awayFatigue !== null) {
    home += clamp(
      (awayFatigue - 50) * 0.003,
      -0.18,
      0.18
    );
  }

  const awayOps =
    num(x.awayLineupOps);

  const homeOps =
    num(x.homeLineupOps);

  if (awayOps !== null) {
    away += clamp(
      (awayOps - 0.750),
      -0.20,
      0.20
    );
  }

  if (homeOps !== null) {
    home += clamp(
      (homeOps - 0.750),
      -0.20,
      0.20
    );
  }

  away = clamp(away, 2.75, 6.25);
  home = clamp(home, 2.75, 6.25);

  const total = clamp(
    away + home,
    6.50,
    12.50
  );

  /*
    total clamp가 걸렸으면 양 팀 비율 유지.
  */
  const rawTotal = away + home;

  if (
    rawTotal > 0 &&
    Math.abs(total - rawTotal) > 1e-9
  ) {
    const scale = total / rawTotal;
    away *= scale;
    home *= scale;
  }

  return { away, home };
}

/*
  ------------------------------------------------------------
  V0.3 후보

  teamWeight:
    개별팀 득실점 반영 강도

  starter / bullpen / lineup은 단계적으로 ON/OFF.

  FORM/market은 다음 단계에서 raw 후보의 기본 성능을
  확인한 뒤 추가한다.
  ------------------------------------------------------------
*/
function predictV03(
  g,
  leagueByDate,
  cfg
) {
  const x = g.scoreModelInputs;

  const ar = num(x.awayAvgRuns);
  const ara = num(x.awayAvgRunsAllowed);
  const hr = num(x.homeAvgRuns);
  const hra = num(x.homeAvgRunsAllowed);

  if (
    ar === null ||
    ara === null ||
    hr === null ||
    hra === null
  ) {
    return null;
  }

  const league =
    leagueByDate.get(g.date);

  if (!Number.isFinite(league))
    return null;

  const awayTeamExpectation =
    (ar + hra) / 2;

  const homeTeamExpectation =
    (hr + ara) / 2;

  let away =
    league * (1 - cfg.teamWeight) +
    awayTeamExpectation * cfg.teamWeight;

  let home =
    league * (1 - cfg.teamWeight) +
    homeTeamExpectation * cfg.teamWeight;

  if (cfg.starter) {
    const homeEra = blendedEra(
      x.homeStarterEra,
      x.homeStarterRecent5Era
    );

    const awayEra = blendedEra(
      x.awayStarterEra,
      x.awayStarterRecent5Era
    );

    /*
      리그 득점환경에 맞춰 ERA 중립점도 이동.
      4.50 고정 기준을 사용하지 않는다.
    */
    const eraNeutral = league;

    if (homeEra !== null) {
      away += clamp(
        (homeEra - eraNeutral) * 0.09,
        -0.40,
        0.40
      );
    }

    if (awayEra !== null) {
      home += clamp(
        (awayEra - eraNeutral) * 0.09,
        -0.40,
        0.40
      );
    }
  }

  if (cfg.bullpen) {
    const homeFatigue =
      num(x.homeBullpenFatigue);

    const awayFatigue =
      num(x.awayBullpenFatigue);

    if (homeFatigue !== null) {
      away += clamp(
        (homeFatigue - 50) * 0.003,
        -0.18,
        0.18
      );
    }

    if (awayFatigue !== null) {
      home += clamp(
        (awayFatigue - 50) * 0.003,
        -0.18,
        0.18
      );
    }
  }

  if (cfg.lineup) {
    const awayOps =
      num(x.awayLineupOps);

    const homeOps =
      num(x.homeLineupOps);

    if (awayOps !== null) {
      away += clamp(
        awayOps - 0.750,
        -0.20,
        0.20
      );
    }

    if (homeOps !== null) {
      home += clamp(
        homeOps - 0.750,
        -0.20,
        0.20
      );
    }
  }

  /*
    동적 리그 환경이 5점대일 수 있으므로
    V0.2의 2.75~6.25보다 약간 넓게 허용.
  */
  away = clamp(away, 2.25, 7.25);
  home = clamp(home, 2.25, 7.25);

  return { away, home };
}

function evaluate(
  predictor,
  period
) {
  let n = 0;

  let teamAbs = 0;
  let totalAbs = 0;
  let diffAbs = 0;

  let within1 = 0;
  let within2 = 0;

  let winnerN = 0;
  let winnerHit = 0;

  for (const g of games) {
    if (periodOf(g.date) !== period)
      continue;

    const p = predictor(g);

    if (!p) continue;

    const actualAway =
      num(g.awayScore);

    const actualHome =
      num(g.homeScore);

    if (
      actualAway === null ||
      actualHome === null
    ) {
      continue;
    }

    n++;

    const awayErr =
      Math.abs(p.away - actualAway);

    const homeErr =
      Math.abs(p.home - actualHome);

    teamAbs +=
      awayErr + homeErr;

    totalAbs +=
      Math.abs(
        (p.away + p.home) -
        (actualAway + actualHome)
      );

    diffAbs +=
      Math.abs(
        (p.away - p.home) -
        (actualAway - actualHome)
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
      actualAway - actualHome;

    if (
      predDiff !== 0 &&
      actualDiff !== 0
    ) {
      winnerN++;

      if (
        Math.sign(predDiff) ===
        Math.sign(actualDiff)
      ) {
        winnerHit++;
      }
    }
  }

  return {
    n,
    teamMAE:
      n ? teamAbs / (n * 2) : null,

    totalMAE:
      n ? totalAbs / n : null,

    diffMAE:
      n ? diffAbs / n : null,

    within1:
      n ? within1 / n : null,

    within2:
      n ? within2 / n : null,

    winnerAcc:
      winnerN
        ? winnerHit / winnerN
        : null
  };
}

function fmt(v, pct = false) {
  if (v === null) return "-";

  return pct
    ? `${(v * 100).toFixed(1)}%`
    : v.toFixed(3);
}

function printResult(
  name,
  discovery,
  internal
) {
  const score =
    discovery.teamMAE !== null &&
    internal.teamMAE !== null
      ? (
          discovery.teamMAE +
          internal.teamMAE
        ) / 2
      : 999;

  console.log(
    [
      name.padEnd(28),
      `D n=${String(discovery.n).padStart(3)}`,
      `team=${fmt(discovery.teamMAE)}`,
      `total=${fmt(discovery.totalMAE)}`,
      `diff=${fmt(discovery.diffMAE)}`,
      `±1=${fmt(discovery.within1,true)}`,
      `±2=${fmt(discovery.within2,true)}`,
      `W=${fmt(discovery.winnerAcc,true)}`,
      " | ",
      `I n=${String(internal.n).padStart(3)}`,
      `team=${fmt(internal.teamMAE)}`,
      `total=${fmt(internal.totalMAE)}`,
      `diff=${fmt(internal.diffMAE)}`,
      `±1=${fmt(internal.within1,true)}`,
      `±2=${fmt(internal.within2,true)}`,
      `W=${fmt(internal.winnerAcc,true)}`,
      `AVG_MAE=${score.toFixed(3)}`
    ].join(" ")
  );

  return score;
}

console.log();
console.log("===== BASELINE =====");

const baselineD =
  evaluate(predictV02, "DISCOVERY");

const baselineI =
  evaluate(predictV02, "INTERNAL");

printResult(
  "V0.2 CURRENT",
  baselineD,
  baselineI
);

console.log();
console.log("===== V0.3 CANDIDATES =====");

const configs = [];

/*
  초반 shrinkage 강도와
  개별 팀 반영 비율만 작은 범위로 비교.

  Final을 보지 않고 선택한다.
*/
for (const priorGames of [20, 40, 80]) {
  const leagueByDate =
    buildLeagueAverages(priorGames);

  for (const teamWeight of [
    0.40,
    0.55,
    0.70
  ]) {
    for (const stage of [
      {
        name: "TEAM",
        starter: false,
        bullpen: false,
        lineup: false
      },
      {
        name: "STARTER",
        starter: true,
        bullpen: false,
        lineup: false
      },
      {
        name: "BULLPEN",
        starter: true,
        bullpen: true,
        lineup: false
      },
      {
        name: "LINEUP",
        starter: true,
        bullpen: true,
        lineup: true
      }
    ]) {
      const cfg = {
        priorGames,
        teamWeight,
        ...stage
      };

      const predictor = (g) =>
        predictV03(
          g,
          leagueByDate,
          cfg
        );

      const d =
        evaluate(
          predictor,
          "DISCOVERY"
        );

      const i =
        evaluate(
          predictor,
          "INTERNAL"
        );

      const score =
        (
          d.teamMAE +
          i.teamMAE
        ) / 2;

      configs.push({
        cfg,
        d,
        i,
        score
      });
    }
  }
}

configs.sort(
  (a, b) =>
    a.score - b.score
);

for (const x of configs.slice(0, 15)) {
  const name =
    `V03 P${x.cfg.priorGames}` +
    ` W${x.cfg.teamWeight}` +
    ` ${x.cfg.name}`;

  printResult(
    name,
    x.d,
    x.i
  );
}


console.log();
console.log("===== V0.3 MARGIN CALIBRATION =====");

/*
  ------------------------------------------------------------
  2차전

  기본 예상 총득점은 건드리지 않는다.

  FORM과 ML 시장확률은
  away/home 사이의 예상 점수차만 이동시킨다.

  따라서:
    away += shift / 2
    home -= shift / 2

  총 예상득점은 그대로 유지된다.
  ------------------------------------------------------------
*/

function noVigMlProb(g) {
  /*
    동일 경기의 ML 양쪽 후보를 원본 row에서 찾는다.
  */
  const rows = sourceRows.filter(
    r =>
      gameKey(r) === gameKey(g) &&
      r.market === "ML" &&
      num(r.odds) !== null &&
      r.odds > 1
  );

  if (rows.length < 2)
    return null;

  const away = rows.find(r =>
    String(r.label || "").startsWith(
      String(g.awayTeam || "")
    )
  );

  const home = rows.find(r =>
    String(r.label || "").startsWith(
      String(g.homeTeam || "")
    )
  );

  if (!away || !home)
    return null;

  const ia = 1 / away.odds;
  const ih = 1 / home.odds;

  return {
    away: ia / (ia + ih),
    home: ih / (ia + ih)
  };
}

function formEdgeOf(g) {
  const rows = sourceRows.filter(
    r => gameKey(r) === gameKey(g)
  );

  const x = rows.find(
    r => num(r.formEdge) !== null
  );

  return x
    ? num(x.formEdge)
    : null;
}

/*
  V3.7에서 검증된 FORM 표준편차를
  "표준화 용도"로만 사용한다.

  예상점수 보정계수는 별도로 검증한다.
*/
const SCORE_FORM_SD =
  17.6689172380097;

function marginAdjustedPredictor(
  basePredictor,
  formRuns,
  marketRuns
) {
  return (g) => {
    const base =
      basePredictor(g);

    if (!base)
      return null;

    let shift = 0;

    const form =
      formEdgeOf(g);

    if (
      formRuns !== 0 &&
      form !== null
    ) {
      const z =
        form / SCORE_FORM_SD;

      shift +=
        clamp(z, -2.5, 2.5) *
        formRuns;
    }

    const market =
      noVigMlProb(g);

    if (
      marketRuns !== 0 &&
      market
    ) {
      /*
        50%를 중심으로 -1 ~ +1 스케일.
        away 우세면 양수.
      */
      const marketEdge =
        (market.away - 0.50) * 2;

      shift +=
        marketEdge *
        marketRuns;
    }

    /*
      점수차만 변경.
      총점 보존.
    */
    let away =
      base.away + shift / 2;

    let home =
      base.home - shift / 2;

    away = clamp(away, 1.75, 7.75);
    home = clamp(home, 1.75, 7.75);

    return {
      away,
      home
    };
  };
}

/*
  1차전 최고 기본형:
  P80 / W0.40 / STARTER

  그리고 현재 V0.2도 같이 margin 보정하여
  어느 베이스가 더 잘 받는지 비교.
*/
const leagueP80 =
  buildLeagueAverages(80);

const v03BaseCfg = {
  priorGames: 80,
  teamWeight: 0.40,
  name: "STARTER",
  starter: true,
  bullpen: false,
  lineup: false
};

const v03BasePredictor =
  g => predictV03(
    g,
    leagueP80,
    v03BaseCfg
  );

const marginResults = [];

for (const base of [
  {
    name: "V02",
    predictor: predictV02
  },
  {
    name: "V03",
    predictor: v03BasePredictor
  }
]) {
  /*
    작은 계수만 비교한다.
    과도한 grid search 방지.
  */
  for (const formRuns of [
    0,
    0.20,
    0.40,
    0.60
  ]) {
    for (const marketRuns of [
      0,
      0.50,
      1.00,
      1.25,
      1.50,
      1.75,
      2.00,
      2.25,
      2.50,
      2.75,
      3.00,
      3.25,
      3.50,
      3.75,
      4.00,
      4.25,
      4.50
    ]) {
      if (
        formRuns === 0 &&
        marketRuns === 0
      ) {
        continue;
      }

      const predictor =
        marginAdjustedPredictor(
          base.predictor,
          formRuns,
          marketRuns
        );

      const d =
        evaluate(
          predictor,
          "DISCOVERY"
        );

      const i =
        evaluate(
          predictor,
          "INTERNAL"
        );

      /*
        점수 MAE를 1순위.
        점수차 MAE를 보조지표로 사용.
      */
      const teamMae =
        (d.teamMAE + i.teamMAE) / 2;

      const diffMae =
        (d.diffMAE + i.diffMAE) / 2;

      marginResults.push({
        base: base.name,
        formRuns,
        marketRuns,
        d,
        i,
        teamMae,
        diffMae
      });
    }
  }
}

marginResults.sort(
  (a, b) =>
    a.teamMae - b.teamMae ||
    a.diffMae - b.diffMae
);

for (
  const x of marginResults.slice(0, 20)
) {
  const name =
    `${x.base}` +
    ` F${x.formRuns}` +
    ` M${x.marketRuns}`;

  printResult(
    name,
    x.d,
    x.i
  );
}

console.log();
console.log(
  "===== BEST MARGIN MODEL ====="
);

const marginBest =
  marginResults[0];

console.log(
  JSON.stringify(
    {
      base:
        marginBest.base,

      formRuns:
        marginBest.formRuns,

      marketRuns:
        marginBest.marketRuns,

      discovery:
        marginBest.d,

      internal:
        marginBest.i,

      avgTeamMAE:
        marginBest.teamMae,

      avgDiffMAE:
        marginBest.diffMae,

      finalOpened: false
    },
    null,
    2
  )
);

console.log(
  "FINAL HOLDOUT: STILL LOCKED"
);


console.log();
console.log("===== BEST DISCOVERY + INTERNAL =====");

const best = configs[0];

console.log(
  JSON.stringify(
    {
      config: best.cfg,
      discovery: best.d,
      internal: best.i,
      /*
        Final 결과는 의도적으로 계산/출력하지 않는다.
      */
      finalOpened: false
    },
    null,
    2
  )
);

console.log();
console.log(
  "FINAL HOLDOUT: LOCKED - 아직 열지 않음"
);

/*
  ============================================================
  V0.3 F0 / M4.5 ERROR AUDIT
  - Discovery + Internal ONLY
  - Final HOLDOUT NEVER OPENED
  - 모델 재튜닝 없음
  ============================================================
*/

console.log();
console.log("============================================================");
console.log(" V0.3 F0 / M4.5 ERROR AUDIT");
console.log(" Discovery + Internal ONLY");
console.log(" FINAL HOLDOUT LOCKED");
console.log("============================================================");

const auditPredictor =
  marginAdjustedPredictor(
    v03BasePredictor,
    0,
    4.5
  );

function auditSplitOf(date) {
  if (date <= "2026-04-30")
    return "DISCOVERY";

  if (date <= "2026-06-30")
    return "INTERNAL";

  return "FINAL";
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bucket(value, rules) {
  if (value === null)
    return "MISSING";

  for (const r of rules) {
    if (value < r.max)
      return r.name;
  }

  return rules[rules.length - 1].last;
}

const auditRows = [];

for (const g of games) {
  const split =
    auditSplitOf(g.date);

  /*
    FINAL은 아예 row 생성 자체를 하지 않는다.
  */
  if (
    split !== "DISCOVERY" &&
    split !== "INTERNAL"
  ) {
    continue;
  }

  const pred =
    auditPredictor(g);

  if (!pred)
    continue;

  const actualAway =
    safeNum(g.awayScore);

  const actualHome =
    safeNum(g.homeScore);

  if (
    actualAway === null ||
    actualHome === null
  ) {
    continue;
  }

  const x =
    g.scoreModelInputs || {};

  const market =
    noVigMlProb(g);

  const awayErr =
    pred.away - actualAway;

  const homeErr =
    pred.home - actualHome;

  const predTotal =
    pred.away + pred.home;

  const actualTotal =
    actualAway + actualHome;

  const predDiff =
    pred.away - pred.home;

  const actualDiff =
    actualAway - actualHome;

  const winnerCorrect =
    actualDiff === 0
      ? null
      : (
          Math.sign(predDiff) ===
          Math.sign(actualDiff)
        );

  auditRows.push({
    split,
    date: g.date,
    gameId: g.gameId,

    awayTeam: g.awayTeam,
    homeTeam: g.homeTeam,

    predAway: pred.away,
    predHome: pred.home,

    actualAway,
    actualHome,

    awayErr,
    homeErr,

    awayAbs:
      Math.abs(awayErr),

    homeAbs:
      Math.abs(homeErr),

    predTotal,
    actualTotal,

    totalErr:
      predTotal - actualTotal,

    totalAbs:
      Math.abs(
        predTotal - actualTotal
      ),

    predDiff,
    actualDiff,

    diffAbs:
      Math.abs(
        predDiff - actualDiff
      ),

    winnerCorrect,

    awayAvgRuns:
      safeNum(x.awayAvgRuns),

    homeAvgRuns:
      safeNum(x.homeAvgRuns),

    awayAvgRunsAllowed:
      safeNum(
        x.awayAvgRunsAllowed
      ),

    homeAvgRunsAllowed:
      safeNum(
        x.homeAvgRunsAllowed
      ),

    awayStarterEra:
      safeNum(
        x.awayStarterEra
      ),

    homeStarterEra:
      safeNum(
        x.homeStarterEra
      ),

    awayStarterRecent5Era:
      safeNum(
        x.awayStarterRecent5Era
      ),

    homeStarterRecent5Era:
      safeNum(
        x.homeStarterRecent5Era
      ),

    awayBullpenFatigue:
      safeNum(
        x.awayBullpenFatigue
      ),

    homeBullpenFatigue:
      safeNum(
        x.homeBullpenFatigue
      ),

    awayLineupOps:
      safeNum(
        x.awayLineupOps
      ),

    homeLineupOps:
      safeNum(
        x.homeLineupOps
      ),

    marketAway:
      market
        ? market.away
        : null,

    marketHome:
      market
        ? market.home
        : null
  });
}

function avg(arr) {
  const xs =
    arr.filter(Number.isFinite);

  if (!xs.length)
    return null;

  return (
    xs.reduce(
      (a, b) => a + b,
      0
    ) / xs.length
  );
}

function pct(v) {
  return v === null
    ? "-"
    : `${(v * 100).toFixed(1)}%`;
}

function metrics(rows) {
  const teamErrors =
    rows.flatMap(r => [
      r.awayAbs,
      r.homeAbs
    ]);

  const winnerRows =
    rows.filter(
      r =>
        r.winnerCorrect !== null
    );

  return {
    n: rows.length,

    teamMAE:
      avg(teamErrors),

    totalMAE:
      avg(
        rows.map(r => r.totalAbs)
      ),

    diffMAE:
      avg(
        rows.map(r => r.diffAbs)
      ),

    meanTotalBias:
      avg(
        rows.map(r => r.totalErr)
      ),

    winnerAccuracy:
      winnerRows.length
        ? (
            winnerRows.filter(
              r => r.winnerCorrect
            ).length /
            winnerRows.length
          )
        : null
  };
}

function printMetrics(
  label,
  rows
) {
  const m =
    metrics(rows);

  console.log(
    label.padEnd(30),
    `n=${String(m.n).padStart(3)}`,
    `team=${m.teamMAE === null ? "-" : m.teamMAE.toFixed(3)}`,
    `total=${m.totalMAE === null ? "-" : m.totalMAE.toFixed(3)}`,
    `diff=${m.diffMAE === null ? "-" : m.diffMAE.toFixed(3)}`,
    `bias=${m.meanTotalBias === null ? "-" : m.meanTotalBias.toFixed(3)}`,
    `W=${pct(m.winnerAccuracy)}`
  );
}

function groupAudit(
  title,
  rows,
  keyFn
) {
  console.log();
  console.log(
    `===== ${title} =====`
  );

  const groups =
    new Map();

  for (const r of rows) {
    const key =
      keyFn(r);

    if (!groups.has(key))
      groups.set(key, []);

    groups.get(key).push(r);
  }

  for (
    const [key, xs]
    of groups
  ) {
    printMetrics(
      String(key),
      xs
    );
  }
}

console.log();
console.log(
  "===== OVERALL ====="
);

printMetrics(
  "DISCOVERY",
  auditRows.filter(
    r =>
      r.split === "DISCOVERY"
  )
);

printMetrics(
  "INTERNAL",
  auditRows.filter(
    r =>
      r.split === "INTERNAL"
  )
);

printMetrics(
  "D + I",
  auditRows
);

/*
  월별
*/
groupAudit(
  "MONTH",
  auditRows,
  r => r.date.slice(0, 7)
);

/*
  실제 총득점
*/
groupAudit(
  "ACTUAL TOTAL RUNS",
  auditRows,
  r =>
    bucket(
      r.actualTotal,
      [
        {
          max: 7,
          name: "LOW <=6"
        },
        {
          max: 11,
          name: "MID 7-10"
        },
        {
          max: Infinity,
          name: "HIGH 11+",
          last: "HIGH 11+"
        }
      ]
    )
);

/*
  실제 개별팀 득점.
  경기 단위가 아니라 team-side 단위로 다시 만든다.
*/
const teamSides =
  auditRows.flatMap(r => [
    {
      split: r.split,
      actual: r.actualAway,
      pred: r.predAway,
      error: r.awayErr,
      abs: r.awayAbs,

      avgRuns:
        r.awayAvgRuns,

      oppAllowed:
        r.homeAvgRunsAllowed,

      oppStarterEra:
        r.homeStarterEra,

      oppStarterRecent5Era:
        r.homeStarterRecent5Era,

      oppBullpenFatigue:
        r.homeBullpenFatigue,

      lineupOps:
        r.awayLineupOps,

      marketProb:
        r.marketAway
    },

    {
      split: r.split,
      actual: r.actualHome,
      pred: r.predHome,
      error: r.homeErr,
      abs: r.homeAbs,

      avgRuns:
        r.homeAvgRuns,

      oppAllowed:
        r.awayAvgRunsAllowed,

      oppStarterEra:
        r.awayStarterEra,

      oppStarterRecent5Era:
        r.awayStarterRecent5Era,

      oppBullpenFatigue:
        r.awayBullpenFatigue,

      lineupOps:
        r.homeLineupOps,

      marketProb:
        r.marketHome
    }
  ]);

function sideMetrics(xs) {
  return {
    n: xs.length,

    mae:
      avg(
        xs.map(x => x.abs)
      ),

    bias:
      avg(
        xs.map(x => x.error)
      )
  };
}

function groupSides(
  title,
  keyFn
) {
  console.log();
  console.log(
    `===== ${title} =====`
  );

  const groups =
    new Map();

  for (const x of teamSides) {
    const key =
      keyFn(x);

    if (!groups.has(key))
      groups.set(key, []);

    groups.get(key).push(x);
  }

  for (
    const [key, xs]
    of groups
  ) {
    const m =
      sideMetrics(xs);

    console.log(
      String(key).padEnd(30),
      `n=${String(m.n).padStart(3)}`,
      `MAE=${m.mae === null ? "-" : m.mae.toFixed(3)}`,
      `BIAS=${m.bias === null ? "-" : m.bias.toFixed(3)}`
    );
  }
}

groupSides(
  "ACTUAL TEAM RUNS",
  x =>
    x.actual <= 2
      ? "0-2 RUNS"
      : x.actual <= 5
        ? "3-5 RUNS"
        : "6+ RUNS"
);

groupSides(
  "PREDICTED TEAM RUNS",
  x =>
    x.pred < 3.5
      ? "<3.5"
      : x.pred < 4.5
        ? "3.5-4.49"
        : x.pred < 5.5
          ? "4.5-5.49"
          : "5.5+"
);

groupSides(
  "TEAM AVG RUNS",
  x =>
    x.avgRuns === null
      ? "MISSING"
      : x.avgRuns < 4
        ? "<4.0"
        : x.avgRuns < 5
          ? "4.0-4.99"
          : x.avgRuns < 6
            ? "5.0-5.99"
            : "6.0+"
);

groupSides(
  "OPP AVG RUNS ALLOWED",
  x =>
    x.oppAllowed === null
      ? "MISSING"
      : x.oppAllowed < 4
        ? "<4.0"
        : x.oppAllowed < 5
          ? "4.0-4.99"
          : x.oppAllowed < 6
            ? "5.0-5.99"
            : "6.0+"
);

groupSides(
  "OPPOSING STARTER ERA",
  x =>
    x.oppStarterEra === null
      ? "MISSING"
      : x.oppStarterEra < 3
        ? "<3.00"
        : x.oppStarterEra < 4.5
          ? "3.00-4.49"
          : x.oppStarterEra < 6
            ? "4.50-5.99"
            : "6.00+"
);

groupSides(
  "OPPOSING STARTER RECENT5 ERA",
  x =>
    x.oppStarterRecent5Era === null
      ? "MISSING"
      : x.oppStarterRecent5Era < 3
        ? "<3.00"
        : x.oppStarterRecent5Era < 4.5
          ? "3.00-4.49"
          : x.oppStarterRecent5Era < 6
            ? "4.50-5.99"
            : "6.00+"
);

groupSides(
  "OPP BULLPEN FATIGUE",
  x =>
    x.oppBullpenFatigue === null
      ? "MISSING"
      : x.oppBullpenFatigue < 40
        ? "<40"
        : x.oppBullpenFatigue < 60
          ? "40-59"
          : x.oppBullpenFatigue < 80
            ? "60-79"
            : "80+"
);

groupSides(
  "LINEUP OPS",
  x =>
    x.lineupOps === null
      ? "MISSING"
      : x.lineupOps < 0.70
        ? "<.700"
        : x.lineupOps < 0.80
          ? ".700-.799"
          : x.lineupOps < 0.90
            ? ".800-.899"
            : ".900+"
);

groupSides(
  "MARKET ML PROBABILITY",
  x =>
    x.marketProb === null
      ? "MISSING"
      : x.marketProb < 0.40
        ? "<40%"
        : x.marketProb < 0.50
          ? "40-49.9%"
          : x.marketProb < 0.60
            ? "50-59.9%"
            : "60%+"
);

/*
  과대/과소예측
*/
console.log();
console.log(
  "===== SCORE BIAS ====="
);

const over =
  teamSides.filter(
    x => x.error > 0.5
  );

const under =
  teamSides.filter(
    x => x.error < -0.5
  );

const close =
  teamSides.filter(
    x =>
      Math.abs(x.error) <= 0.5
  );

console.log(
  "OVER PREDICT :",
  over.length,
  pct(
    over.length /
    teamSides.length
  )
);

console.log(
  "UNDER PREDICT:",
  under.length,
  pct(
    under.length /
    teamSides.length
  )
);

console.log(
  "WITHIN ±0.5  :",
  close.length,
  pct(
    close.length /
    teamSides.length
  )
);

/*
  최악의 오차 경기.
*/
console.log();
console.log(
  "===== WORST 20 GAMES ====="
);

const worst =
  [...auditRows]
    .sort(
      (a, b) =>
        (
          b.awayAbs +
          b.homeAbs
        ) -
        (
          a.awayAbs +
          a.homeAbs
        )
    )
    .slice(0, 20);

for (const r of worst) {
  console.log(
    r.date,
    `${r.awayTeam} ${r.actualAway}-${r.actualHome} ${r.homeTeam}`,
    `PRED=${r.predAway.toFixed(2)}-${r.predHome.toFixed(2)}`,
    `TEAM_ERR=${(r.awayAbs + r.homeAbs).toFixed(2)}`,
    `TOTAL_ERR=${r.totalErr.toFixed(2)}`,
    `ML=${r.marketAway === null ? "-" : (r.marketAway * 100).toFixed(1) + "%"}`
  );
}

console.log();
console.log(
  "FINAL HOLDOUT: STILL LOCKED"
);

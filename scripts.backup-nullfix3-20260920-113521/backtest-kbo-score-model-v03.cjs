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

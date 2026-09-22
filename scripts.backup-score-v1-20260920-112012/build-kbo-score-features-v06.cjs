const fs = require("fs");

const BACKTEST =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const STARTERS =
  "data/kbo-historical-starter-stats-2026.json";

const LINEUPS =
  "data/kbo-historical-lineup-stats-2026.json";

const VS_STARTER =
  "data/kbo-team-vs-starter-runs-2026.json";

const OUT =
  "data/kbo-score-features-v06.json";

function read(p) {
  return JSON.parse(
    fs.readFileSync(p, "utf8")
  );
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function avg(arr) {
  const xs = arr.filter(Number.isFinite);
  if (!xs.length) return null;
  return xs.reduce((a,b) => a+b,0) / xs.length;
}

function daysBetween(a,b) {
  if (!a || !b) return null;

  return Math.round(
    (
      new Date(a + "T00:00:00Z") -
      new Date(b + "T00:00:00Z")
    ) / 86400000
  );
}

/*
  --------------------------------------------------
  1. 실제 경기 1개당 1행 생성
  --------------------------------------------------
*/

const raw =
  read(BACKTEST);

const source =
  Array.isArray(raw)
    ? raw
    : raw.results || [];

const gameMap = new Map();

for (const r of source) {
  if (
    !r.gameId ||
    !r.date ||
    !Number.isFinite(Number(r.awayScore)) ||
    !Number.isFinite(Number(r.homeScore))
  ) {
    continue;
  }

  if (!gameMap.has(r.gameId)) {
    gameMap.set(r.gameId, {
      date: r.date,
      month: r.month,
      gameId: r.gameId,
      awayTeam: r.awayTeam,
      homeTeam: r.homeTeam,
      awayScore: Number(r.awayScore),
      homeScore: Number(r.homeScore),

      formEdge:
        num(r.formEdge),

      scoreModelInputs:
        r.scoreModelInputs || {}
    });
  }
}

const games =
  [...gameMap.values()]
    .sort(
      (a,b) =>
        a.date.localeCompare(b.date) ||
        a.gameId.localeCompare(b.gameId)
    );

console.log(
  "UNIQUE SETTLED GAMES:",
  games.length
);

/*
  --------------------------------------------------
  2. 역사 선발
  --------------------------------------------------
*/

const starterRaw =
  read(STARTERS);

const starterMap =
  new Map(
    (starterRaw.snapshots || [])
      .map(x => [x.gameId, x])
  );

/*
  --------------------------------------------------
  3. 역사 라인업
  --------------------------------------------------
*/

const lineupRaw =
  read(LINEUPS);

const lineupMap =
  new Map(
    (lineupRaw.snapshots || [])
      .map(x => [x.gameId, x])
  );

/*
  --------------------------------------------------
  4. 팀 vs 상대 선발
  --------------------------------------------------
*/

const vsRaw =
  read(VS_STARTER);

const vsMap =
  new Map(
    (vsRaw.games || [])
      .map(x => [x.gameId, x])
  );

/*
  --------------------------------------------------
  5. Betman ML 시장 확률 / 구장
  백테스트 row에서 ML no-vig 계산.
  구장은 원본 Betman history에서 가능한 경우 추출.
  --------------------------------------------------
*/

const rowsByGame =
  new Map();

for (const r of source) {
  if (!rowsByGame.has(r.gameId))
    rowsByGame.set(r.gameId, []);

  rowsByGame.get(r.gameId).push(r);
}

function mlMarket(gameId, awayTeam, homeTeam) {
  const rows =
    (rowsByGame.get(gameId) || [])
      .filter(
        x =>
          x.market === "ML" &&
          num(x.odds) !== null &&
          Number(x.odds) > 1
      );

  const away =
    rows.find(x =>
      String(x.label || "")
        .startsWith(String(awayTeam))
    );

  const home =
    rows.find(x =>
      String(x.label || "")
        .startsWith(String(homeTeam))
    );

  if (!away || !home)
    return null;

  const ia = 1 / Number(away.odds);
  const ih = 1 / Number(home.odds);
  const sum = ia + ih;

  return {
    awayOdds: Number(away.odds),
    homeOdds: Number(home.odds),
    awayNoVig: ia / sum,
    homeNoVig: ih / sum
  };
}

/*
  --------------------------------------------------
  6. D-1 팀 히스토리
  같은 날짜 경기는 전부 예측한 뒤 누적.
  따라서 당일 경기 결과 누수 없음.
  --------------------------------------------------
*/

const teamHistory =
  new Map();

function historyOf(team) {
  if (!teamHistory.has(team))
    teamHistory.set(team, []);

  return teamHistory.get(team);
}

function recentFeatures(team, date) {
  const h =
    historyOf(team)
      .filter(x => x.date < date);

  function block(n) {
    const xs = h.slice(-n);

    return {
      games: xs.length,

      avgRuns:
        avg(xs.map(x => x.runs)),

      avgRunsAllowed:
        avg(xs.map(x => x.allowed)),

      winRate:
        xs.length
          ? xs.filter(x => x.runs > x.allowed).length /
            xs.length
          : null
    };
  }

  const home =
    h.filter(x => x.home);

  const away =
    h.filter(x => !x.home);

  const last =
    h.length
      ? h[h.length - 1]
      : null;

  return {
    seasonGames: h.length,

    seasonAvgRuns:
      avg(h.map(x => x.runs)),

    seasonAvgRunsAllowed:
      avg(h.map(x => x.allowed)),

    recent5: block(5),
    recent10: block(10),
    recent20: block(20),

    homeGames: home.length,
    homeAvgRuns:
      avg(home.map(x => x.runs)),
    homeAvgRunsAllowed:
      avg(home.map(x => x.allowed)),

    awayGames: away.length,
    awayAvgRuns:
      avg(away.map(x => x.runs)),
    awayAvgRunsAllowed:
      avg(away.map(x => x.allowed)),

    daysSinceLastGame:
      last
        ? daysBetween(date, last.date)
        : null,

    restDays:
      last
        ? Math.max(
            0,
            daysBetween(date,last.date) - 1
          )
        : null
  };
}

/*
  --------------------------------------------------
  7. D-1 리그 득점 환경
  초기에는 prior 4.50을 사용하고
  실제 경기 누적과 자연스럽게 혼합.
  --------------------------------------------------
*/

const PRIOR_TEAM_GAMES = 80;
const PRIOR_RUNS = 4.50;

let leagueTeamGames = 0;
let leagueRuns = 0;

function leagueAverage() {
  return (
    PRIOR_RUNS * PRIOR_TEAM_GAMES +
    leagueRuns
  ) / (
    PRIOR_TEAM_GAMES +
    leagueTeamGames
  );
}

/*
  --------------------------------------------------
  8. 통합
  --------------------------------------------------
*/

const output = [];

let i = 0;

while (i < games.length) {
  const date = games[i].date;

  const sameDay = [];

  while (
    i < games.length &&
    games[i].date === date
  ) {
    sameDay.push(games[i]);
    i++;
  }

  const leagueD1 =
    leagueAverage();

  for (const g of sameDay) {
    const starter =
      starterMap.get(g.gameId) || null;

    const lineup =
      lineupMap.get(g.gameId) || null;

    const vs =
      vsMap.get(g.gameId) || null;

    const market =
      mlMarket(
        g.gameId,
        g.awayTeam,
        g.homeTeam
      );

    const awayHistory =
      recentFeatures(
        g.awayTeam,
        g.date
      );

    const homeHistory =
      recentFeatures(
        g.homeTeam,
        g.date
      );

    const as =
      starter?.awayStarter || null;

    const hs =
      starter?.homeStarter || null;

    const als =
      lineup?.away?.summary || null;

    const hls =
      lineup?.home?.summary || null;

    output.push({
      date: g.date,
      month: g.month,
      gameId: g.gameId,

      awayTeam: g.awayTeam,
      homeTeam: g.homeTeam,

      target: {
        awayScore: g.awayScore,
        homeScore: g.homeScore,
        total:
          g.awayScore + g.homeScore,
        margin:
          g.awayScore - g.homeScore
      },

      environment: {
        leagueRunsPerTeamD1:
          leagueD1,

        month:
          Number(g.date.slice(5,7))
      },

      awayTeamForm: awayHistory,
      homeTeamForm: homeHistory,

      starter: {
        away: as
          ? {
              id: as.id,
              name: as.name,
              ...as.stats
            }
          : null,

        home: hs
          ? {
              id: hs.id,
              name: hs.name,
              ...hs.stats
            }
          : null
      },

      lineup: {
        confirmed:
          lineup?.confirmed ?? false,

        away: als
          ? {
              playerCount:
                als.playerCount,
              score:
                als.score,
              avgOps:
                als.avgOps,
              avgObp:
                als.avgObp,
              avgSlg:
                als.avgSlg,
              totalHr:
                als.totalHr
            }
          : null,

        home: hls
          ? {
              playerCount:
                hls.playerCount,
              score:
                hls.score,
              avgOps:
                hls.avgOps,
              avgObp:
                hls.avgObp,
              avgSlg:
                hls.avgSlg,
              totalHr:
                hls.totalHr
            }
          : null
      },

      bullpen: {
        awayFatigue:
          num(
            g.scoreModelInputs
              ?.awayBullpenFatigue
          ),

        homeFatigue:
          num(
            g.scoreModelInputs
              ?.homeBullpenFatigue
          )
      },

      vsStarter: {
        awayVsHomeStarter:
          vs?.awayVsHomeStarter || {
            games: 0,
            totalRuns: 0,
            avgRuns: null
          },

        homeVsAwayStarter:
          vs?.homeVsAwayStarter || {
            games: 0,
            totalRuns: 0,
            avgRuns: null
          }
      },

      market: market,

      existingSignals: {
        formEdge:
          g.formEdge
      },

      /*
        다음 단계 확장 슬롯.
        구장/날씨는 역사자료 결합 후 채운다.
      */
      context: {
        stadium: null,

        weather: {
          temperatureC: null,
          humidityPct: null,
          windKph: null,
          windDirection: null,
          precipitationMm: null,
          dome: null
        }
      }
    });
  }

  /*
    같은 날짜 경기 전부 feature 생성 후
    결과를 history에 반영.
  */
  for (const g of sameDay) {
    historyOf(g.awayTeam).push({
      date: g.date,
      home: false,
      runs: g.awayScore,
      allowed: g.homeScore
    });

    historyOf(g.homeTeam).push({
      date: g.date,
      home: true,
      runs: g.homeScore,
      allowed: g.awayScore
    });

    leagueRuns +=
      g.awayScore +
      g.homeScore;

    leagueTeamGames += 2;
  }
}

/*
  --------------------------------------------------
  9. Coverage
  --------------------------------------------------
*/

function count(fn) {
  return output.filter(fn).length;
}

const coverage = {
  games: output.length,

  starterBoth:
    count(x =>
      x.starter.away &&
      x.starter.home
    ),

  starterEraBoth:
    count(x =>
      num(x.starter.away?.era) !== null &&
      num(x.starter.home?.era) !== null
    ),

  starterWhipBoth:
    count(x =>
      num(x.starter.away?.whip) !== null &&
      num(x.starter.home?.whip) !== null
    ),

  lineupBoth:
    count(x =>
      num(x.lineup.away?.avgOps) !== null &&
      num(x.lineup.home?.avgOps) !== null
    ),

  marketMl:
    count(x =>
      x.market !== null
    ),

  vsStarterAny:
    count(x =>
      x.vsStarter.awayVsHomeStarter.games > 0 ||
      x.vsStarter.homeVsAwayStarter.games > 0
    ),

  vsStarterBoth:
    count(x =>
      x.vsStarter.awayVsHomeStarter.games > 0 &&
      x.vsStarter.homeVsAwayStarter.games > 0
    ),

  recent5Both:
    count(x =>
      x.awayTeamForm.recent5.games >= 5 &&
      x.homeTeamForm.recent5.games >= 5
    ),

  recent10Both:
    count(x =>
      x.awayTeamForm.recent10.games >= 10 &&
      x.homeTeamForm.recent10.games >= 10
    ),

  recent20Both:
    count(x =>
      x.awayTeamForm.recent20.games >= 20 &&
      x.homeTeamForm.recent20.games >= 20
    )
};

const result = {
  generatedAt:
    new Date().toISOString(),

  methodology: {
    leakage:
      "All rolling team/league features use games before prediction date only; same-day results are added after all same-day features are generated.",

    target:
      "Actual final away/home runs",

    finalOpened:
      false
  },

  coverage,

  games: output
};

fs.writeFileSync(
  OUT,
  JSON.stringify(result,null,2)
);

console.log();
console.log("===== COVERAGE =====");
console.log(
  JSON.stringify(coverage,null,2)
);

console.log();
console.log(
  "OUTPUT:",
  OUT
);

console.log();
console.log(
  "SAMPLE FEATURE:"
);

console.log(
  JSON.stringify(
    output.find(
      x =>
        x.awayTeamForm.recent10.games >= 10 &&
        x.homeTeamForm.recent10.games >= 10
    ) || output[0],
    null,
    2
  )
);

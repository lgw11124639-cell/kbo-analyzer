const fs = require("fs");

const BACKTEST =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const STARTERS =
  "data/kbo-historical-starter-stats-2026.json";

const OUTPUT =
  "data/kbo-team-vs-starter-runs-2026.json";

const rawBacktest = JSON.parse(
  fs.readFileSync(BACKTEST, "utf8")
);

const rows = Array.isArray(rawBacktest)
  ? rawBacktest
  : rawBacktest.results;

const starterRaw = JSON.parse(
  fs.readFileSync(STARTERS, "utf8")
);

const snapshots =
  Array.isArray(starterRaw)
    ? starterRaw
    : starterRaw.snapshots;

if (!Array.isArray(rows)) {
  throw new Error("BACKTEST RESULTS NOT FOUND");
}

if (!Array.isArray(snapshots)) {
  throw new Error("STARTER SNAPSHOTS NOT FOUND");
}

/*
  같은 실제 경기당 row가 여러 개 있으므로
  gameId 기준으로 1경기만 남긴다.
*/
const gamesById = new Map();

for (const r of rows) {
  if (
    !r.gameId ||
    !r.date ||
    !r.awayTeam ||
    !r.homeTeam ||
    !Number.isFinite(r.awayScore) ||
    !Number.isFinite(r.homeScore)
  ) {
    continue;
  }

  if (!gamesById.has(r.gameId)) {
    gamesById.set(r.gameId, {
      date: r.date,
      gameId: r.gameId,
      awayTeam: r.awayTeam,
      homeTeam: r.homeTeam,
      awayScore: r.awayScore,
      homeScore: r.homeScore
    });
  }
}

const starterByGame = new Map(
  snapshots.map(s => [s.gameId, s])
);

const games = [...gamesById.values()]
  .filter(g => starterByGame.has(g.gameId))
  .sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.gameId.localeCompare(b.gameId)
  );

/*
  key = 공격팀 + 상대 선발 ID

  이전 경기에서 그 선발이 선발 등판했을 때
  공격팀이 경기 전체에서 몇 점을 냈는지 누적.

  주의:
  이것은 "선발에게 직접 뺏은 자책점"이 아니라
  "그 투수가 선발로 나온 경기에서 팀의 최종 득점".
*/
const history = new Map();

function key(team, pitcherId) {
  return `${team}::${pitcherId}`;
}

function previous(team, pitcher) {
  if (!pitcher?.id) {
    return {
      games: 0,
      totalRuns: 0,
      avgRuns: null
    };
  }

  const x = history.get(
    key(team, pitcher.id)
  );

  if (!x) {
    return {
      games: 0,
      totalRuns: 0,
      avgRuns: null
    };
  }

  return {
    games: x.games,
    totalRuns: x.totalRuns,
    avgRuns:
      Number(
        (x.totalRuns / x.games).toFixed(3)
      )
  };
}

function add(team, pitcher, runs) {
  if (!pitcher?.id) return;

  const k = key(team, pitcher.id);

  const x =
    history.get(k) ?? {
      games: 0,
      totalRuns: 0
    };

  x.games += 1;
  x.totalRuns += runs;

  history.set(k, x);
}

const output = [];

for (const g of games) {
  const s = starterByGame.get(g.gameId);

  const awayVsHomeStarter =
    previous(
      g.awayTeam,
      s.homeStarter
    );

  const homeVsAwayStarter =
    previous(
      g.homeTeam,
      s.awayStarter
    );

  /*
    중요:
    현재 경기의 맞대결 수치는
    여기까지 "이전 경기만" 들어 있음.
  */
  output.push({
    date: g.date,
    gameId: g.gameId,

    awayTeam: g.awayTeam,
    homeTeam: g.homeTeam,

    awayScore: g.awayScore,
    homeScore: g.homeScore,

    awayStarter: s.awayStarter
      ? {
          id: s.awayStarter.id,
          name: s.awayStarter.name
        }
      : null,

    homeStarter: s.homeStarter
      ? {
          id: s.homeStarter.id,
          name: s.homeStarter.name
        }
      : null,

    awayVsHomeStarter: {
      ...awayVsHomeStarter
    },

    homeVsAwayStarter: {
      ...homeVsAwayStarter
    }
  });

  /*
    계산이 끝난 뒤 현재 경기 결과를 누적.
    따라서 현재 경기 점수가 자기 예측에
    들어가는 look-ahead가 발생하지 않는다.
  */
  add(
    g.awayTeam,
    s.homeStarter,
    g.awayScore
  );

  add(
    g.homeTeam,
    s.awayStarter,
    g.homeScore
  );
}

const coverage = {
  totalGames: output.length,

  awayAny: output.filter(
    x => x.awayVsHomeStarter.games >= 1
  ).length,

  homeAny: output.filter(
    x => x.homeVsAwayStarter.games >= 1
  ).length,

  bothAny: output.filter(
    x =>
      x.awayVsHomeStarter.games >= 1 &&
      x.homeVsAwayStarter.games >= 1
  ).length,

  away2Plus: output.filter(
    x => x.awayVsHomeStarter.games >= 2
  ).length,

  home2Plus: output.filter(
    x => x.homeVsAwayStarter.games >= 2
  ).length,

  away3Plus: output.filter(
    x => x.awayVsHomeStarter.games >= 3
  ).length,

  home3Plus: output.filter(
    x => x.homeVsAwayStarter.games >= 3
  ).length
};

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(
    {
      generatedAt:
        new Date().toISOString(),

      methodology: {
        definition:
          "Team final runs in prior games started by the same opposing pitcher",

        leakage:
          "Current game is added only after its pregame snapshot is produced",

        key:
          "offense team + opposing starter playerId"
      },

      coverage,
      games: output
    },
    null,
    2
  )
);

console.log(
  "===== TEAM VS STARTER RUNS ====="
);

console.log(
  "STARTER SNAPSHOTS:",
  snapshots.length
);

console.log(
  "MATCHED SETTLED GAMES:",
  output.length
);

console.log(
  "COVERAGE:",
  coverage
);

console.log();
console.log(
  "===== SAMPLE WITH PRIOR MATCHUP ====="
);

console.log(
  output
    .filter(
      x =>
        x.awayVsHomeStarter.games > 0 ||
        x.homeVsAwayStarter.games > 0
    )
    .slice(0, 10)
);

console.log();
console.log("OUTPUT:", OUTPUT);

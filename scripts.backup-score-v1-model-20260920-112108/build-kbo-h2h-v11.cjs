const fs = require("fs");

const SRC =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const OUT =
  "data/kbo-h2h-v11.json";

const raw =
  JSON.parse(
    fs.readFileSync(SRC, "utf8")
  );

const rows =
  Array.isArray(raw)
    ? raw
    : raw.results || [];

/*
 * 동일 실제경기가 ML/HANDICAP/TOTAL 등
 * 여러 행 존재하므로 gameId 기준 1개만 사용.
 */
const gameMap = new Map();

for (const r of rows) {
  if (
    !r ||
    !r.gameId ||
    !r.date ||
    !r.awayTeam ||
    !r.homeTeam ||
    !Number.isFinite(Number(r.awayScore)) ||
    !Number.isFinite(Number(r.homeScore))
  ) {
    continue;
  }

  if (!gameMap.has(r.gameId)) {
    gameMap.set(r.gameId, {
      date: String(r.date),
      gameId: String(r.gameId),
      awayTeam: String(r.awayTeam),
      homeTeam: String(r.homeTeam),
      awayScore: Number(r.awayScore),
      homeScore: Number(r.homeScore)
    });
  }
}

const games =
  [...gameMap.values()]
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.gameId.localeCompare(b.gameId)
    );

console.log(
  "SOURCE SETTLED GAMES:",
  games.length
);

function pairKey(a, b) {
  return [a, b]
    .sort((x, y) =>
      x.localeCompare(y, "ko")
    )
    .join("|||");
}

const history = new Map();
const snapshots = [];

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

  /*
   * 먼저 당일 모든 경기의 H2H snapshot 생성.
   * 따라서 같은 날짜 경기 결과는 절대 포함되지 않음.
   */
  for (let k = i; k < j; k++) {
    const g = games[k];

    const key =
      pairKey(
        g.awayTeam,
        g.homeTeam
      );

    const prior =
      history.get(key) || [];

    let awayRuns = 0;
    let homeRuns = 0;
    let awayWins = 0;
    let homeWins = 0;

    for (const p of prior) {
      if (
        p.awayTeam ===
        g.awayTeam
      ) {
        awayRuns += p.awayScore;
        homeRuns += p.homeScore;

        if (
          p.awayScore >
          p.homeScore
        ) {
          awayWins++;
        } else if (
          p.homeScore >
          p.awayScore
        ) {
          homeWins++;
        }
      } else {
        awayRuns += p.homeScore;
        homeRuns += p.awayScore;

        if (
          p.homeScore >
          p.awayScore
        ) {
          awayWins++;
        } else if (
          p.awayScore >
          p.homeScore
        ) {
          homeWins++;
        }
      }
    }

    const n = prior.length;

    snapshots.push({
      date: g.date,
      gameId: g.gameId,
      awayTeam: g.awayTeam,
      homeTeam: g.homeTeam,

      priorGames: n,

      awayAvgRuns:
        n
          ? awayRuns / n
          : null,

      homeAvgRuns:
        n
          ? homeRuns / n
          : null,

      awayWinRate:
        n
          ? awayWins / n
          : null,

      homeWinRate:
        n
          ? homeWins / n
          : null,

      actualAwayScore:
        g.awayScore,

      actualHomeScore:
        g.homeScore
    });
  }

  /*
   * 당일 snapshot을 모두 만든 뒤에만
   * 실제 경기 결과를 history에 추가.
   */
  for (let k = i; k < j; k++) {
    const g = games[k];

    const key =
      pairKey(
        g.awayTeam,
        g.homeTeam
      );

    if (!history.has(key)) {
      history.set(key, []);
    }

    history.get(key).push(g);
  }

  i = j;
}

fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      version: "v1.1",
      source: SRC,
      methodology:
        "D-1 only; same-day games excluded before history update",
      games: snapshots
    },
    null,
    2
  )
);

const coverage = {};

for (const s of snapshots) {
  const bucket =
    s.priorGames >= 10
      ? "10+"
      : String(s.priorGames);

  coverage[bucket] =
    (coverage[bucket] || 0) + 1;
}

console.log(
  "H2H SNAPSHOTS:",
  snapshots.length
);

console.log(
  "H2H PRIOR-GAME COVERAGE:",
  coverage
);

console.log();
console.log(
  "===== SAMPLE WITH H2H ====="
);

for (
  const s of snapshots
    .filter(x => x.priorGames > 0)
    .slice(0, 10)
) {
  console.log({
    date: s.date,
    gameId: s.gameId,
    matchup:
      `${s.awayTeam} @ ${s.homeTeam}`,
    priorGames: s.priorGames,
    awayAvgRuns:
      Number(
        s.awayAvgRuns.toFixed(3)
      ),
    homeAvgRuns:
      Number(
        s.homeAvgRuns.toFixed(3)
      ),
    awayWinRate:
      Number(
        s.awayWinRate.toFixed(3)
      ),
    actual:
      `${s.actualAwayScore}:${s.actualHomeScore}`
  });
}

console.log();
console.log(
  "OUTPUT:",
  OUT
);

/*
 * 누수 검사:
 * 각 snapshot의 prior history 날짜가
 * 현재 경기 날짜보다 반드시 이전인지
 * 원본으로 다시 검증.
 */
let leakErrors = 0;

const verifyHistory =
  new Map();

i = 0;

while (i < games.length) {
  const date = games[i].date;

  let j = i;

  while (
    j < games.length &&
    games[j].date === date
  ) {
    j++;
  }

  for (let k = i; k < j; k++) {
    const g = games[k];

    const key =
      pairKey(
        g.awayTeam,
        g.homeTeam
      );

    const prior =
      verifyHistory.get(key) || [];

    for (const p of prior) {
      if (!(p.date < g.date)) {
        leakErrors++;

        if (leakErrors <= 10) {
          console.log(
            "LEAK ERROR",
            g.gameId,
            g.date,
            p.gameId,
            p.date
          );
        }
      }
    }
  }

  for (let k = i; k < j; k++) {
    const g = games[k];

    const key =
      pairKey(
        g.awayTeam,
        g.homeTeam
      );

    if (!verifyHistory.has(key)) {
      verifyHistory.set(key, []);
    }

    verifyHistory
      .get(key)
      .push(g);
  }

  i = j;
}

console.log();
console.log(
  "===== VERIFY NO SAME-DAY LEAKAGE ====="
);

console.log(
  "FIRST H2H LEAK ERRORS:",
  leakErrors
);

console.log(
  leakErrors === 0
    ? "D-1 H2H CHECK OK"
    : "D-1 H2H CHECK FAILED"
);

const fs = require("fs");

const d = JSON.parse(
  fs.readFileSync(
    "data/kbo-backtest-all-candidates-2026.json",
    "utf8"
  )
);

const rows = (d.results ?? []).filter(
  x => x.result === "WIN" || x.result === "LOSS"
);

function sideOf(x) {
  const label = String(x.label ?? "");

  if (x.market === "ML") {
    if (label.includes(`${x.homeTeam} 승`)) return "HOME";
    if (label.includes(`${x.awayTeam} 승`)) return "AWAY";
  }

  if (x.market === "TOTAL") {
    if (label.includes("언더")) return "UNDER";
    if (label.includes("오버")) return "OVER";
  }

  if (x.market === "HANDICAP") {
    if (label.includes(x.homeTeam)) return "HOME";
    if (label.includes(x.awayTeam)) return "AWAY";
  }

  return "?";
}

function summarize(list) {
  const wins = list.filter(x => x.result === "WIN").length;
  const losses = list.filter(x => x.result === "LOSS").length;

  const stake = list.reduce(
    (s,x) => s + Number(x.stake ?? 0),
    0
  );

  const returned = list.reduce(
    (s,x) => s + Number(x.returned ?? 0),
    0
  );

  const profit = returned - stake;

  return {
    bets: list.length,
    wins,
    losses,
    hitRate: list.length
      ? Number((wins / list.length * 100).toFixed(2))
      : 0,
    avgOdds: list.length
      ? Number((
          list.reduce((s,x) => s + Number(x.odds ?? 0), 0)
          / list.length
        ).toFixed(3))
      : 0,
    profit,
    roi: stake
      ? Number((profit / stake * 100).toFixed(2))
      : 0
  };
}

const games = new Map();

for (const x of rows) {
  if (!games.has(x.gameId)) {
    games.set(x.gameId, []);
  }
  games.get(x.gameId).push(x);
}

function mlHome(list, minEv = 0) {
  return list
    .filter(x =>
      x.market === "ML" &&
      sideOf(x) === "HOME" &&
      Number(x.ev) > minEv
    )
    .sort((a,b) => Number(b.ev) - Number(a.ev))[0] ?? null;
}

function totalUnder(list, minEdge = 0.8) {
  return list
    .filter(x =>
      x.market === "TOTAL" &&
      sideOf(x) === "UNDER" &&
      Number(x.ev) > 0 &&
      Number(x.totalEdge ?? 0) >= minEdge
    )
    .sort((a,b) => Number(b.ev) - Number(a.ev))[0] ?? null;
}

function current(list) {
  return list.find(
    x => x.passesCurrentFilter === true
  ) ?? null;
}

const strategies = {
  CURRENT(list) {
    return current(list);
  },

  HOME_FIRST(list) {
    return (
      mlHome(list, 0) ??
      totalUnder(list, 0.8)
    );
  },

  UNDER_FIRST(list) {
    return (
      totalUnder(list, 0.8) ??
      mlHome(list, 0)
    );
  },

  MAX_EV_HOME_UNDER(list) {
    const a = mlHome(list, 0);
    const b = totalUnder(list, 0.8);

    return [a,b]
      .filter(Boolean)
      .sort(
        (x,y) =>
          Number(y.ev) -
          Number(x.ev)
      )[0] ?? null;
  },

  HOME_EV3_THEN_UNDER(list) {
    return (
      mlHome(list, 0.03) ??
      totalUnder(list, 0.8)
    );
  },

  UNDER_THEN_HOME_EV3(list) {
    return (
      totalUnder(list, 0.8) ??
      mlHome(list, 0.03)
    );
  }
};

const outputs = {};

for (const [name, choose] of Object.entries(strategies)) {
  outputs[name] = [];

  for (const list of games.values()) {
    const pick = choose(list);

    if (pick) {
      outputs[name].push(pick);
    }
  }
}

function split(list) {
  return {
    TRAIN: list.filter(
      x => x.date <= "2026-06-30"
    ),
    VALIDATION: list.filter(
      x => x.date >= "2026-07-01"
    )
  };
}

console.log(
  "\n===== ONE PICK PER GAME / OVERALL ====="
);

console.table(
  Object.entries(outputs).map(
    ([strategy,list]) => ({
      strategy,
      ...summarize(list)
    })
  )
);

console.log(
  "\n===== CHRONOLOGICAL TRAIN / VALIDATION ====="
);

const splitRows = [];

for (const [strategy,list] of Object.entries(outputs)) {
  const parts = split(list);

  for (const [period,part] of Object.entries(parts)) {
    splitRows.push({
      strategy,
      period,
      ...summarize(part)
    });
  }
}

console.table(splitRows);

console.log(
  "\n===== MONTHLY ====="
);

for (const [strategy,list] of Object.entries(outputs)) {
  console.log(`\n--- ${strategy} ---`);

  const months = new Map();

  for (const x of list) {
    if (!months.has(x.month)) {
      months.set(x.month, []);
    }
    months.get(x.month).push(x);
  }

  console.table(
    [...months.entries()].map(
      ([month,a]) => ({
        month,
        ...summarize(a)
      })
    )
  );
}

console.log(
  "\n===== MARKET MIX ====="
);

console.table(
  Object.entries(outputs).flatMap(
    ([strategy,list]) => {
      const markets = new Map();

      for (const x of list) {
        if (!markets.has(x.market)) {
          markets.set(x.market, []);
        }

        markets.get(x.market).push(x);
      }

      return [...markets.entries()].map(
        ([market,a]) => ({
          strategy,
          market,
          ...summarize(a)
        })
      );
    }
  )
);

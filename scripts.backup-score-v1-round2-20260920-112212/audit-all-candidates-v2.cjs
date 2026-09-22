const fs = require("fs");

const d = JSON.parse(
  fs.readFileSync(
    "data/kbo-backtest-all-candidates-2026.json",
    "utf8"
  )
);

const rows = (d.results || []).filter(
  x => x.result === "WIN" || x.result === "LOSS"
);

function stat(xs) {
  const wins = xs.filter(x => x.result === "WIN").length;
  const losses = xs.filter(x => x.result === "LOSS").length;

  const stake = xs.reduce(
    (a,x) => a + Number(x.stake || 0), 0
  );

  const returned = xs.reduce(
    (a,x) => a + Number(x.returned || 0), 0
  );

  const profit = returned - stake;

  return {
    bets: xs.length,
    wins,
    losses,
    hitRate: xs.length
      ? +(wins / xs.length * 100).toFixed(2)
      : 0,
    avgOdds: xs.length
      ? +(xs.reduce((a,x) => a + Number(x.odds),0) / xs.length).toFixed(3)
      : 0,
    avgEv: xs.length
      ? +(xs.reduce((a,x) => a + Number(x.ev || 0),0) / xs.length * 100).toFixed(2)
      : 0,
    profit: Math.round(profit),
    roi: stake
      ? +(profit / stake * 100).toFixed(2)
      : 0
  };
}

function table(title, groups) {
  console.log("\n===== " + title + " =====");
  console.table(
    Object.entries(groups).map(
      ([group, xs]) => ({
        group,
        ...stat(xs)
      })
    )
  );
}

const positive =
  rows.filter(x => Number(x.ev) > 0);

/* MARKET */
table("EV > 0 MARKET", {
  ML: positive.filter(x => x.market === "ML"),
  HANDICAP: positive.filter(x => x.market === "HANDICAP"),
  TOTAL: positive.filter(x => x.market === "TOTAL")
});

/* ML */
const ml =
  positive.filter(x => x.market === "ML");

table("ML ODDS", {
  "<1.60": ml.filter(x => x.odds < 1.60),
  "1.60~1.79": ml.filter(x => x.odds >= 1.60 && x.odds < 1.80),
  "1.80~1.99": ml.filter(x => x.odds >= 1.80 && x.odds < 2.00),
  "2.00~2.49": ml.filter(x => x.odds >= 2.00 && x.odds < 2.50),
  "2.50+": ml.filter(x => x.odds >= 2.50)
});

table("ML EV", {
  "0~2.9%": ml.filter(x => x.ev > 0 && x.ev < .03),
  "3~5.9%": ml.filter(x => x.ev >= .03 && x.ev < .06),
  "6~9.9%": ml.filter(x => x.ev >= .06 && x.ev < .10),
  "10%+": ml.filter(x => x.ev >= .10)
});

table("ML CONFIDENCE", {
  "<45%": ml.filter(x => x.confidence < .45),
  "45~49.9%": ml.filter(x => x.confidence >= .45 && x.confidence < .50),
  "50~54.9%": ml.filter(x => x.confidence >= .50 && x.confidence < .55),
  "55~59.9%": ml.filter(x => x.confidence >= .55 && x.confidence < .60),
  "60%+": ml.filter(x => x.confidence >= .60)
});

table("ML HOME / AWAY", {
  AWAY: ml.filter(x =>
    String(x.label).startsWith(String(x.awayTeam))
  ),
  HOME: ml.filter(x =>
    String(x.label).startsWith(String(x.homeTeam))
  )
});

/* HANDICAP */
const hc =
  positive.filter(x => x.market === "HANDICAP");

table("HANDICAP ODDS", {
  "<1.60": hc.filter(x => x.odds < 1.60),
  "1.60~1.79": hc.filter(x => x.odds >= 1.60 && x.odds < 1.80),
  "1.80~1.99": hc.filter(x => x.odds >= 1.80 && x.odds < 2.00),
  "2.00~2.49": hc.filter(x => x.odds >= 2.00 && x.odds < 2.50),
  "2.50~2.99": hc.filter(x => x.odds >= 2.50 && x.odds < 3.00),
  "3.00+": hc.filter(x => x.odds >= 3.00)
});

table("HANDICAP EV", {
  "0~2.9%": hc.filter(x => x.ev > 0 && x.ev < .03),
  "3~5.9%": hc.filter(x => x.ev >= .03 && x.ev < .06),
  "6~9.9%": hc.filter(x => x.ev >= .06 && x.ev < .10),
  "10%+": hc.filter(x => x.ev >= .10)
});

table("HANDICAP CONFIDENCE", {
  "<35%": hc.filter(x => x.confidence < .35),
  "35~39.9%": hc.filter(x => x.confidence >= .35 && x.confidence < .40),
  "40~44.9%": hc.filter(x => x.confidence >= .40 && x.confidence < .45),
  "45~49.9%": hc.filter(x => x.confidence >= .45 && x.confidence < .50),
  "50%+": hc.filter(x => x.confidence >= .50)
});

table("HANDICAP HOME / AWAY", {
  AWAY: hc.filter(x =>
    String(x.label).startsWith(String(x.awayTeam))
  ),
  HOME: hc.filter(x =>
    String(x.label).startsWith(String(x.homeTeam))
  )
});

/* TOTAL */
const total =
  positive.filter(x => x.market === "TOTAL");

table("TOTAL SIDE", {
  OVER: total.filter(x =>
    String(x.label).startsWith("오버")
  ),
  UNDER: total.filter(x =>
    String(x.label).startsWith("언더")
  )
});

table("TOTAL EDGE", {
  "<1.0": total.filter(x => x.totalEdge < 1),
  "1.0~1.49": total.filter(x => x.totalEdge >= 1 && x.totalEdge < 1.5),
  "1.5~1.99": total.filter(x => x.totalEdge >= 1.5 && x.totalEdge < 2),
  "2.0~2.49": total.filter(x => x.totalEdge >= 2 && x.totalEdge < 2.5),
  "2.5~2.99": total.filter(x => x.totalEdge >= 2.5 && x.totalEdge < 3),
  "3.0+": total.filter(x => x.totalEdge >= 3)
});

table("TOTAL EV", {
  "0~2.9%": total.filter(x => x.ev > 0 && x.ev < .03),
  "3~5.9%": total.filter(x => x.ev >= .03 && x.ev < .06),
  "6~9.9%": total.filter(x => x.ev >= .06 && x.ev < .10),
  "10%+": total.filter(x => x.ev >= .10)
});

table("TOTAL ODDS", {
  "<1.60": total.filter(x => x.odds < 1.60),
  "1.60~1.69": total.filter(x => x.odds >= 1.60 && x.odds < 1.70),
  "1.70~1.79": total.filter(x => x.odds >= 1.70 && x.odds < 1.80),
  "1.80~1.89": total.filter(x => x.odds >= 1.80 && x.odds < 1.90),
  "1.90+": total.filter(x => x.odds >= 1.90)
});

/* 월별 EV>0 */
for (const market of ["ML","HANDICAP","TOTAL"]) {
  const r = positive.filter(x => x.market === market);

  const months =
    [...new Set(r.map(x => x.month))].sort();

  table(
    `${market} MONTH`,
    Object.fromEntries(
      months.map(
        m => [m, r.filter(x => x.month === m)]
      )
    )
  );
}

/* 가장 좋은/나쁜 후보 샘플 */
console.log("\n===== EV > 0 후보 ROI 참고용 개별 샘플 =====");

console.table(
  positive
    .slice()
    .sort((a,b) => Number(b.ev) - Number(a.ev))
    .slice(0,30)
    .map(x => ({
      date: x.date,
      match: `${x.awayTeam} @ ${x.homeTeam}`,
      market: x.market,
      pick: x.label,
      odds: x.odds,
      conf: +(x.confidence * 100).toFixed(1),
      ev: +(x.ev * 100).toFixed(1),
      edge: x.totalEdge,
      result: x.result
    }))
);

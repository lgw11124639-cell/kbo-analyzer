const fs = require("fs");

const INPUT =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw =
  JSON.parse(
    fs.readFileSync(INPUT,"utf8")
  );

const rows =
  (raw.results || raw)
    .filter(x =>
      x.market === "HANDICAP" &&
      ["WIN","LOSS"].includes(x.result) &&
      Number.isFinite(Number(x.odds)) &&
      Number(x.odds) > 1
    )
    .map(x => ({
      ...x,
      odds:Number(x.odds),
      actual:x.result === "WIN" ? 1 : 0
    }));

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function side(x) {
  const label = String(x.label || "");
  const away = String(x.awayTeam || "");
  const home = String(x.homeTeam || "");

  if (away && label.includes(away)) return "AWAY";
  if (home && label.includes(home)) return "HOME";

  return null;
}

const groups = new Map();

for (const x of rows) {
  const key =
    `${x.date}:${x.gameId}:HANDICAP`;

  if (!groups.has(key))
    groups.set(key,[]);

  groups.get(key).push(x);
}

const paired = [];

for (const list of groups.values()) {
  if (list.length !== 2)
    continue;

  const [a,b] = list;

  const ia = 1/a.odds;
  const ib = 1/b.odds;
  const sum = ia+ib;

  for (const [x,opp] of [[a,b],[b,a]]) {
    const s = side(x);

    if (!s)
      continue;

    const form = n(x.formEdge);

    if (form === null)
      continue;

    const signedForm =
      s === "AWAY"
        ? form
        : -form;

    paired.push({
      ...x,
      signedForm,
      marketProb:
        (1/x.odds) / sum
    });
  }
}

const disc =
  paired.filter(x =>
    x.date >= "2026-03-28" &&
    x.date <= "2026-04-30"
  );

const internal =
  paired.filter(x =>
    x.date >= "2026-05-01" &&
    x.date <= "2026-06-30"
  );

function mean(a) {
  return a.reduce((s,x)=>s+x,0)/a.length;
}

function sd(a) {
  const m = mean(a);

  return Math.sqrt(
    mean(
      a.map(x=>(x-m)**2)
    )
  ) || 1;
}

const FORM_SD =
  sd(
    disc.map(x=>x.signedForm)
  );

function zForm(x) {
  return x.signedForm / FORM_SD;
}

function residual(x) {
  return x.actual - x.marketProb;
}

/*
  Discovery에서만 beta 결정
*/
const zx =
  disc.map(zForm);

const ry =
  disc.map(residual);

const mz = mean(zx);
const mr = mean(ry);

const cov =
  mean(
    zx.map(
      (z,i) =>
        (z-mz)*(ry[i]-mr)
    )
  );

const variance =
  mean(
    zx.map(
      z => (z-mz)**2
    )
  );

const BETA =
  variance
    ? cov/variance
    : 0;

function clamp(x,min,max) {
  return Math.max(
    min,
    Math.min(max,x)
  );
}

function enrich(x) {
  const signal = zForm(x);

  const adjustment =
    BETA * signal;

  const adjustedProb =
    clamp(
      x.marketProb + adjustment,
      0.05,
      0.95
    );

  const adjustedEV =
    adjustedProb * x.odds - 1;

  return {
    ...x,
    signal,
    adjustment,
    adjustedProb,
    adjustedEV
  };
}

function brier(list,key) {
  return mean(
    list.map(
      x =>
        (x[key]-x.actual)**2
    )
  );
}

function logloss(list,key) {
  return mean(
    list.map(x => {
      const p =
        clamp(x[key],0.001,0.999);

      return -(
        x.actual*Math.log(p) +
        (1-x.actual)*Math.log(1-p)
      );
    })
  );
}

function bettingStats(list) {
  if (!list.length)
    return {
      bets:0,
      wins:0,
      hit:0,
      avgOdds:0,
      roi:0
    };

  const wins =
    list.filter(
      x => x.actual === 1
    ).length;

  const returned =
    list.reduce(
      (s,x) =>
        s +
        (
          x.actual
            ? x.odds
            : 0
        ),
      0
    );

  return {
    bets:list.length,
    wins,
    hit:+(wins/list.length*100).toFixed(2),
    avgOdds:+mean(
      list.map(x=>x.odds)
    ).toFixed(3),
    roi:+(
      (returned/list.length-1)*100
    ).toFixed(2)
  };
}

function dailyBest(list) {
  const days = new Map();

  for (const x of list) {
    if (
      !days.has(x.date) ||
      x.adjustedEV >
      days.get(x.date).adjustedEV
    ) {
      days.set(x.date,x);
    }
  }

  return [...days.values()];
}

function evaluate(name,source) {
  const x =
    source.map(enrich);

  const positive =
    x.filter(
      r =>
        r.adjustment > 0
    );

  const positiveEV =
    x.filter(
      r =>
        r.adjustedEV > 0
    );

  const best =
    dailyBest(
      positiveEV
    );

  console.log();
  console.log(
    `===== ${name} =====`
  );

  console.table([
    {
      marketBrier:
        +brier(x,"marketProb").toFixed(5),

      adjustedBrier:
        +brier(x,"adjustedProb").toFixed(5),

      marketLogLoss:
        +logloss(x,"marketProb").toFixed(5),

      adjustedLogLoss:
        +logloss(x,"adjustedProb").toFixed(5)
    }
  ]);

  console.log(
    "POSITIVE FORM SIGNAL"
  );
  console.table([
    bettingStats(positive)
  ]);

  console.log(
    "ADJUSTED EV > 0"
  );
  console.table([
    bettingStats(positiveEV)
  ]);

  console.log(
    "DAILY BEST / ADJUSTED EV > 0"
  );
  console.table([
    bettingStats(best)
  ]);

  return {
    model:{
      marketBrier:
        brier(x,"marketProb"),
      adjustedBrier:
        brier(x,"adjustedProb"),
      marketLogLoss:
        logloss(x,"marketProb"),
      adjustedLogLoss:
        logloss(x,"adjustedProb")
    },

    positive:
      bettingStats(positive),

    positiveEV:
      bettingStats(positiveEV),

    dailyBest:
      bettingStats(best)
  };
}

console.log(
  "============================================================"
);

console.log(
  "KBO HANDICAP FORM MODEL V3.5"
);

console.log(
  "DISCOVERY-FITTED / INTERNAL-FROZEN"
);

console.log(
  "FINAL 07~09: LOCKED"
);

console.log(
  "============================================================"
);

console.log(
  "FORM_SD:",
  FORM_SD
);

console.log(
  "DISCOVERY BETA:",
  BETA
);

const result = {
  formSd:FORM_SD,
  beta:BETA,

  discovery:
    evaluate(
      "DISCOVERY",
      disc
    ),

  internal:
    evaluate(
      "INTERNAL",
      internal
    )
};

fs.writeFileSync(
  "data/kbo-handi-form-model-v35.json",
  JSON.stringify(
    result,
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-handi-form-model-v35.json"
);

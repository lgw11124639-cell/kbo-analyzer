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
      actual:
        x.result === "WIN"
          ? 1
          : 0
    }));

function num(v) {
  const x = Number(v);

  return Number.isFinite(x)
    ? x
    : null;
}

function side(x) {
  const label =
    String(x.label || "");

  const away =
    String(x.awayTeam || "");

  const home =
    String(x.homeTeam || "");

  if (
    away &&
    label.includes(away)
  ) return "AWAY";

  if (
    home &&
    label.includes(home)
  ) return "HOME";

  return null;
}

const groups =
  new Map();

for (const x of rows) {
  const key =
    `${x.date}:${x.gameId}:HANDICAP`;

  if (!groups.has(key)) {
    groups.set(key,[]);
  }

  groups.get(key).push(x);
}

const paired = [];

for (const list of groups.values()) {
  if (list.length !== 2)
    continue;

  const [a,b] =
    list;

  const ia =
    1/a.odds;

  const ib =
    1/b.odds;

  const denom =
    ia+ib;

  for (
    const [x,opp]
    of [[a,b],[b,a]]
  ) {
    const s =
      side(x);

    const form =
      num(x.formEdge);

    if (
      !s ||
      form === null
    ) {
      continue;
    }

    const signedForm =
      s === "AWAY"
        ? form
        : -form;

    paired.push({
      ...x,

      signedForm,

      marketProb:
        (1/x.odds)/denom
    });
  }
}

const discovery =
  paired.filter(x =>
    x.date >= "2026-03-28" &&
    x.date <= "2026-04-30"
  );

const internal =
  paired.filter(x =>
    x.date >= "2026-05-01" &&
    x.date <= "2026-06-30"
  );

const finalHoldout =
  paired.filter(x =>
    x.date >= "2026-07-01" &&
    x.date <= "2026-09-30"
  );

function mean(a) {
  if (!a.length)
    return 0;

  return (
    a.reduce(
      (s,x)=>s+x,
      0
    ) /
    a.length
  );
}

function sd(a) {
  if (!a.length)
    return 1;

  const m =
    mean(a);

  return (
    Math.sqrt(
      mean(
        a.map(
          x=>(x-m)**2
        )
      )
    ) ||
    1
  );
}

/*
  Discovery-fixed scaling
*/
const FORM_SD =
  sd(
    discovery.map(
      x=>x.signedForm
    )
  );

function zForm(x) {
  return (
    x.signedForm /
    FORM_SD
  );
}

/*
  Discovery-fixed beta
*/
const zx =
  discovery.map(
    zForm
  );

const ry =
  discovery.map(
    x =>
      x.actual -
      x.marketProb
  );

const mz =
  mean(zx);

const mr =
  mean(ry);

const covariance =
  mean(
    zx.map(
      (z,i) =>
        (z-mz) *
        (ry[i]-mr)
    )
  );

const variance =
  mean(
    zx.map(
      z =>
        (z-mz)**2
    )
  );

const BETA =
  variance
    ? covariance/variance
    : 0;

function clamp(
  x,
  lo,
  hi
) {
  return Math.max(
    lo,
    Math.min(
      hi,
      x
    )
  );
}

function enrich(x) {
  const signal =
    zForm(x);

  const adjustment =
    BETA *
    signal;

  const adjustedProb =
    clamp(
      x.marketProb +
      adjustment,
      0.05,
      0.95
    );

  const adjustedEV =
    adjustedProb *
    x.odds -
    1;

  return {
    ...x,
    signal,
    adjustment,
    adjustedProb,
    adjustedEV
  };
}

const D =
  discovery.map(enrich);

const I =
  internal.map(enrich);

const F =
  finalHoldout.map(enrich);

function dailyBest(list) {
  const days =
    new Map();

  for (const x of list) {
    if (
      x.adjustedEV <= 0
    ) {
      continue;
    }

    if (
      !days.has(x.date) ||
      x.adjustedEV >
      days.get(x.date).adjustedEV
    ) {
      days.set(
        x.date,
        x
      );
    }
  }

  return [
    ...days.values()
  ].sort(
    (a,b) =>
      a.date.localeCompare(
        b.date
      )
  );
}

function stats(list) {
  if (!list.length) {
    return {
      bets:0,
      wins:0,
      losses:0,
      hit:0,
      avgOdds:0,
      avgEV:0,
      roi:0
    };
  }

  const wins =
    list.filter(
      x =>
        x.actual === 1
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
    bets:
      list.length,

    wins,

    losses:
      list.length-wins,

    hit:
      +(
        wins /
        list.length *
        100
      ).toFixed(2),

    avgOdds:
      +mean(
        list.map(
          x=>x.odds
        )
      ).toFixed(3),

    avgEV:
      +(
        mean(
          list.map(
            x=>x.adjustedEV
          )
        ) *
        100
      ).toFixed(2),

    roi:
      +(
        (
          returned /
          list.length -
          1
        ) *
        100
      ).toFixed(2)
  };
}

function bankrollStats(
  list,
  initial=1000000,
  stake=10000
) {
  let bank =
    initial;

  let peak =
    initial;

  let maxDD =
    0;

  let losingStreak =
    0;

  let maxLosingStreak =
    0;

  for (const x of list) {
    const pnl =
      x.actual
        ? stake*x.odds-stake
        : -stake;

    bank += pnl;

    if (
      bank > peak
    ) {
      peak = bank;
    }

    const dd =
      peak > 0
        ? (
            peak-bank
          ) /
          peak
        : 0;

    if (
      dd > maxDD
    ) {
      maxDD = dd;
    }

    if (
      x.actual
    ) {
      losingStreak = 0;
    } else {
      losingStreak++;

      maxLosingStreak =
        Math.max(
          maxLosingStreak,
          losingStreak
        );
    }
  }

  return {
    initial,
    final:
      Math.round(bank),

    profit:
      Math.round(
        bank-initial
      ),

    mdd:
      +(maxDD*100)
        .toFixed(2),

    maxLosingStreak
  };
}

function month(x) {
  return x.date.slice(
    0,
    7
  );
}

function monthlyTable(list) {
  const months =
    new Map();

  for (const x of list) {
    const m =
      month(x);

    if (!months.has(m)) {
      months.set(
        m,
        []
      );
    }

    months
      .get(m)
      .push(x);
  }

  return [
    ...months.entries()
  ]
    .sort(
      ([a],[b]) =>
        a.localeCompare(b)
    )
    .map(
      ([m,list]) => ({
        month:m,
        ...stats(list)
      })
    );
}

const ODDS_BUCKETS = [
  {
    name:"1.20-1.49",
    min:1.20,
    max:1.50
  },
  {
    name:"1.50-1.79",
    min:1.50,
    max:1.80
  },
  {
    name:"1.80-1.99",
    min:1.80,
    max:2.00
  },
  {
    name:"2.00-2.49",
    min:2.00,
    max:2.50
  },
  {
    name:"2.50+",
    min:2.50,
    max:Infinity
  }
];

function oddsTable(list) {
  return ODDS_BUCKETS.map(
    b => ({
      bucket:b.name,

      ...stats(
        list.filter(
          x =>
            x.odds >= b.min &&
            x.odds < b.max
        )
      )
    })
  );
}

const EV_BUCKETS = [
  {
    name:"0-3%",
    min:0,
    max:.03
  },
  {
    name:"3-5%",
    min:.03,
    max:.05
  },
  {
    name:"5-10%",
    min:.05,
    max:.10
  },
  {
    name:"10-15%",
    min:.10,
    max:.15
  },
  {
    name:"15%+",
    min:.15,
    max:Infinity
  }
];

function evTable(list) {
  return EV_BUCKETS.map(
    b => ({
      bucket:b.name,

      ...stats(
        list.filter(
          x =>
            x.adjustedEV >=
              b.min &&
            x.adjustedEV <
              b.max
        )
      )
    })
  );
}

function report(
  name,
  source
) {
  const positiveEV =
    source.filter(
      x =>
        x.adjustedEV > 0
    );

  const best =
    dailyBest(
      source
    );

  console.log();
  console.log(
    `================================ ${name}`
  );

  console.log();
  console.log(
    "ALL ADJUSTED EV > 0"
  );

  console.table([
    stats(
      positiveEV
    )
  ]);

  console.log();
  console.log(
    "MONTHLY / ALL POSITIVE EV"
  );

  console.table(
    monthlyTable(
      positiveEV
    )
  );

  console.log();
  console.log(
    "ODDS / ALL POSITIVE EV"
  );

  console.table(
    oddsTable(
      positiveEV
    )
  );

  console.log();
  console.log(
    "ADJUSTED EV BUCKET"
  );

  console.table(
    evTable(
      positiveEV
    )
  );

  console.log();
  console.log(
    "DAILY BEST"
  );

  console.table([
    stats(best)
  ]);

  console.log();
  console.log(
    "DAILY BEST MONTHLY"
  );

  console.table(
    monthlyTable(best)
  );

  console.log();
  console.log(
    "DAILY BEST BANKROLL"
  );

  console.table([
    bankrollStats(best)
  ]);

  return {
    positiveEV:
      stats(positiveEV),

    monthly:
      monthlyTable(
        positiveEV
      ),

    odds:
      oddsTable(
        positiveEV
      ),

    evBuckets:
      evTable(
        positiveEV
      ),

    dailyBest:
      stats(best),

    dailyBestMonthly:
      monthlyTable(best),

    bankroll:
      bankrollStats(best)
  };
}

console.log(
  "============================================================"
);

console.log(
  "KBO HANDICAP FORM FINAL V3.7"
);

console.log(
  "NO RETUNING"
);

console.log(
  "DISCOVERY BETA FROZEN"
);

console.log(
  "FINAL 07~09: OPENED ONCE / NO RETUNING"
);

console.log(
  "============================================================"
);

console.log(
  "FORM_SD:",
  FORM_SD
);

console.log(
  "BETA:",
  BETA
);

const output = {
  formSd:
    FORM_SD,

  beta:
    BETA,

  discovery:
    report(
      "DISCOVERY",
      D
    ),

  internal:
    report(
      "INTERNAL",
      I
    ),

  final:
    report(
      "FINAL 07~09",
      F
    )
};

fs.writeFileSync(
  "data/kbo-handi-form-final-v37.json",
  JSON.stringify(
    output,
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-handi-form-final-v37.json"
);

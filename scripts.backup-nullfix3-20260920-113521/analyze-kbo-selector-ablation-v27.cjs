const fs = require("fs");

const INPUT =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw =
  JSON.parse(
    fs.readFileSync(INPUT, "utf8")
  );

const DISC_START = "2026-03-28";
const DISC_END   = "2026-04-30";

const INT_START = "2026-05-01";
const INT_END   = "2026-06-30";

const STAKE = 10000;

function num(v) {
  const n = Number(v);

  return Number.isFinite(n)
    ? n
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
  ) {
    return "AWAY";
  }

  if (
    home &&
    label.includes(home)
  ) {
    return "HOME";
  }

  return null;
}

function signed(v,s) {
  const n = num(v);

  if (n === null) {
    return null;
  }

  if (s === "AWAY") {
    return n;
  }

  if (s === "HOME") {
    return -n;
  }

  return null;
}

const base =
  (raw.results || raw)
    .filter(x =>
      ["ML","HANDICAP"].includes(x.market) &&
      ["WIN","LOSS"].includes(x.result) &&
      Number.isFinite(Number(x.odds)) &&
      Number(x.odds) > 1 &&
      Number.isFinite(Number(x.ev))
    )
    .map(x => {
      const s =
        side(x);

      return {
        ...x,

        odds:
          Number(x.odds),

        ev:
          Number(x.ev),

        selectedSide:
          s,

        sForm:
          signed(
            x.formEdge,
            s
          ),

        sLineup:
          signed(
            x.lineupEdge,
            s
          ),

        sBullpen:
          signed(
            x.bullpenEdge,
            s
          )
      };
    })
    .filter(x =>
      x.selectedSide !== null
    );

/*
  V2.6과 동일한 후보.
  조건 변경 금지.
*/
const candidates =
  base.filter(x =>
    x.ev >= 0.03 &&
    x.ev < 0.10
  );

const discoveryBase =
  base.filter(x =>
    x.date >= DISC_START &&
    x.date <= DISC_END
  );

function sd(values) {
  if (
    values.length < 2
  ) {
    return 1;
  }

  const m =
    values.reduce(
      (a,b) => a+b,
      0
    ) /
    values.length;

  const variance =
    values.reduce(
      (sum,v) =>
        sum +
        (v-m) ** 2,
      0
    ) /
    values.length;

  return (
    Math.sqrt(
      variance
    ) ||
    1
  );
}

const scales = {
  ML:{
    FORM:
      sd(
        discoveryBase
          .filter(
            x =>
              x.market === "ML" &&
              x.sForm !== null
          )
          .map(
            x => x.sForm
          )
      ),

    LINEUP:
      sd(
        discoveryBase
          .filter(
            x =>
              x.market === "ML" &&
              x.sLineup !== null
          )
          .map(
            x => x.sLineup
          )
      ),

    BULLPEN:
      sd(
        discoveryBase
          .filter(
            x =>
              x.market === "ML" &&
              x.sBullpen !== null
          )
          .map(
            x => x.sBullpen
          )
      )
  },

  HANDICAP:{
    FORM:
      sd(
        discoveryBase
          .filter(
            x =>
              x.market === "HANDICAP" &&
              x.sForm !== null
          )
          .map(
            x => x.sForm
          )
      )
  }
};

function z(
  value,
  scale
) {
  if (
    value === null ||
    !Number.isFinite(value)
  ) {
    return 0;
  }

  return value /
    scale;
}

function edgeSignal(x) {
  if (
    x.market === "ML"
  ) {
    const form =
      -z(
        x.sForm,
        scales.ML.FORM
      );

    const lineup =
      -z(
        x.sLineup,
        scales.ML.LINEUP
      );

    const bullpen =
      -z(
        x.sBullpen,
        scales.ML.BULLPEN
      );

    return (
      form +
      lineup +
      bullpen
    ) / 3;
  }

  if (
    x.market === "HANDICAP"
  ) {
    return z(
      x.sForm,
      scales.HANDICAP.FORM
    );
  }

  return 0;
}

/*
  세 모델만 비교.
  가중치 탐색 없음.
*/
const MODELS = {
  EV_ONLY:x =>
    x.ev / 0.05,

  EDGE_ONLY:x =>
    edgeSignal(x),

  HYBRID_50_50:x =>
    (
      x.ev / 0.05
    ) * 0.50 +
    edgeSignal(x) * 0.50
};

function stats(list) {
  let wins = 0;
  let losses = 0;

  let returned = 0;
  let oddsSum = 0;

  for (const x of list) {
    oddsSum +=
      x.odds;

    if (
      x.result === "WIN"
    ) {
      wins++;

      returned +=
        STAKE *
        x.odds;
    }
    else {
      losses++;
    }
  }

  const invested =
    list.length *
    STAKE;

  const profit =
    returned -
    invested;

  return {
    bets:
      list.length,

    wins,
    losses,

    hit:
      list.length
        ? +(
            wins /
            list.length *
            100
          ).toFixed(2)
        : 0,

    avgOdds:
      list.length
        ? +(
            oddsSum /
            list.length
          ).toFixed(3)
        : 0,

    profit:
      Math.round(
        profit
      ),

    roi:
      invested
        ? +(
            profit /
            invested *
            100
          ).toFixed(2)
        : 0
  };
}

function monthly(list) {
  const map =
    new Map();

  for (const x of list) {
    const month =
      x.date.slice(0,7);

    if (!map.has(month)) {
      map.set(
        month,
        []
      );
    }

    map.get(month)
      .push(x);
  }

  return [
    ...map.entries()
  ].map(
    ([month,rows]) => ({
      month,
      ...stats(rows)
    })
  );
}

function marketMix(list) {
  const out = {};

  for (const x of list) {
    out[x.market] =
      (
        out[x.market] ||
        0
      ) + 1;
  }

  return out;
}

function evaluate(
  start,
  end,
  scoreFn
) {
  const source =
    candidates
      .filter(x =>
        x.date >= start &&
        x.date <= end
      )
      .map(x => ({
        ...x,

        edgeSignal:
          edgeSignal(x),

        modelScore:
          scoreFn(x)
      }));

  const byDate =
    new Map();

  for (const x of source) {
    if (
      !byDate.has(x.date)
    ) {
      byDate.set(
        x.date,
        []
      );
    }

    byDate
      .get(x.date)
      .push(x);
  }

  const top1 = [];
  const rank2 = [];

  for (
    const [date,list]
    of byDate
  ) {
    const sorted =
      [...list]
        .sort(
          (a,b) =>
            b.modelScore -
            a.modelScore
        );

    if (sorted[0]) {
      top1.push(
        sorted[0]
      );
    }

    if (sorted[1]) {
      rank2.push(
        sorted[1]
      );
    }
  }

  return {
    top1,
    rank2,

    top1Stats:
      stats(top1),

    rank2Stats:
      stats(rank2),

    top1Monthly:
      monthly(top1),

    rank2Monthly:
      monthly(rank2),

    top1Mix:
      marketMix(top1),

    rank2Mix:
      marketMix(rank2)
  };
}

console.log(
  "============================================================"
);

console.log(
  "KBO SELECTOR ABLATION V2.7"
);

console.log(
  "CANDIDATES FIXED: ML/HANDICAP EV 3~10%"
);

console.log(
  "MODELS: EV_ONLY / EDGE_ONLY / HYBRID_50_50"
);

console.log(
  "FINAL 07~09: LOCKED"
);

console.log(
  "============================================================"
);

const output = {};

for (
  const [name,scoreFn]
  of Object.entries(
    MODELS
  )
) {
  const d =
    evaluate(
      DISC_START,
      DISC_END,
      scoreFn
    );

  const i =
    evaluate(
      INT_START,
      INT_END,
      scoreFn
    );

  output[name] = {
    discovery:d,
    internal:i
  };

  console.log();
  console.log(
    `===== ${name} =====`
  );

  console.table([
    {
      period:"DISCOVERY",
      selector:"TOP1",
      ...d.top1Stats
    },
    {
      period:"INTERNAL",
      selector:"TOP1",
      ...i.top1Stats
    },
    {
      period:"DISCOVERY",
      selector:"RANK2",
      ...d.rank2Stats
    },
    {
      period:"INTERNAL",
      selector:"RANK2",
      ...i.rank2Stats
    }
  ]);

  console.log(
    "DISC TOP1 MIX:",
    d.top1Mix
  );

  console.log(
    "INT TOP1 MIX:",
    i.top1Mix
  );

  console.log();
  console.log(
    "DISC TOP1 MONTHLY"
  );

  console.table(
    d.top1Monthly
  );

  console.log(
    "INT TOP1 MONTHLY"
  );

  console.table(
    i.top1Monthly
  );
}

/*
  동일한 날에 각 모델이
  어떤 픽을 골랐는지 비교.
*/
function pickKey(x) {
  if (!x) {
    return null;
  }

  return `${x.gameId}:${x.market}:${x.label}`;
}

function agreement(
  a,
  b
) {
  const am =
    new Map(
      a.map(
        x => [
          x.date,
          pickKey(x)
        ]
      )
    );

  const bm =
    new Map(
      b.map(
        x => [
          x.date,
          pickKey(x)
        ]
      )
    );

  let commonDays = 0;
  let same = 0;

  for (
    const [date,key]
    of am
  ) {
    if (
      !bm.has(date)
    ) {
      continue;
    }

    commonDays++;

    if (
      bm.get(date) === key
    ) {
      same++;
    }
  }

  return {
    commonDays,
    same,

    rate:
      commonDays
        ? +(
            same /
            commonDays *
            100
          ).toFixed(2)
        : 0
  };
}

console.log();
console.log(
  "===== TOP1 MODEL AGREEMENT ====="
);

console.table([
  {
    period:"DISCOVERY",
    pair:"EV vs EDGE",
    ...agreement(
      output.EV_ONLY
        .discovery
        .top1,

      output.EDGE_ONLY
        .discovery
        .top1
    )
  },
  {
    period:"INTERNAL",
    pair:"EV vs EDGE",
    ...agreement(
      output.EV_ONLY
        .internal
        .top1,

      output.EDGE_ONLY
        .internal
        .top1
    )
  },
  {
    period:"DISCOVERY",
    pair:"EV vs HYBRID",
    ...agreement(
      output.EV_ONLY
        .discovery
        .top1,

      output.HYBRID_50_50
        .discovery
        .top1
    )
  },
  {
    period:"INTERNAL",
    pair:"EV vs HYBRID",
    ...agreement(
      output.EV_ONLY
        .internal
        .top1,

      output.HYBRID_50_50
        .internal
        .top1
    )
  }
]);

console.log();
console.log(
  "===== INTERPRETATION TABLE ====="
);

console.table(
  Object.entries(output)
    .map(
      ([name,x]) => ({
        model:name,

        DBets:
          x.discovery
            .top1Stats
            .bets,

        DROI:
          x.discovery
            .top1Stats
            .roi,

        IBets:
          x.internal
            .top1Stats
            .bets,

        IROI:
          x.internal
            .top1Stats
            .roi,

        minROI:
          +Math.min(
            x.discovery
              .top1Stats
              .roi,

            x.internal
              .top1Stats
              .roi
          ).toFixed(2)
      })
    )
);

fs.writeFileSync(
  "data/kbo-selector-ablation-v27.json",
  JSON.stringify(
    {
      generatedAt:
        new Date()
          .toISOString(),

      final:
        "LOCKED",

      candidateRule:
        "ML/HANDICAP EV >= 3% and < 10%",

      models:
        Object.keys(
          MODELS
        ),

      scales,

      output
    },
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-selector-ablation-v27.json"
);

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

function num(v) {
  const n =
    Number(v);

  return Number.isFinite(n)
    ? n
    : null;
}

function sideOf(x) {
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

function signed(v,side) {
  const n =
    num(v);

  if (n === null) {
    return null;
  }

  return side === "AWAY"
    ? n
    : -n;
}

const rows =
  (raw.results || raw)
    .filter(x =>
      ["WIN","LOSS"].includes(x.result) &&
      ["ML","HANDICAP","TOTAL"].includes(x.market) &&
      Number.isFinite(Number(x.odds)) &&
      Number(x.odds) > 1
    )
    .map(x => {
      let confidence =
        num(x.confidence);

      if (
        confidence !== null &&
        confidence > 1
      ) {
        confidence /= 100;
      }

      const side =
        sideOf(x);

      return {
        ...x,

        odds:
          Number(x.odds),

        confidence,

        actual:
          x.result === "WIN"
            ? 1
            : 0,

        side,

        signedStarter:
          side
            ? signed(
                x.starterEdge,
                side
              )
            : null,

        signedForm:
          side
            ? signed(
                x.formEdge,
                side
              )
            : null,

        signedBullpen:
          side
            ? signed(
                x.bullpenEdge,
                side
              )
            : null,

        signedLineup:
          side
            ? signed(
                x.lineupEdge,
                side
              )
            : null,

        totalEdgeValue:
          num(x.totalEdge)
      };
    });

const groups =
  new Map();

for (
  const x
  of rows
) {
  const key =
    `${x.date}:${x.gameId}:${x.market}`;

  if (!groups.has(key)) {
    groups.set(
      key,
      []
    );
  }

  groups
    .get(key)
    .push(x);
}

const pairedRows = [];

let rejectedNot2 = 0;

for (
  const [key,list]
  of groups
) {
  if (
    list.length !== 2
  ) {
    rejectedNot2++;
    continue;
  }

  const a =
    list[0];

  const b =
    list[1];

  const invA =
    1 / a.odds;

  const invB =
    1 / b.odds;

  const denom =
    invA + invB;

  if (
    !Number.isFinite(denom) ||
    denom <= 0
  ) {
    continue;
  }

  const pA =
    invA / denom;

  const pB =
    invB / denom;

  pairedRows.push({
    ...a,

    oppositeOdds:
      b.odds,

    marketProb:
      pA,

    residual:
      a.actual - pA,

    marketEdge:
      a.confidence === null
        ? null
        : a.confidence - pA
  });

  pairedRows.push({
    ...b,

    oppositeOdds:
      a.odds,

    marketProb:
      pB,

    residual:
      b.actual - pB,

    marketEdge:
      b.confidence === null
        ? null
        : b.confidence - pB
  });
}

function inPeriod(
  x,
  start,
  end
) {
  return (
    x.date >= start &&
    x.date <= end
  );
}

function mean(list) {
  if (!list.length) {
    return 0;
  }

  return (
    list.reduce(
      (a,b) =>
        a+b,
      0
    ) /
    list.length
  );
}

function sd(list) {
  if (
    list.length < 2
  ) {
    return 1;
  }

  const m =
    mean(list);

  const v =
    mean(
      list.map(
        x =>
          (x-m) ** 2
      )
    );

  return (
    Math.sqrt(v) ||
    1
  );
}

function covariance(xs,ys) {
  if (
    xs.length !== ys.length ||
    xs.length < 2
  ) {
    return 0;
  }

  const mx =
    mean(xs);

  const my =
    mean(ys);

  return mean(
    xs.map(
      (x,i) =>
        (x-mx) *
        (ys[i]-my)
    )
  );
}

function correlation(xs,ys) {
  if (
    xs.length !== ys.length ||
    xs.length < 2
  ) {
    return 0;
  }

  const sx =
    sd(xs);

  const sy =
    sd(ys);

  if (
    sx === 0 ||
    sy === 0
  ) {
    return 0;
  }

  return (
    covariance(
      xs,
      ys
    ) /
    (
      sx *
      sy
    )
  );
}

function slope(xs,ys) {
  if (
    xs.length !== ys.length ||
    xs.length < 2
  ) {
    return 0;
  }

  const variance =
    sd(xs) ** 2;

  if (
    variance === 0
  ) {
    return 0;
  }

  return (
    covariance(
      xs,
      ys
    ) /
    variance
  );
}

function signalStats(
  source,
  getter
) {
  const filtered =
    source
      .map(x => ({
        x,
        signal:
          getter(x)
      }))
      .filter(
        o =>
          Number.isFinite(
            o.signal
          )
      );

  if (!filtered.length) {
    return {
      n:0,
      corr:0,
      slope:0,
      posN:0,
      posResidual:0,
      negN:0,
      negResidual:0,
      spread:0
    };
  }

  const xs =
    filtered.map(
      o => o.signal
    );

  const ys =
    filtered.map(
      o => o.x.residual
    );

  const pos =
    filtered.filter(
      o =>
        o.signal > 0
    );

  const neg =
    filtered.filter(
      o =>
        o.signal < 0
    );

  const posResidual =
    pos.length
      ? mean(
          pos.map(
            o =>
              o.x.residual
          )
        )
      : 0;

  const negResidual =
    neg.length
      ? mean(
          neg.map(
            o =>
              o.x.residual
          )
        )
      : 0;

  return {
    n:
      filtered.length,

    corr:
      +correlation(
        xs,
        ys
      ).toFixed(4),

    slope:
      +slope(
        xs,
        ys
      ).toFixed(6),

    posN:
      pos.length,

    posResidual:
      +(posResidual*100)
        .toFixed(3),

    negN:
      neg.length,

    negResidual:
      +(negResidual*100)
        .toFixed(3),

    spread:
      +(
        (
          posResidual -
          negResidual
        ) *
        100
      ).toFixed(3)
  };
}

const discovery =
  pairedRows.filter(
    x =>
      inPeriod(
        x,
        DISC_START,
        DISC_END
      )
  );

const internal =
  pairedRows.filter(
    x =>
      inPeriod(
        x,
        INT_START,
        INT_END
      )
  );

function scaleFor(
  market,
  field
) {
  return sd(
    discovery
      .filter(
        x =>
          x.market === market &&
          Number.isFinite(
            x[field]
          )
      )
      .map(
        x =>
          x[field]
      )
  );
}

const scales = {
  ML:{
    STARTER:
      scaleFor(
        "ML",
        "signedStarter"
      ),

    FORM:
      scaleFor(
        "ML",
        "signedForm"
      ),

    BULLPEN:
      scaleFor(
        "ML",
        "signedBullpen"
      ),

    LINEUP:
      scaleFor(
        "ML",
        "signedLineup"
      )
  },

  HANDICAP:{
    STARTER:
      scaleFor(
        "HANDICAP",
        "signedStarter"
      ),

    FORM:
      scaleFor(
        "HANDICAP",
        "signedForm"
      ),

    BULLPEN:
      scaleFor(
        "HANDICAP",
        "signedBullpen"
      ),

    LINEUP:
      scaleFor(
        "HANDICAP",
        "signedLineup"
      )
  },

  TOTAL:{
    TOTAL_EDGE:
      scaleFor(
        "TOTAL",
        "totalEdgeValue"
      )
  }
};

function z(
  value,
  scale
) {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(scale) ||
    scale === 0
  ) {
    return null;
  }

  return value /
    scale;
}

const SIGNALS = {
  ML:{
    CONFIDENCE:
      x =>
        Number.isFinite(
          x.confidence
        )
          ? (
              x.confidence -
              x.marketProb
            )
          : null,

    STARTER:
      x =>
        z(
          x.signedStarter,
          scales.ML.STARTER
        ),

    FORM:
      x =>
        z(
          x.signedForm,
          scales.ML.FORM
        ),

    BULLPEN:
      x =>
        z(
          x.signedBullpen,
          scales.ML.BULLPEN
        ),

    LINEUP:
      x =>
        z(
          x.signedLineup,
          scales.ML.LINEUP
        )
  },

  HANDICAP:{
    CONFIDENCE:
      x =>
        Number.isFinite(
          x.confidence
        )
          ? (
              x.confidence -
              x.marketProb
            )
          : null,

    STARTER:
      x =>
        z(
          x.signedStarter,
          scales.HANDICAP.STARTER
        ),

    FORM:
      x =>
        z(
          x.signedForm,
          scales.HANDICAP.FORM
        ),

    BULLPEN:
      x =>
        z(
          x.signedBullpen,
          scales.HANDICAP.BULLPEN
        ),

    LINEUP:
      x =>
        z(
          x.signedLineup,
          scales.HANDICAP.LINEUP
        )
  },

  TOTAL:{
    CONFIDENCE:
      x =>
        Number.isFinite(
          x.confidence
        )
          ? (
              x.confidence -
              x.marketProb
            )
          : null,

    TOTAL_EDGE:
      x =>
        z(
          x.totalEdgeValue,
          scales.TOTAL.TOTAL_EDGE
        )
  }
};

function signLabel(v) {
  if (v > 0) {
    return "POSITIVE";
  }

  if (v < 0) {
    return "NEGATIVE";
  }

  return "ZERO";
}

function evaluateMarket(
  market
) {
  const d =
    discovery.filter(
      x =>
        x.market === market
    );

  const i =
    internal.filter(
      x =>
        x.market === market
    );

  const out = {};

  for (
    const [name,getter]
    of Object.entries(
      SIGNALS[market]
    )
  ) {
    const ds =
      signalStats(
        d,
        getter
      );

    const is =
      signalStats(
        i,
        getter
      );

    const dDirection =
      signLabel(
        ds.slope
      );

    const iDirection =
      signLabel(
        is.slope
      );

    out[name] = {
      discovery:
        ds,

      internal:
        is,

      dDirection,
      iDirection,

      sameDirection:
        (
          dDirection ===
          iDirection &&
          dDirection !==
          "ZERO"
        )
    };
  }

  return out;
}

function buildComposite(
  market,
  results
) {
  const chosen =
    Object.entries(
      results
    )
      .filter(
        ([name,r]) =>
          name !== "CONFIDENCE" &&
          r.sameDirection
      )
      .map(
        ([name,r]) => ({
          name,
          direction:
            r.dDirection ===
            "POSITIVE"
              ? 1
              : -1
        })
      );

  function getter(x) {
    if (!chosen.length) {
      return null;
    }

    const values = [];

    for (
      const c
      of chosen
    ) {
      const raw =
        SIGNALS[market][c.name](x);

      if (
        Number.isFinite(raw)
      ) {
        values.push(
          raw *
          c.direction
        );
      }
    }

    if (!values.length) {
      return null;
    }

    return mean(values);
  }

  return {
    chosen,

    discovery:
      signalStats(
        discovery.filter(
          x =>
            x.market === market
        ),
        getter
      ),

    internal:
      signalStats(
        internal.filter(
          x =>
            x.market === market
        ),
        getter
      )
  };
}

console.log(
  "============================================================"
);

console.log(
  "KBO NO-VIG RESIDUAL AUDIT V3.4"
);

console.log(
  "MARKET BASELINE = TWO-SIDED NO-VIG PROBABILITY"
);

console.log(
  "FINAL 07~09: LOCKED"
);

console.log(
  "============================================================"
);

console.log();
console.log(
  "PAIRED ROWS:",
  pairedRows.length
);

console.log(
  "REJECTED GROUPS NOT EXACTLY 2:",
  rejectedNot2
);

console.log();
console.log(
  "===== DISCOVERY-FIXED SCALES ====="
);

console.dir(
  scales,
  {
    depth:null
  }
);

const results = {};

for (
  const market
  of [
    "ML",
    "HANDICAP",
    "TOTAL"
  ]
) {
  results[market] =
    evaluateMarket(
      market
    );

  console.log();
  console.log(
    `===== ${market} SIGNAL AUDIT =====`
  );

  console.table(
    Object.entries(
      results[market]
    )
      .map(
        ([name,r]) => ({
          signal:
            name,

          DN:
            r.discovery.n,

          DCorr:
            r.discovery.corr,

          DSlope:
            r.discovery.slope,

          DPosResidual:
            r.discovery.posResidual,

          DNegResidual:
            r.discovery.negResidual,

          DSpread:
            r.discovery.spread,

          IN:
            r.internal.n,

          ICorr:
            r.internal.corr,

          ISlope:
            r.internal.slope,

          IPosResidual:
            r.internal.posResidual,

          INegResidual:
            r.internal.negResidual,

          ISpread:
            r.internal.spread,

          direction:
            `${r.dDirection}/${r.iDirection}`,

          same:
            r.sameDirection
        }))
  );
}

const composites = {};

for (
  const market
  of [
    "ML",
    "HANDICAP"
  ]
) {
  composites[market] =
    buildComposite(
      market,
      results[market]
    );

  console.log();
  console.log(
    `===== ${market} COMPOSITE =====`
  );

  console.log(
    "CHOSEN:",
    composites[market]
      .chosen
  );

  console.table([
    {
      period:
        "DISCOVERY",
      ...composites[market]
        .discovery
    },
    {
      period:
        "INTERNAL",
      ...composites[market]
        .internal
    }
  ]);
}

function marketCalibration(
  source,
  market
) {
  const x =
    source.filter(
      r =>
        r.market === market
    );

  if (!x.length) {
    return {};
  }

  const avgProb =
    mean(
      x.map(
        r =>
          r.marketProb
      )
    );

  const actual =
    mean(
      x.map(
        r =>
          r.actual
      )
    );

  const brier =
    mean(
      x.map(
        r =>
          (
            r.marketProb -
            r.actual
          ) ** 2
      )
    );

  return {
    bets:
      x.length,

    avgMarketProb:
      +(avgProb*100)
        .toFixed(2),

    actual:
      +(actual*100)
        .toFixed(2),

    gap:
      +(
        (
          actual -
          avgProb
        ) *
        100
      ).toFixed(2),

    brier:
      +brier
        .toFixed(4)
  };
}

console.log();
console.log(
  "===== MARKET NO-VIG CALIBRATION ====="
);

for (
  const market
  of [
    "ML",
    "HANDICAP",
    "TOTAL"
  ]
) {
  console.log();
  console.log(market);

  console.table([
    {
      period:
        "DISCOVERY",
      ...marketCalibration(
        discovery,
        market
      )
    },
    {
      period:
        "INTERNAL",
      ...marketCalibration(
        internal,
        market
      )
    }
  ]);
}

fs.writeFileSync(
  "data/kbo-novig-residual-v34.json",
  JSON.stringify(
    {
      generatedAt:
        new Date()
          .toISOString(),

      final:
        "LOCKED",

      pairedRows:
        pairedRows.length,

      rejectedNot2,

      scales,

      results,

      composites
    },
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-novig-residual-v34.json"
);

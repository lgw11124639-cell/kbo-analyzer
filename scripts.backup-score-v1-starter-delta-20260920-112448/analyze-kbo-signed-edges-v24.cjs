const fs = require("fs");

const INPUT =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw =
  JSON.parse(
    fs.readFileSync(INPUT, "utf8")
  );

const DISC_START = "2026-03-28";
const DISC_END   = "2026-04-30";

const INTERNAL_START = "2026-05-01";
const INTERNAL_END   = "2026-06-30";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function selectedTeam(x) {
  const label = String(x.label || "");

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

function signed(v, side) {
  const n = num(v);

  if (side === "AWAY") {
    return n;
  }

  if (side === "HOME") {
    return -n;
  }

  return null;
}

const rows =
  (raw.results || raw)
    .filter(x =>
      ["ML","HANDICAP"].includes(x.market) &&
      ["WIN","LOSS"].includes(x.result)
    )
    .map(x => {
      const side =
        selectedTeam(x);

      return {
        ...x,

        selectedSide:side,

        signedStarter:
          signed(
            x.starterEdge,
            side
          ),

        signedForm:
          signed(
            x.formEdge,
            side
          ),

        signedBullpen:
          signed(
            x.bullpenEdge,
            side
          ),

        signedLineup:
          signed(
            x.lineupEdge,
            side
          )
      };
    })
    .filter(x =>
      x.selectedSide !== null
    );

function periodRows(
  start,
  end
) {
  return rows.filter(x =>
    x.date >= start &&
    x.date <= end
  );
}

const EDGES = [
  ["STARTER","signedStarter"],
  ["FORM","signedForm"],
  ["BULLPEN","signedBullpen"],
  ["LINEUP","signedLineup"]
];

function stat(source) {
  const wins =
    source.filter(
      x => x.result === "WIN"
    ).length;

  const losses =
    source.filter(
      x => x.result === "LOSS"
    ).length;

  return {
    bets:
      source.length,

    wins,
    losses,

    hit:
      source.length
        ? +(
            wins /
            source.length *
            100
          ).toFixed(2)
        : 0
  };
}

function auditEdge(
  source,
  key
) {
  const nonZero =
    source.filter(
      x =>
        Number.isFinite(x[key]) &&
        Math.abs(x[key]) > 1e-9
    );

  const positive =
    nonZero.filter(
      x => x[key] > 0
    );

  const negative =
    nonZero.filter(
      x => x[key] < 0
    );

  const sorted =
    [...nonZero]
      .sort(
        (a,b) =>
          a[key] - b[key]
      );

  const buckets = [];

  if (sorted.length) {
    for (
      let i = 0;
      i < 4;
      i++
    ) {
      const start =
        Math.floor(
          sorted.length *
          i / 4
        );

      const end =
        Math.floor(
          sorted.length *
          (i+1) / 4
        );

      const part =
        sorted.slice(
          start,
          end
        );

      if (!part.length) {
        continue;
      }

      const s =
        stat(part);

      buckets.push({
        quartile:
          `Q${i+1}`,

        min:
          +Math.min(
            ...part.map(x => x[key])
          ).toFixed(3),

        max:
          +Math.max(
            ...part.map(x => x[key])
          ).toFixed(3),

        ...s
      });
    }
  }

  return {
    total:
      stat(nonZero),

    positive:
      stat(positive),

    negative:
      stat(negative),

    buckets
  };
}

function auditMarket(
  source,
  market
) {
  const marketRows =
    source.filter(
      x => x.market === market
    );

  const result = {};

  for (
    const [name,key]
    of EDGES
  ) {
    result[name] =
      auditEdge(
        marketRows,
        key
      );
  }

  return result;
}

function printPeriod(
  name,
  source
) {
  console.log();
  console.log(
    "============================================================"
  );

  console.log(name);

  console.log(
    "ROWS:",
    source.length
  );

  console.log(
    "============================================================"
  );

  for (
    const market
    of ["ML","HANDICAP"]
  ) {
    console.log();
    console.log(
      `===== ${market} =====`
    );

    const audit =
      auditMarket(
        source,
        market
      );

    const summary = [];

    for (
      const [edgeName]
      of EDGES
    ) {
      const x =
        audit[edgeName];

      summary.push({
        edge:
          edgeName,

        nonZero:
          x.total.bets,

        posBets:
          x.positive.bets,

        posHit:
          x.positive.hit,

        negBets:
          x.negative.bets,

        negHit:
          x.negative.hit,

        spread:
          +(
            x.positive.hit -
            x.negative.hit
          ).toFixed(2)
      });
    }

    console.table(summary);

    for (
      const [edgeName]
      of EDGES
    ) {
      console.log();
      console.log(
        `${market} / ${edgeName} QUARTILES`
      );

      console.table(
        audit[edgeName].buckets
      );
    }
  }

  return {
    ML:
      auditMarket(
        source,
        "ML"
      ),

    HANDICAP:
      auditMarket(
        source,
        "HANDICAP"
      )
  };
}

const discovery =
  periodRows(
    DISC_START,
    DISC_END
  );

const internal =
  periodRows(
    INTERNAL_START,
    INTERNAL_END
  );

console.log(
  "============================================================"
);

console.log(
  "KBO SIGNED EDGE AUDIT V2.4"
);

console.log(
  "RAW EDGE DIRECTION: AWAY - HOME"
);

console.log(
  "SIGNED EDGE: PICK TEAM ADVANTAGE"
);

console.log(
  "DISCOVERY:",
  DISC_START,
  "~",
  DISC_END
);

console.log(
  "INTERNAL:",
  INTERNAL_START,
  "~",
  INTERNAL_END
);

console.log(
  "FINAL 07~09: LOCKED"
);

console.log(
  "============================================================"
);

const discResult =
  printPeriod(
    "DISCOVERY",
    discovery
  );

const internalResult =
  printPeriod(
    "INTERNAL",
    internal
  );

fs.writeFileSync(
  "data/kbo-signed-edges-v24.json",
  JSON.stringify(
    {
      generatedAt:
        new Date().toISOString(),

      direction:
        "raw edge = away - home; signed edge = selected team advantage",

      periods:{
        discovery:[
          DISC_START,
          DISC_END
        ],

        internal:[
          INTERNAL_START,
          INTERNAL_END
        ],

        final:
          "LOCKED"
      },

      discovery:
        discResult,

      internal:
        internalResult
    },
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-signed-edges-v24.json"
);

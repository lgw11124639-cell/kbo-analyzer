const fs = require("fs");

const INPUT =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw =
  JSON.parse(
    fs.readFileSync(INPUT, "utf8")
  );

const DISC_START = "2026-03-28";
const DISC_END   = "2026-04-30";

const INT_START  = "2026-05-01";
const INT_END    = "2026-06-30";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n)
    ? n
    : null;
}

function selectedSide(x) {
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

function signed(v,side) {
  const n = num(v);

  if (n === null) {
    return null;
  }

  if (side === "AWAY") {
    return n;
  }

  if (side === "HOME") {
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
      Number(x.odds) > 1
    )
    .map(x => ({
      ...x,
      odds:Number(x.odds)
    }));

/*
  ------------------------------------------------------
  같은 경기 / 같은 시장의 반대편 배당을 찾아 no-vig 계산
  ------------------------------------------------------
*/
const groups =
  new Map();

for (const x of base) {
  const key =
    `${x.gameId}:${x.market}`;

  if (!groups.has(key)) {
    groups.set(key,[]);
  }

  groups.get(key).push(x);
}

const rows = [];

for (
  const [key,list]
  of groups
) {
  if (list.length !== 2) {
    continue;
  }

  const [a,b] = list;

  const ia =
    1 / a.odds;

  const ib =
    1 / b.odds;

  const total =
    ia + ib;

  if (
    !Number.isFinite(total) ||
    total <= 0
  ) {
    continue;
  }

  for (
    const [x,opp]
    of [[a,b],[b,a]]
  ) {
    const side =
      selectedSide(x);

    if (!side) {
      continue;
    }

    const implied =
      1 / x.odds;

    const marketProb =
      implied /
      (
        implied +
        1 / opp.odds
      );

    const actual =
      x.result === "WIN"
        ? 1
        : 0;

    rows.push({
      ...x,

      selectedSide:
        side,

      marketProb,

      actual,

      residual:
        actual -
        marketProb,

      flatReturn:
        actual
          ? x.odds
          : 0,

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
    });
  }
}

const EDGES = [
  ["STARTER","signedStarter"],
  ["FORM","signedForm"],
  ["BULLPEN","signedBullpen"],
  ["LINEUP","signedLineup"]
];

function mean(arr) {
  if (!arr.length) return 0;

  return (
    arr.reduce(
      (a,b) => a+b,
      0
    ) /
    arr.length
  );
}

function sd(arr) {
  if (arr.length < 2) {
    return 0;
  }

  const m =
    mean(arr);

  const variance =
    mean(
      arr.map(
        x =>
          (x-m) ** 2
      )
    );

  return Math.sqrt(
    variance
  );
}

function calibrationStat(list) {
  if (!list.length) {
    return {
      bets:0,
      avgMarket:0,
      hit:0,
      calibration:0,
      avgOdds:0,
      roi:0
    };
  }

  const market =
    mean(
      list.map(
        x => x.marketProb
      )
    );

  const hit =
    mean(
      list.map(
        x => x.actual
      )
    );

  const avgOdds =
    mean(
      list.map(
        x => x.odds
      )
    );

  const returned =
    list.reduce(
      (sum,x) =>
        sum +
        x.flatReturn,
      0
    );

  return {
    bets:
      list.length,

    avgMarket:
      +(market*100)
        .toFixed(2),

    hit:
      +(hit*100)
        .toFixed(2),

    calibration:
      +(
        (hit-market) *
        100
      ).toFixed(2),

    avgOdds:
      +avgOdds
        .toFixed(3),

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

function slope(
  list,
  zKey
) {
  const usable =
    list.filter(
      x =>
        Number.isFinite(x[zKey]) &&
        Number.isFinite(x.residual)
    );

  if (usable.length < 2) {
    return 0;
  }

  const xs =
    usable.map(
      x => x[zKey]
    );

  const ys =
    usable.map(
      x => x.residual
    );

  const mx = mean(xs);
  const my = mean(ys);

  let cov = 0;
  let variance = 0;

  for (
    let i=0;
    i<usable.length;
    i++
  ) {
    cov +=
      (xs[i]-mx) *
      (ys[i]-my);

    variance +=
      (xs[i]-mx) ** 2;
  }

  if (!variance) {
    return 0;
  }

  return cov /
    variance;
}

/*
  Discovery 분포로 mean / sd를 고정.
  Internal에서 다시 계산하지 않는다.
*/
const discovery =
  rows.filter(
    x =>
      x.date >= DISC_START &&
      x.date <= DISC_END
  );

const internal =
  rows.filter(
    x =>
      x.date >= INT_START &&
      x.date <= INT_END
  );

const scaling = {};

for (
  const market
  of ["ML","HANDICAP"]
) {
  scaling[market] = {};

  for (
    const [name,key]
    of EDGES
  ) {
    const vals =
      discovery
        .filter(
          x =>
            x.market === market &&
            x[key] !== null &&
            Number.isFinite(x[key]) &&
            Math.abs(x[key]) > 1e-9
        )
        .map(
          x => x[key]
        );

    scaling[market][name] = {
      mean:
        mean(vals),

      sd:
        sd(vals)
    };
  }
}

function attachZ(source) {
  return source.map(
    x => {
      const copy = {
        ...x
      };

      for (
        const [name,key]
        of EDGES
      ) {
        const cfg =
          scaling[x.market]?.[name];

        const zKey =
          `z${name}`;

        if (
          !cfg ||
          !cfg.sd ||
          x[key] === null ||
          !Number.isFinite(x[key])
        ) {
          copy[zKey] =
            null;
        }
        else {
          copy[zKey] =
            (
              x[key] -
              cfg.mean
            ) /
            cfg.sd;
        }
      }

      return copy;
    }
  );
}

const discZ =
  attachZ(discovery);

const intZ =
  attachZ(internal);

const BUCKETS = [
  {
    name:"Z <= -1",
    fn:z => z <= -1
  },
  {
    name:"-1 < Z <= 0",
    fn:z =>
      z > -1 &&
      z <= 0
  },
  {
    name:"0 < Z < 1",
    fn:z =>
      z > 0 &&
      z < 1
  },
  {
    name:"Z >= 1",
    fn:z => z >= 1
  }
];

function audit(
  source,
  market,
  edgeName
) {
  const zKey =
    `z${edgeName}`;

  const rows =
    source.filter(
      x =>
        x.market === market &&
        Number.isFinite(
          x[zKey]
        )
    );

  const buckets =
    BUCKETS.map(
      b => ({
        bucket:
          b.name,

        ...calibrationStat(
          rows.filter(
            x =>
              b.fn(
                x[zKey]
              )
          )
        )
      })
    );

  return {
    bets:
      rows.length,

    slope:
      +(
        slope(
          rows,
          zKey
        ) *
        100
      ).toFixed(3),

    buckets
  };
}

console.log(
  "============================================================"
);

console.log(
  "KBO EDGE CALIBRATION V2.5"
);

console.log(
  "BASELINE = MARKET NO-VIG PROBABILITY"
);

console.log(
  "Z SCALE = DISCOVERY FIXED"
);

console.log(
  "DISCOVERY:",
  DISC_START,
  "~",
  DISC_END
);

console.log(
  "INTERNAL:",
  INT_START,
  "~",
  INT_END
);

console.log(
  "FINAL 07~09: LOCKED"
);

console.log(
  "============================================================"
);

console.log();
console.log(
  "===== DISCOVERY SCALE ====="
);

for (
  const market
  of ["ML","HANDICAP"]
) {
  console.log();
  console.log(market);

  console.table(
    EDGES.map(
      ([name]) => ({
        edge:name,

        mean:
          +scaling[
            market
          ][name]
            .mean
            .toFixed(3),

        sd:
          +scaling[
            market
          ][name]
            .sd
            .toFixed(3)
      })
    )
  );
}

const output = {};

for (
  const market
  of ["ML","HANDICAP"]
) {
  output[market] = {};

  console.log();
  console.log(
    "============================================================"
  );

  console.log(
    market
  );

  console.log(
    "============================================================"
  );

  for (
    const [edgeName]
    of EDGES
  ) {
    const d =
      audit(
        discZ,
        market,
        edgeName
      );

    const i =
      audit(
        intZ,
        market,
        edgeName
      );

    output[market][edgeName] = {
      discovery:d,
      internal:i
    };

    console.log();
    console.log(
      `===== ${market} / ${edgeName} =====`
    );

    console.log(
      "SLOPE",
      "DISC:",
      d.slope,
      "INT:",
      i.slope
    );

    console.log();
    console.log(
      "DISCOVERY"
    );

    console.table(
      d.buckets
    );

    console.log(
      "INTERNAL"
    );

    console.table(
      i.buckets
    );
  }
}

/*
  단순 후보 판정:
  slope 방향이 두 기간에서 동일한지.

  여기서는 ROI로 모델 선택하지 않는다.
*/
const candidates = [];

for (
  const market
  of ["ML","HANDICAP"]
) {
  for (
    const [edgeName]
    of EDGES
  ) {
    const x =
      output[
        market
      ][edgeName];

    const ds =
      x.discovery.slope;

    const is =
      x.internal.slope;

    const samePositive =
      ds > 0 &&
      is > 0;

    const sameNegative =
      ds < 0 &&
      is < 0;

    if (
      samePositive ||
      sameNegative
    ) {
      candidates.push({
        market,
        edge:edgeName,

        direction:
          samePositive
            ? "POSITIVE"
            : "NEGATIVE",

        discSlope:
          ds,

        intSlope:
          is,

        minAbsSlope:
          +Math.min(
            Math.abs(ds),
            Math.abs(is)
          ).toFixed(3)
      });
    }
  }
}

candidates.sort(
  (a,b) =>
    b.minAbsSlope -
    a.minAbsSlope
);

console.log();
console.log(
  "===== SAME-DIRECTION CALIBRATION CANDIDATES ====="
);

console.table(
  candidates
);

fs.writeFileSync(
  "data/kbo-edge-calibration-v25.json",
  JSON.stringify(
    {
      generatedAt:
        new Date()
          .toISOString(),

      final:
        "LOCKED",

      baseline:
        "market no-vig probability",

      scaling:
        scaling,

      results:
        output,

      candidates
    },
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-edge-calibration-v25.json"
);

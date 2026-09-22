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

function label(x) {
  return String(
    x.label || ""
  ).toUpperCase();
}

function isOver(x) {
  return (
    x.market === "TOTAL" &&
    (
      label(x).includes("OVER") ||
      label(x).includes("오버")
    )
  );
}

function side(x) {
  const l =
    String(x.label || "");

  const away =
    String(x.awayTeam || "");

  const home =
    String(x.homeTeam || "");

  if (
    away &&
    l.includes(away)
  ) {
    return "AWAY";
  }

  if (
    home &&
    l.includes(home)
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

  return s === "AWAY"
    ? n
    : -n;
}

function sd(values) {
  if (values.length < 2) {
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
    Math.sqrt(variance) ||
    1
  );
}

const rows =
  (raw.results || raw)
    .filter(x =>
      ["WIN","LOSS"].includes(x.result) &&
      Number.isFinite(Number(x.odds)) &&
      Number(x.odds) > 1
    )
    .map(x => {
      const s =
        side(x);

      return {
        ...x,

        odds:
          Number(x.odds),

        ev:
          num(x.ev),

        selectedSide:
          s,

        sForm:
          s
            ? signed(
                x.formEdge,
                s
              )
            : null,

        sLineup:
          s
            ? signed(
                x.lineupEdge,
                s
              )
            : null,

        sBullpen:
          s
            ? signed(
                x.bullpenEdge,
                s
              )
            : null
      };
    });

const discoveryAll =
  rows.filter(x =>
    x.date >= DISC_START &&
    x.date <= DISC_END
  );

/*
  Discovery scale만 사용.
*/
const scales = {
  ML:{
    FORM:
      sd(
        discoveryAll
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
        discoveryAll
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
        discoveryAll
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
        discoveryAll
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
  v,
  scale
) {
  if (
    v === null ||
    !Number.isFinite(v)
  ) {
    return 0;
  }

  return v /
    scale;
}

/*
  고정 신호.
*/
function mlSignal(x) {
  return (
    -z(
      x.sForm,
      scales.ML.FORM
    ) +
    -z(
      x.sLineup,
      scales.ML.LINEUP
    ) +
    -z(
      x.sBullpen,
      scales.ML.BULLPEN
    )
  ) / 3;
}

function handiSignal(x) {
  return z(
    x.sForm,
    scales.HANDICAP.FORM
  );
}

/*
  threshold 최적화 금지.
  단순 방향만 사용:
  signal > 0.
*/
function familyOf(x) {
  if (
    x.market === "ML" &&
    x.selectedSide &&
    mlSignal(x) > 0
  ) {
    return "ML_EDGE";
  }

  if (
    x.market === "HANDICAP" &&
    x.selectedSide &&
    handiSignal(x) > 0
  ) {
    return "HANDI_EDGE";
  }

  if (
    isOver(x) &&
    x.ev !== null &&
    x.ev >= 0.03 &&
    x.ev < 0.10
  ) {
    return "OVER_EV3_10";
  }

  return null;
}

const candidates =
  rows
    .map(x => ({
      ...x,
      family:
        familyOf(x),

      signal:
        x.market === "ML"
          ? mlSignal(x)
          : (
              x.market === "HANDICAP"
                ? handiSignal(x)
                : (
                    x.ev !== null
                      ? x.ev / 0.05
                      : 0
                  )
            )
    }))
    .filter(x =>
      x.family !== null
    );

function stats(list) {
  let wins = 0;
  let losses = 0;
  let returned = 0;
  let oddsSum = 0;

  for (const x of list) {
    oddsSum += x.odds;

    if (x.result === "WIN") {
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
      Math.round(profit),

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

function period(
  start,
  end
) {
  return candidates.filter(x =>
    x.date >= start &&
    x.date <= end
  );
}

const discovery =
  period(
    DISC_START,
    DISC_END
  );

const internal =
  period(
    INT_START,
    INT_END
  );

const FAMILIES = [
  "ML_EDGE",
  "HANDI_EDGE",
  "OVER_EV3_10"
];

console.log(
  "============================================================"
);

console.log(
  "KBO CANDIDATE UNIVERSE V2.8"
);

console.log(
  "ML = negative FORM/LINEUP/BULLPEN composite"
);

console.log(
  "HANDICAP = positive FORM"
);

console.log(
  "TOTAL = OVER EV3~10%"
);

console.log(
  "FINAL 07~09: LOCKED"
);

console.log(
  "============================================================"
);

console.log();
console.log(
  "===== FAMILY PERFORMANCE ====="
);

const table = [];

for (
  const family
  of FAMILIES
) {
  const d =
    discovery.filter(
      x =>
        x.family === family
    );

  const i =
    internal.filter(
      x =>
        x.family === family
    );

  const ds =
    stats(d);

  const is =
    stats(i);

  table.push({
    family,

    DBets:
      ds.bets,

    DHit:
      ds.hit,

    DOdds:
      ds.avgOdds,

    DROI:
      ds.roi,

    IBets:
      is.bets,

    IHit:
      is.hit,

    IOdds:
      is.avgOdds,

    IROI:
      is.roi,

    minROI:
      +Math.min(
        ds.roi,
        is.roi
      ).toFixed(2)
  });
}

console.table(table);

/*
  하루 공급량
*/
function supply(source) {
  const byDate =
    new Map();

  for (const x of source) {
    if (!byDate.has(x.date)) {
      byDate.set(
        x.date,
        []
      );
    }

    byDate
      .get(x.date)
      .push(x);
  }

  let days1 = 0;
  let days2 = 0;
  let days3 = 0;

  let total = 0;

  for (
    const list
    of byDate.values()
  ) {
    total +=
      list.length;

    if (
      list.length >= 1
    ) days1++;

    if (
      list.length >= 2
    ) days2++;

    if (
      list.length >= 3
    ) days3++;
  }

  return {
    activeDays:
      byDate.size,

    days1plus:
      days1,

    days2plus:
      days2,

    days3plus:
      days3,

    picks:
      total,

    avg:
      byDate.size
        ? +(
            total /
            byDate.size
          ).toFixed(2)
        : 0
  };
}

console.log();
console.log(
  "===== SUPPLY ====="
);

console.table([
  {
    period:"DISCOVERY",
    ...supply(discovery)
  },
  {
    period:"INTERNAL",
    ...supply(internal)
  }
]);

/*
  각 family별 월별 성과
*/
function monthly(
  source,
  family
) {
  const map =
    new Map();

  for (
    const x
    of source.filter(
      x =>
        x.family === family
    )
  ) {
    const month =
      x.date.slice(0,7);

    if (!map.has(month)) {
      map.set(
        month,
        []
      );
    }

    map
      .get(month)
      .push(x);
  }

  return [
    ...map.entries()
  ].map(
    ([month,list]) => ({
      month,
      ...stats(list)
    })
  );
}

for (
  const family
  of FAMILIES
) {
  console.log();
  console.log(
    `===== ${family} MONTHLY =====`
  );

  console.log(
    "DISCOVERY"
  );

  console.table(
    monthly(
      discovery,
      family
    )
  );

  console.log(
    "INTERNAL"
  );

  console.table(
    monthly(
      internal,
      family
    )
  );
}

/*
  하루에 family별 최고 signal 하나씩만 선택했을 때
*/
function dailyBest(
  source,
  family
) {
  const byDate =
    new Map();

  for (
    const x
    of source.filter(
      x =>
        x.family === family
    )
  ) {
    if (!byDate.has(x.date)) {
      byDate.set(
        x.date,
        []
      );
    }

    byDate
      .get(x.date)
      .push(x);
  }

  const out = [];

  for (
    const list
    of byDate.values()
  ) {
    list.sort(
      (a,b) =>
        b.signal -
        a.signal
    );

    out.push(
      list[0]
    );
  }

  return out;
}

console.log();
console.log(
  "===== DAILY BEST BY FAMILY ====="
);

const bestTable = [];

for (
  const family
  of FAMILIES
) {
  const d =
    stats(
      dailyBest(
        discovery,
        family
      )
    );

  const i =
    stats(
      dailyBest(
        internal,
        family
      )
    );

  bestTable.push({
    family,

    DBets:
      d.bets,

    DHit:
      d.hit,

    DROI:
      d.roi,

    IBets:
      i.bets,

    IHit:
      i.hit,

    IROI:
      i.roi,

    minROI:
      +Math.min(
        d.roi,
        i.roi
      ).toFixed(2)
  });
}

console.table(
  bestTable
);

fs.writeFileSync(
  "data/kbo-candidate-universe-v28.json",
  JSON.stringify(
    {
      generatedAt:
        new Date()
          .toISOString(),

      final:
        "LOCKED",

      scales,

      familyPerformance:
        table,

      supply:{
        discovery:
          supply(discovery),

        internal:
          supply(internal)
      },

      dailyBest:
        bestTable
    },
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-candidate-universe-v28.json"
);

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
  ) return "AWAY";

  if (
    home &&
    label.includes(home)
  ) return "HOME";

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

const base =
  (raw.results || raw)
    .filter(x =>
      ["ML","HANDICAP"].includes(x.market) &&
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

        confidence:
          num(x.confidence),

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
      x.selectedSide
    );

/*
  Discovery 데이터만 사용해서
  edge scale 고정.
*/
const discoveryBase =
  base.filter(x =>
    x.date >= DISC_START &&
    x.date <= DISC_END
  );

function sd(values) {
  if (values.length < 2) {
    return 1;
  }

  const mean =
    values.reduce(
      (a,b) => a+b,
      0
    ) /
    values.length;

  const variance =
    values.reduce(
      (sum,v) =>
        sum +
        (v-mean) ** 2,
      0
    ) /
    values.length;

  return (
    Math.sqrt(variance) ||
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

/*
  V2.5에서 방향이
  Discovery/Internal 동일했던 것만 사용.

  ML:
    FORM    negative
    LINEUP  negative
    BULLPEN negative

  HANDICAP:
    FORM positive
*/
function edgeSignal(x) {
  if (x.market === "ML") {
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
  모델을 여러 개 결과 보고 튜닝하지 않는다.

  단 하나의 사전 고정 점수:
  - analyzer EV 50%
  - V2.5 edge signal 50%

  EV는 5%를 대략 1점 단위로 변환.
*/
function selectorScore(x) {
  const ev =
    x.ev === null
      ? 0
      : x.ev;

  const evScore =
    ev / 0.05;

  const edge =
    edgeSignal(x);

  return (
    evScore * 0.50 +
    edge * 0.50
  );
}

/*
  기존 분석에서 반복해서 사용한
  넓은 EV 범위만 유지.

  새 threshold 최적화 금지.
*/
const candidates =
  base
    .filter(x =>
      x.ev !== null &&
      x.ev >= 0.03 &&
      x.ev < 0.10
    )
    .map(x => ({
      ...x,

      edgeSignal:
        edgeSignal(x),

      selectorScore:
        selectorScore(x)
    }));

function stats(list) {
  let wins = 0;
  let losses = 0;
  let returned = 0;

  let oddsSum = 0;

  for (const x of list) {
    oddsSum += x.odds;

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

function selectPeriod(
  start,
  end
) {
  const source =
    candidates.filter(x =>
      x.date >= start &&
      x.date <= end
    );

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
  const top12 = [];

  for (
    const [date,list]
    of byDate
  ) {
    const sorted =
      [...list]
        .sort(
          (a,b) =>
            b.selectorScore -
            a.selectorScore
        );

    if (sorted[0]) {
      top1.push(
        sorted[0]
      );

      top12.push(
        sorted[0]
      );
    }

    if (sorted[1]) {
      rank2.push(
        sorted[1]
      );

      top12.push(
        sorted[1]
      );
    }
  }

  return {
    source,
    top1,
    rank2,
    top12
  };
}

function marketMix(list) {
  const out = {};

  for (const x of list) {
    out[x.market] =
      (out[x.market] || 0) +
      1;
  }

  return out;
}

function monthly(list) {
  const groups =
    new Map();

  for (const x of list) {
    const month =
      String(x.date)
        .slice(0,7);

    if (
      !groups.has(month)
    ) {
      groups.set(
        month,
        []
      );
    }

    groups
      .get(month)
      .push(x);
  }

  return [
    ...groups.entries()
  ].map(
    ([month,rows]) => ({
      month,
      ...stats(rows)
    })
  );
}

function compact(x) {
  return {
    date:
      x.date,

    market:
      x.market,

    label:
      x.label,

    odds:
      x.odds,

    ev:
      x.ev === null
        ? null
        : +(x.ev*100)
            .toFixed(2),

    edgeSignal:
      +x.edgeSignal
        .toFixed(3),

    score:
      +x.selectorScore
        .toFixed(3),

    result:
      x.result
  };
}

const discovery =
  selectPeriod(
    DISC_START,
    DISC_END
  );

const internal =
  selectPeriod(
    INT_START,
    INT_END
  );

console.log(
  "============================================================"
);

console.log(
  "KBO SINGLE SELECTOR V2.6"
);

console.log(
  "EV 3~10% + V2.5 FIXED EDGE DIRECTIONS"
);

console.log(
  "FINAL 07~09: LOCKED"
);

console.log(
  "============================================================"
);

console.log();
console.log(
  "===== DISCOVERY FIXED SCALES ====="
);

console.log(
  JSON.stringify(
    scales,
    null,
    2
  )
);

function printPeriod(
  name,
  p
) {
  console.log();
  console.log(
    `===== ${name} =====`
  );

  console.table([
    {
      selector:"TOP1",
      ...stats(p.top1)
    },
    {
      selector:"RANK2",
      ...stats(p.rank2)
    },
    {
      selector:"TOP1+2 SINGLES",
      ...stats(p.top12)
    }
  ]);

  console.log(
    "TOP1 MARKET MIX:",
    marketMix(
      p.top1
    )
  );

  console.log(
    "RANK2 MARKET MIX:",
    marketMix(
      p.rank2
    )
  );

  console.log();
  console.log(
    `${name} TOP1 MONTHLY`
  );

  console.table(
    monthly(
      p.top1
    )
  );

  console.log();
  console.log(
    `${name} RANK2 MONTHLY`
  );

  console.table(
    monthly(
      p.rank2
    )
  );

  console.log();
  console.log(
    `${name} TOP1 PICKS`
  );

  console.table(
    p.top1.map(
      compact
    )
  );

  console.log();
  console.log(
    `${name} RANK2 PICKS`
  );

  console.table(
    p.rank2.map(
      compact
    )
  );
}

printPeriod(
  "DISCOVERY",
  discovery
);

printPeriod(
  "INTERNAL",
  internal
);

const d1 =
  stats(
    discovery.top1
  );

const i1 =
  stats(
    internal.top1
  );

const d2 =
  stats(
    discovery.rank2
  );

const i2 =
  stats(
    internal.rank2
  );

const pass =
  d1.bets >= 8 &&
  i1.bets >= 8 &&
  d2.bets >= 4 &&
  i2.bets >= 4 &&
  d1.roi > 0 &&
  i1.roi > 0 &&
  d2.roi > 0 &&
  i2.roi > 0;

console.log();
console.log(
  "===== V2.6 PASS ====="
);

console.log(
  pass
    ? "YES"
    : "NO"
);

fs.writeFileSync(
  "data/kbo-selector-v26.json",
  JSON.stringify(
    {
      generatedAt:
        new Date()
          .toISOString(),

      final:
        "LOCKED",

      rules:{
        candidate:
          "EV >= 3% and < 10%",

        ml:
          "-FORM -LINEUP -BULLPEN",

        handicap:
          "+FORM",

        score:
          "50% normalized EV + 50% edge signal"
      },

      scales,

      discovery:{
        top1:
          stats(
            discovery.top1
          ),

        rank2:
          stats(
            discovery.rank2
          ),

        top12:
          stats(
            discovery.top12
          ),

        top1Monthly:
          monthly(
            discovery.top1
          ),

        rank2Monthly:
          monthly(
            discovery.rank2
          )
      },

      internal:{
        top1:
          stats(
            internal.top1
          ),

        rank2:
          stats(
            internal.rank2
          ),

        top12:
          stats(
            internal.top12
          ),

        top1Monthly:
          monthly(
            internal.top1
          ),

        rank2Monthly:
          monthly(
            internal.rank2
          )
      },

      pass
    },
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-selector-v26.json"
);

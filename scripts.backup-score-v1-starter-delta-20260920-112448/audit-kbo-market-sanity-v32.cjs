const fs = require("fs");

const INPUT =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw =
  JSON.parse(
    fs.readFileSync(INPUT, "utf8")
  );

const rows =
  (raw.results || raw)
    .filter(x =>
      ["WIN","LOSS","VOID"].includes(x.result) &&
      ["ML","HANDICAP","TOTAL"].includes(x.market) &&
      Number.isFinite(Number(x.odds)) &&
      Number(x.odds) > 1
    )
    .map(x => ({
      ...x,
      odds:Number(x.odds)
    }));

const PERIODS = {
  DISCOVERY:[
    "2026-03-28",
    "2026-04-30"
  ],

  INTERNAL:[
    "2026-05-01",
    "2026-06-30"
  ]
};

const ODDS_BUCKETS = [
  {
    name:"1.20-1.39",
    min:1.20,
    max:1.40
  },
  {
    name:"1.40-1.59",
    min:1.40,
    max:1.60
  },
  {
    name:"1.60-1.79",
    min:1.60,
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

function pct(v) {
  return +(
    v * 100
  ).toFixed(2);
}

function stats(list) {
  const settled =
    list.filter(
      x =>
        x.result === "WIN" ||
        x.result === "LOSS"
    );

  const wins =
    settled.filter(
      x =>
        x.result === "WIN"
    ).length;

  const losses =
    settled.length -
    wins;

  const avgOdds =
    settled.length
      ? settled.reduce(
          (s,x) =>
            s + x.odds,
          0
        ) / settled.length
      : 0;

  const returned =
    settled.reduce(
      (s,x) =>
        s +
        (
          x.result === "WIN"
            ? x.odds
            : 0
        ),
      0
    );

  const roi =
    settled.length
      ? (
          returned /
          settled.length -
          1
        )
      : 0;

  const breakEven =
    avgOdds > 0
      ? 1 / avgOdds
      : 0;

  const hit =
    settled.length
      ? wins /
        settled.length
      : 0;

  return {
    bets:
      settled.length,

    wins,
    losses,

    hit:
      pct(hit),

    avgOdds:
      +avgOdds
        .toFixed(3),

    breakEven:
      pct(breakEven),

    edgeVsBE:
      +(
        pct(hit) -
        pct(breakEven)
      ).toFixed(2),

    roi:
      pct(roi)
  };
}

function periodRows(
  start,
  end
) {
  return rows.filter(
    x =>
      x.date >= start &&
      x.date <= end
  );
}

console.log(
  "============================================================"
);

console.log(
  "KBO MARKET SANITY AUDIT V3.2"
);

console.log(
  "CHECK ODDS -> ACTUAL HIT RATE"
);

console.log(
  "FINAL 07~09: LOCKED"
);

console.log(
  "============================================================"
);

const output = {};

for (
  const [periodName,range]
  of Object.entries(
    PERIODS
  )
) {
  const source =
    periodRows(
      range[0],
      range[1]
    );

  console.log();
  console.log(
    `===== ${periodName} / ALL MARKETS =====`
  );

  console.table(
    ODDS_BUCKETS.map(
      b => ({
        bucket:b.name,
        ...stats(
          source.filter(
            x =>
              x.odds >= b.min &&
              x.odds < b.max
          )
        )
      })
    )
  );

  output[periodName] = {
    all:{},
    markets:{}
  };

  for (
    const b
    of ODDS_BUCKETS
  ) {
    output[periodName]
      .all[b.name] =
        stats(
          source.filter(
            x =>
              x.odds >= b.min &&
              x.odds < b.max
          )
        );
  }

  for (
    const market
    of ["ML","HANDICAP","TOTAL"]
  ) {
    console.log();
    console.log(
      `===== ${periodName} / ${market} =====`
    );

    const table =
      ODDS_BUCKETS.map(
        b => ({
          bucket:b.name,

          ...stats(
            source.filter(
              x =>
                x.market === market &&
                x.odds >= b.min &&
                x.odds < b.max
            )
          )
        })
      );

    console.table(table);

    output[periodName]
      .markets[market] =
        Object.fromEntries(
          ODDS_BUCKETS.map(
            (b,i) => [
              b.name,
              table[i]
            ]
          )
        );
  }
}

/*
  핸디캡 저배당 +2.5 집중 검사
*/
function isPlusHandicap(x) {
  if (
    x.market !== "HANDICAP"
  ) {
    return false;
  }

  const l =
    String(
      x.label || ""
    );

  return (
    l.includes("+") ||
    /\+\s*2\.5/.test(l)
  );
}

console.log();
console.log(
  "===== LOW-ODDS +HANDICAP AUDIT ====="
);

const lowHandiTable = [];

for (
  const [periodName,range]
  of Object.entries(
    PERIODS
  )
) {
  const source =
    periodRows(
      range[0],
      range[1]
    );

  for (
    const bucket
    of [
      {
        name:"1.20-1.29",
        min:1.20,
        max:1.30
      },
      {
        name:"1.30-1.39",
        min:1.30,
        max:1.40
      },
      {
        name:"1.20-1.49",
        min:1.20,
        max:1.50
      }
    ]
  ) {
    const list =
      source.filter(
        x =>
          isPlusHandicap(x) &&
          x.odds >= bucket.min &&
          x.odds < bucket.max
      );

    lowHandiTable.push({
      period:
        periodName,

      bucket:
        bucket.name,

      ...stats(list)
    });
  }
}

console.table(
  lowHandiTable
);

/*
  ----------------------------------------------------
  PAIR CONSISTENCY
  같은 gameId + market에 정확히 2개가 있을 때
  WIN/WIN 또는 LOSS/LOSS가 얼마나 발생하는가.
  ML은 정상이라면 반대 결과여야 함.
  핸디캡/TOTAL도 line 구성에 따라 대부분 반대여야 하지만
  push/복수 line 가능성 때문에 따로 표시.
  ----------------------------------------------------
*/

console.log();
console.log(
  "===== OPPOSITE-SIDE CONSISTENCY ====="
);

function consistency(
  source,
  market
) {
  const groups =
    new Map();

  for (
    const x
    of source.filter(
      x =>
        x.market === market &&
        (
          x.result === "WIN" ||
          x.result === "LOSS"
        )
    )
  ) {
    const key =
      `${x.gameId}:${x.market}`;

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

  let exact2 = 0;
  let opposite = 0;
  let sameResult = 0;
  let moreThan2 = 0;

  const badSamples = [];

  for (
    const [key,list]
    of groups
  ) {
    if (
      list.length > 2
    ) {
      moreThan2++;
      continue;
    }

    if (
      list.length !== 2
    ) {
      continue;
    }

    exact2++;

    const a =
      list[0];

    const b =
      list[1];

    if (
      a.result !==
      b.result
    ) {
      opposite++;
    }
    else {
      sameResult++;

      if (
        badSamples.length <
        15
      ) {
        badSamples.push({
          key,

          A:
            a.label,

          AOdds:
            a.odds,

          AResult:
            a.result,

          B:
            b.label,

          BOdds:
            b.odds,

          BResult:
            b.result,

          date:
            a.date
        });
      }
    }
  }

  return {
    exact2,
    opposite,
    sameResult,

    oppositeRate:
      exact2
        ? +(
            opposite /
            exact2 *
            100
          ).toFixed(2)
        : 0,

    moreThan2,

    badSamples
  };
}

for (
  const [periodName,range]
  of Object.entries(
    PERIODS
  )
) {
  const source =
    periodRows(
      range[0],
      range[1]
    );

  for (
    const market
    of ["ML","HANDICAP","TOTAL"]
  ) {
    const c =
      consistency(
        source,
        market
      );

    console.log();
    console.log(
      `${periodName} / ${market}`
    );

    console.table([
      {
        exact2:
          c.exact2,

        opposite:
          c.opposite,

        sameResult:
          c.sameResult,

        oppositeRate:
          c.oppositeRate,

        moreThan2:
          c.moreThan2
      }
    ]);

    if (
      c.badSamples.length
    ) {
      console.log(
        "SAME RESULT SAMPLES"
      );

      console.table(
        c.badSamples
      );
    }

    if (
      !output[periodName]
        .consistency
    ) {
      output[periodName]
        .consistency = {};
    }

    output[periodName]
      .consistency[market] =
        c;
  }
}

fs.writeFileSync(
  "data/kbo-market-sanity-v32.json",
  JSON.stringify(
    {
      generatedAt:
        new Date()
          .toISOString(),

      final:
        "LOCKED",

      output,

      lowHandiTable
    },
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-market-sanity-v32.json"
);

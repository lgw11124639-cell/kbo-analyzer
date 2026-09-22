const fs = require("fs");

const FILE =
  "data/kbo-backtest-all-candidates-2026.json";

const d =
  JSON.parse(
    fs.readFileSync(FILE, "utf8")
  );

const rows =
  (d.results ?? []).filter(
    x =>
      x.result === "WIN" ||
      x.result === "LOSS"
  );

function sideOf(x) {
  if (x.market === "ML") {
    const label =
      String(x.label ?? "");

    if (
      label.includes(
        `${x.homeTeam} 승`
      )
    ) return "HOME";

    if (
      label.includes(
        `${x.awayTeam} 승`
      )
    ) return "AWAY";

    return "?";
  }

  if (x.market === "TOTAL") {
    const label =
      String(x.label ?? "");

    if (label.includes("언더"))
      return "UNDER";

    if (label.includes("오버"))
      return "OVER";

    return "?";
  }

  if (
    x.market === "HANDICAP"
  ) {
    const label =
      String(x.label ?? "");

    if (
      label.includes(x.homeTeam)
    ) return "HOME";

    if (
      label.includes(x.awayTeam)
    ) return "AWAY";

    return "?";
  }

  return "?";
}

function summarize(list) {
  const settled =
    list.filter(
      x =>
        x.result === "WIN" ||
        x.result === "LOSS"
    );

  const wins =
    settled.filter(
      x => x.result === "WIN"
    ).length;

  const losses =
    settled.length - wins;

  const stake =
    settled.reduce(
      (a,x) =>
        a + Number(x.stake ?? 0),
      0
    );

  const returned =
    settled.reduce(
      (a,x) =>
        a + Number(x.returned ?? 0),
      0
    );

  const profit =
    returned - stake;

  return {
    bets: settled.length,
    wins,
    losses,

    hitRate:
      settled.length
        ? Number(
            (
              wins /
              settled.length *
              100
            ).toFixed(2)
          )
        : 0,

    avgOdds:
      settled.length
        ? Number(
            (
              settled.reduce(
                (a,x) =>
                  a +
                  Number(
                    x.odds ?? 0
                  ),
                0
              ) /
              settled.length
            ).toFixed(3)
          )
        : 0,

    avgConf:
      settled.length
        ? Number(
            (
              settled.reduce(
                (a,x) =>
                  a +
                  Number(
                    x.confidence ?? 0
                  ),
                0
              ) /
              settled.length *
              100
            ).toFixed(2)
          )
        : 0,

    avgEv:
      settled.length
        ? Number(
            (
              settled.reduce(
                (a,x) =>
                  a +
                  Number(
                    x.ev ?? 0
                  ),
                0
              ) /
              settled.length *
              100
            ).toFixed(2)
          )
        : 0,

    profit,
    roi:
      stake
        ? Number(
            (
              profit /
              stake *
              100
            ).toFixed(2)
          )
        : 0
  };
}

function groupBy(
  list,
  fn
) {
  const map =
    new Map();

  for (const x of list) {
    const key =
      fn(x);

    if (!map.has(key)) {
      map.set(key, []);
    }

    map.get(key).push(x);
  }

  return map;
}

function printGroup(
  title,
  list,
  fn
) {
  console.log(
    `\n===== ${title} =====`
  );

  const data =
    [...groupBy(list,fn)]
      .map(
        ([group,rows]) => ({
          group,
          ...summarize(rows)
        })
      );

  console.table(data);
}

/*
  1. ML HOME / AWAY × MONTH
*/
printGroup(
  "ML SIDE x MONTH",
  rows.filter(
    x =>
      x.market === "ML" &&
      Number(x.ev) > 0
  ),
  x =>
    `${x.month} | ${sideOf(x)}`
);

/*
  2. TOTAL OVER / UNDER × MONTH
*/
printGroup(
  "TOTAL SIDE x MONTH",
  rows.filter(
    x =>
      x.market === "TOTAL" &&
      Number(x.ev) > 0
  ),
  x =>
    `${x.month} | ${sideOf(x)}`
);

/*
  3. HANDICAP HOME/AWAY × MONTH
*/
printGroup(
  "HANDICAP SIDE x MONTH",
  rows.filter(
    x =>
      x.market ===
        "HANDICAP" &&
      Number(x.ev) > 0
  ),
  x =>
    `${x.month} | ${sideOf(x)}`
);

/*
  confidence calibration bins
*/
function confBin(v) {
  const p =
    Number(v) * 100;

  if (p < 35)
    return "<35%";
  if (p < 40)
    return "35~39.9%";
  if (p < 45)
    return "40~44.9%";
  if (p < 50)
    return "45~49.9%";
  if (p < 55)
    return "50~54.9%";
  if (p < 60)
    return "55~59.9%";
  if (p < 65)
    return "60~64.9%";
  return "65%+";
}

function calibration(
  market
) {
  console.log(
    `\n===== ${market} CALIBRATION =====`
  );

  const list =
    rows.filter(
      x =>
        x.market === market
    );

  const map =
    groupBy(
      list,
      x =>
        confBin(
          x.confidence
        )
    );

  const out =
    [...map.entries()]
      .map(
        ([group,a]) => {
          const wins =
            a.filter(
              x =>
                x.result ===
                "WIN"
            ).length;

          const actual =
            wins /
            a.length;

          const predicted =
            a.reduce(
              (s,x) =>
                s +
                Number(
                  x.confidence ??
                    0
                ),
              0
            ) /
            a.length;

          return {
            group,
            n: a.length,

            predicted:
              Number(
                (
                  predicted *
                  100
                ).toFixed(2)
              ),

            actual:
              Number(
                (
                  actual *
                  100
                ).toFixed(2)
              ),

            gap:
              Number(
                (
                  (
                    actual -
                    predicted
                  ) *
                  100
                ).toFixed(2)
              )
          };
        }
      );

  console.table(out);
}

calibration("ML");
calibration("HANDICAP");
calibration("TOTAL");

/*
  Brier score
*/
function brier(
  market
) {
  const list =
    rows.filter(
      x =>
        x.market === market
    );

  const score =
    list.reduce(
      (a,x) => {
        const p =
          Number(
            x.confidence ??
              0
          );

        const y =
          x.result === "WIN"
            ? 1
            : 0;

        return (
          a +
          (p-y) ** 2
        );
      },
      0
    ) /
    Math.max(
      1,
      list.length
    );

  return Number(
    score.toFixed(4)
  );
}

console.log(
  "\n===== BRIER SCORE ====="
);

console.table([
  {
    market:"ML",
    brier:brier("ML")
  },
  {
    market:"HANDICAP",
    brier:
      brier("HANDICAP")
  },
  {
    market:"TOTAL",
    brier:
      brier("TOTAL")
  }
]);

/*
  TOTAL projected total bias
*/
const totalRows =
  rows.filter(
    x =>
      x.market ===
        "TOTAL" &&
      x.projectedTotal != null &&
      x.homeScore != null &&
      x.awayScore != null
  );

if (totalRows.length) {
  const byGame =
    new Map();

  for (
    const x of totalRows
  ) {
    const key =
      x.gameId;

    if (
      !byGame.has(key)
    ) {
      byGame.set(
        key,
        x
      );
    }
  }

  const unique =
    [...byGame.values()];

  const stats =
    unique.map(
      x => ({
        month:
          x.month,

        predicted:
          Number(
            x.projectedTotal
          ),

        actual:
          Number(
            x.homeScore
          ) +
          Number(
            x.awayScore
          ),

        line:
          Number(
            x.totalLine
          )
      })
    );

  console.log(
    "\n===== TOTAL PROJECTED BIAS ====="
  );

  const avg = arr =>
    arr.reduce(
      (a,b)=>a+b,
      0
    ) /
    Math.max(
      1,
      arr.length
    );

  console.table([
    {
      games:
        stats.length,

      avgProjected:
        Number(
          avg(
            stats.map(
              x =>
                x.predicted
            )
          ).toFixed(3)
        ),

      avgActual:
        Number(
          avg(
            stats.map(
              x =>
                x.actual
            )
          ).toFixed(3)
        ),

      avgMarketLine:
        Number(
          avg(
            stats.map(
              x =>
                x.line
            )
          ).toFixed(3)
        ),

      projectedBias:
        Number(
          (
            avg(
              stats.map(
                x =>
                  x.actual -
                  x.predicted
              )
            )
          ).toFixed(3)
        ),

      lineBias:
        Number(
          (
            avg(
              stats.map(
                x =>
                  x.actual -
                  x.line
              )
            )
          ).toFixed(3)
        )
    }
  ]);

  printGroup(
    "TOTAL PROJECTED BIAS BY MONTH",
    unique,
    x =>
      x.month
  );
}

/*
  V0.3 후보 필터 비교
*/

const strategies = [
  {
    name:
      "CURRENT",
    filter:
      x =>
        x.passesCurrentFilter ===
        true
  },

  {
    name:
      "ML_HOME_EV_POS",
    filter:
      x =>
        x.market === "ML" &&
        sideOf(x) ===
          "HOME" &&
        Number(x.ev) > 0
  },

  {
    name:
      "ML_HOME_EV_3",
    filter:
      x =>
        x.market === "ML" &&
        sideOf(x) ===
          "HOME" &&
        Number(x.ev) >=
          0.03
  },

  {
    name:
      "ML_HOME_EV_10",
    filter:
      x =>
        x.market === "ML" &&
        sideOf(x) ===
          "HOME" &&
        Number(x.ev) >=
          0.10
  },

  {
    name:
      "TOTAL_UNDER_EV_POS",
    filter:
      x =>
        x.market ===
          "TOTAL" &&
        sideOf(x) ===
          "UNDER" &&
        Number(x.ev) > 0
  },

  {
    name:
      "TOTAL_UNDER_EDGE_1_5",
    filter:
      x =>
        x.market ===
          "TOTAL" &&
        sideOf(x) ===
          "UNDER" &&
        Number(x.ev) > 0 &&
        Number(
          x.totalEdge
        ) >= 1.5
  },

  {
    name:
      "ML_HOME_PLUS_UNDER",
    filter:
      x =>
        (
          x.market === "ML" &&
          sideOf(x) ===
            "HOME" &&
          Number(x.ev) > 0
        ) ||
        (
          x.market ===
            "TOTAL" &&
          sideOf(x) ===
            "UNDER" &&
          Number(x.ev) > 0
        )
  }
];

console.log(
  "\n===== V0.3 STRATEGY COMPARISON ====="
);

console.table(
  strategies.map(
    s => ({
      strategy:
        s.name,
      ...summarize(
        rows.filter(
          s.filter
        )
      )
    })
  )
);

console.log(
  "\n===== V0.3 MONTHLY STABILITY ====="
);

for (
  const strategy of
  strategies
) {
  console.log(
    `\n--- ${strategy.name} ---`
  );

  printGroup(
    strategy.name,
    rows.filter(
      strategy.filter
    ),
    x =>
      x.month
  );
}

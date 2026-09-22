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
const START_BANKROLL = 1000000;

function num(v) {
  const n = Number(v);

  return Number.isFinite(n)
    ? n
    : null;
}

function labelOf(x) {
  return String(
    x.label || ""
  ).toUpperCase();
}

function isOver(x) {
  return (
    x.market === "TOTAL" &&
    (
      labelOf(x).includes("OVER") ||
      labelOf(x).includes("오버")
    )
  );
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
  const n =
    num(v);

  if (n === null) {
    return null;
  }

  return s === "AWAY"
    ? n
    : -n;
}

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
    Math.sqrt(variance) ||
    1
  );
}

const rows =
  (raw.results || raw)
    .filter(x =>
      ["WIN","LOSS","VOID"].includes(x.result) &&
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

const discoveryBase =
  rows.filter(x =>
    x.date >= DISC_START &&
    x.date <= DISC_END
  );

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

function overSignal(x) {
  return x.ev !== null
    ? x.ev / 0.05
    : -999;
}

function family(x) {
  if (
    x.market === "ML" &&
    x.selectedSide &&
    mlSignal(x) > 0
  ) {
    return "ML";
  }

  if (
    x.market === "HANDICAP" &&
    x.selectedSide &&
    handiSignal(x) > 0
  ) {
    return "HANDI";
  }

  if (
    isOver(x) &&
    x.ev !== null &&
    x.ev >= 0.03 &&
    x.ev < 0.10
  ) {
    return "OVER";
  }

  return null;
}

const candidates =
  rows
    .map(x => {
      const f =
        family(x);

      return {
        ...x,

        family:f,

        signal:
          f === "ML"
            ? mlSignal(x)
            : (
                f === "HANDI"
                  ? handiSignal(x)
                  : (
                      f === "OVER"
                        ? overSignal(x)
                        : -999
                    )
              )
      };
    })
    .filter(x =>
      x.family !== null
    );

function pickKey(x) {
  return `${x.gameId}:${x.market}:${x.label}`;
}

function canPair(a,b) {
  if (
    pickKey(a) ===
    pickKey(b)
  ) {
    return false;
  }

  if (
    String(a.gameId) !==
    String(b.gameId)
  ) {
    return true;
  }

  if (
    a.market ===
    b.market
  ) {
    return false;
  }

  const aSide =
    a.market === "ML" ||
    a.market === "HANDICAP";

  const bSide =
    b.market === "ML" ||
    b.market === "HANDICAP";

  if (
    aSide &&
    bSide
  ) {
    return false;
  }

  return true;
}

function settleCombo(a,b) {
  if (
    a.result === "LOSS" ||
    b.result === "LOSS"
  ) {
    return {
      result:"LOSS",
      odds:0
    };
  }

  const ao =
    a.result === "VOID"
      ? 1
      : a.odds;

  const bo =
    b.result === "VOID"
      ? 1
      : b.odds;

  if (
    a.result === "VOID" &&
    b.result === "VOID"
  ) {
    return {
      result:"VOID",
      odds:1
    };
  }

  return {
    result:"WIN",
    odds:
      ao * bo
  };
}

function byDate(source) {
  const map =
    new Map();

  for (const x of source) {
    if (!map.has(x.date)) {
      map.set(
        x.date,
        []
      );
    }

    map
      .get(x.date)
      .push(x);
  }

  return [
    ...map.entries()
  ].sort(
    (a,b) =>
      a[0].localeCompare(
        b[0]
      )
  );
}

const TEMPLATES = [
  {
    name:"ML1+ML2",
    left:"ML",
    right:"ML"
  },
  {
    name:"ML1+HANDI1",
    left:"ML",
    right:"HANDI"
  },
  {
    name:"ML1+OVER1",
    left:"ML",
    right:"OVER"
  }
];

function makeTicket(
  date,
  dayRows,
  template
) {
  const left =
    dayRows
      .filter(
        x =>
          x.family ===
          template.left
      )
      .sort(
        (a,b) =>
          b.signal -
          a.signal
      );

  const right =
    dayRows
      .filter(
        x =>
          x.family ===
          template.right
      )
      .sort(
        (a,b) =>
          b.signal -
          a.signal
      );

  if (
    template.left ===
    template.right
  ) {
    for (
      let i=0;
      i<left.length;
      i++
    ) {
      for (
        let j=i+1;
        j<left.length;
        j++
      ) {
        if (
          canPair(
            left[i],
            left[j]
          )
        ) {
          return {
            date,
            a:left[i],
            b:left[j]
          };
        }
      }
    }

    return null;
  }

  for (const a of left) {
    for (const b of right) {
      if (
        canPair(a,b)
      ) {
        return {
          date,
          a,
          b
        };
      }
    }
  }

  return null;
}

function evaluate(
  source,
  template
) {
  const tickets = [];

  for (
    const [date,dayRows]
    of byDate(source)
  ) {
    const t =
      makeTicket(
        date,
        dayRows,
        template
      );

    if (t) {
      tickets.push(t);
    }
  }

  let wins = 0;
  let losses = 0;
  let voids = 0;

  let invested = 0;
  let returned = 0;

  let oddsSum = 0;

  let bankroll =
    START_BANKROLL;

  let peak =
    START_BANKROLL;

  let maxDD = 0;

  let losingStreak = 0;
  let maxLosingStreak = 0;

  let sameGame = 0;
  let differentGame = 0;

  const monthly =
    new Map();

  for (const t of tickets) {
    const result =
      settleCombo(
        t.a,
        t.b
      );

    const comboOdds =
      t.a.odds *
      t.b.odds;

    oddsSum +=
      comboOdds;

    invested +=
      STAKE;

    let ret = 0;

    if (
      result.result ===
      "WIN"
    ) {
      wins++;

      ret =
        STAKE *
        result.odds;

      losingStreak = 0;
    }
    else if (
      result.result ===
      "VOID"
    ) {
      voids++;

      ret =
        STAKE;

      losingStreak = 0;
    }
    else {
      losses++;

      losingStreak++;

      maxLosingStreak =
        Math.max(
          maxLosingStreak,
          losingStreak
        );
    }

    returned +=
      ret;

    bankroll +=
      ret -
      STAKE;

    if (
      bankroll >
      peak
    ) {
      peak =
        bankroll;
    }

    const dd =
      peak > 0
        ? (
            peak -
            bankroll
          ) /
          peak *
          100
        : 0;

    maxDD =
      Math.max(
        maxDD,
        dd
      );

    if (
      String(t.a.gameId) ===
      String(t.b.gameId)
    ) {
      sameGame++;
    }
    else {
      differentGame++;
    }

    const month =
      t.date.slice(0,7);

    if (!monthly.has(month)) {
      monthly.set(
        month,
        {
          month,
          bets:0,
          wins:0,
          losses:0,
          voids:0,
          invested:0,
          returned:0
        }
      );
    }

    const m =
      monthly.get(month);

    m.bets++;
    m.invested += STAKE;
    m.returned += ret;

    if (
      result.result ===
      "WIN"
    ) {
      m.wins++;
    }

    if (
      result.result ===
      "LOSS"
    ) {
      m.losses++;
    }

    if (
      result.result ===
      "VOID"
    ) {
      m.voids++;
    }
  }

  const profit =
    returned -
    invested;

  const monthRows =
    [...monthly.values()]
      .map(m => {
        const p =
          m.returned -
          m.invested;

        return {
          ...m,

          hit:
            (
              m.wins +
              m.losses
            )
              ? +(
                  m.wins /
                  (
                    m.wins +
                    m.losses
                  ) *
                  100
                ).toFixed(2)
              : 0,

          profit:
            Math.round(p),

          roi:
            m.invested
              ? +(
                  p /
                  m.invested *
                  100
                ).toFixed(2)
              : 0
        };
      });

  return {
    bets:
      tickets.length,

    wins,
    losses,
    voids,

    hit:
      wins+losses
        ? +(
            wins /
            (
              wins +
              losses
            ) *
            100
          ).toFixed(2)
        : 0,

    avgOdds:
      tickets.length
        ? +(
            oddsSum /
            tickets.length
          ).toFixed(3)
        : 0,

    invested:
      Math.round(
        invested
      ),

    returned:
      Math.round(
        returned
      ),

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
        : 0,

    finalBankroll:
      Math.round(
        bankroll
      ),

    MDD:
      +maxDD
        .toFixed(2),

    maxLosingStreak,

    sameGame,
    differentGame,

    negativeMonths:
      monthRows.filter(
        x =>
          x.profit < 0
      ).length,

    monthly:
      monthRows,

    tickets
  };
}

const discovery =
  candidates.filter(x =>
    x.date >= DISC_START &&
    x.date <= DISC_END
  );

const internal =
  candidates.filter(x =>
    x.date >= INT_START &&
    x.date <= INT_END
  );

console.log(
  "============================================================"
);

console.log(
  "KBO A2 FIXED FAMILY TEST V2.9"
);

console.log(
  "TEMPLATES: ML1+ML2 / ML1+HANDI1 / ML1+OVER1"
);

console.log(
  "NO THRESHOLD TUNING"
);

console.log(
  "FINAL 07~09: LOCKED"
);

console.log(
  "============================================================"
);

const results = [];

for (
  const template
  of TEMPLATES
) {
  const d =
    evaluate(
      discovery,
      template
    );

  const i =
    evaluate(
      internal,
      template
    );

  results.push({
    template:
      template.name,

    discovery:d,

    internal:i
  });
}

console.log();
console.log(
  "===== A2 RESULTS ====="
);

console.table(
  results.map(x => ({
    template:
      x.template,

    DBets:
      x.discovery.bets,

    DHit:
      x.discovery.hit,

    DOdds:
      x.discovery.avgOdds,

    DROI:
      x.discovery.roi,

    DMDD:
      x.discovery.MDD,

    IBets:
      x.internal.bets,

    IHit:
      x.internal.hit,

    IOdds:
      x.internal.avgOdds,

    IROI:
      x.internal.roi,

    IMDD:
      x.internal.MDD,

    minROI:
      +Math.min(
        x.discovery.roi,
        x.internal.roi
      ).toFixed(2)
  }))
);

for (
  const x
  of results
) {
  console.log();
  console.log(
    `===== ${x.template} MONTHLY =====`
  );

  console.log(
    "DISCOVERY"
  );

  console.table(
    x.discovery.monthly
  );

  console.log(
    "INTERNAL"
  );

  console.table(
    x.internal.monthly
  );

  console.log();
  console.log(
    `${x.template} INTERNAL SAMPLE`
  );

  console.table(
    x.internal.tickets
      .slice(0,20)
      .map(t => {
        const r =
          settleCombo(
            t.a,
            t.b
          );

        return {
          date:
            t.date,

          A:
            `${t.a.market}:${t.a.label}`,

          AOdds:
            t.a.odds,

          B:
            `${t.b.market}:${t.b.label}`,

          BOdds:
            t.b.odds,

          comboOdds:
            +(
              t.a.odds *
              t.b.odds
            ).toFixed(3),

          sameGame:
            String(
              t.a.gameId
            ) ===
            String(
              t.b.gameId
            ),

          result:
            r.result
        };
      })
  );
}

fs.writeFileSync(
  "data/kbo-a2-fixed-families-v29.json",
  JSON.stringify(
    {
      generatedAt:
        new Date()
          .toISOString(),

      final:
        "LOCKED",

      scales,

      templates:
        TEMPLATES,

      results
    },
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-a2-fixed-families-v29.json"
);

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
    Math.sqrt(
      variance
    ) ||
    1
  );
}

function confidenceOf(x) {
  const c =
    num(x.confidence);

  return c === null
    ? 0
    : c;
}

function gradeValue(x) {
  const g =
    String(
      x.grade || ""
    ).toUpperCase();

  if (g === "A") return 3;
  if (g === "B") return 2;

  return 1;
}

const rows =
  (raw.results || raw)
    .filter(x =>
      ["WIN","LOSS","VOID"].includes(x.result) &&
      ["ML","HANDICAP","TOTAL"].includes(x.market) &&
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
          confidenceOf(x),

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

function groupByDate(
  start,
  end
) {
  const map =
    new Map();

  for (
    const x
    of rows.filter(
      x =>
        x.date >= start &&
        x.date <= end
    )
  ) {
    if (
      !map.has(x.date)
    ) {
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

/*
  ML1 anchor:
  V2.8 ~ V3.0과 동일.
*/
function anchorOf(dayRows) {
  return dayRows
    .filter(
      x =>
        x.market === "ML" &&
        x.selectedSide &&
        mlSignal(x) > 0
    )
    .map(x => ({
      ...x,
      mlSignal:
        mlSignal(x)
    }))
    .sort(
      (a,b) =>
        b.mlSignal -
        a.mlSignal
    )[0] || null;
}

function compatible(
  dayRows,
  anchor
) {
  return dayRows.filter(
    x =>
      canPair(
        anchor,
        x
      )
  );
}

/*
  결과를 보지 않는
  사전 고정 safety partner 방식.
*/
const PARTNERS = {

  MAX_CONF(dayRows,anchor) {
    return compatible(
      dayRows,
      anchor
    )
      .sort(
        (a,b) =>
          b.confidence -
          a.confidence
      )[0] || null;
  },

  LOWEST_ODDS(dayRows,anchor) {
    return compatible(
      dayRows,
      anchor
    )
      .sort(
        (a,b) =>
          a.odds -
          b.odds
      )[0] || null;
  },

  GRADE_CONF(dayRows,anchor) {
    return compatible(
      dayRows,
      anchor
    )
      .sort(
        (a,b) => {
          const g =
            gradeValue(b) -
            gradeValue(a);

          if (g !== 0) {
            return g;
          }

          return (
            b.confidence -
            a.confidence
          );
        }
      )[0] || null;
  },

  SIDE_CONF(dayRows,anchor) {
    return compatible(
      dayRows,
      anchor
    )
      .filter(
        x =>
          x.market === "ML" ||
          x.market === "HANDICAP"
      )
      .sort(
        (a,b) =>
          b.confidence -
          a.confidence
      )[0] || null;
  },

  TOTAL_CONF(dayRows,anchor) {
    return compatible(
      dayRows,
      anchor
    )
      .filter(
        x =>
          x.market === "TOTAL"
      )
      .sort(
        (a,b) =>
          b.confidence -
          a.confidence
      )[0] || null;
  }
};

function settlePick(x) {
  if (
    x.result === "WIN"
  ) {
    return {
      result:"WIN",
      odds:x.odds
    };
  }

  if (
    x.result === "VOID"
  ) {
    return {
      result:"VOID",
      odds:1
    };
  }

  return {
    result:"LOSS",
    odds:0
  };
}

function settleCombo(a,b) {
  const ar =
    settlePick(a);

  const br =
    settlePick(b);

  if (
    ar.result === "LOSS" ||
    br.result === "LOSS"
  ) {
    return {
      result:"LOSS",
      odds:0
    };
  }

  if (
    ar.result === "VOID" &&
    br.result === "VOID"
  ) {
    return {
      result:"VOID",
      odds:1
    };
  }

  return {
    result:"WIN",
    odds:
      ar.odds *
      br.odds
  };
}

function statsPick(list) {
  let wins = 0;
  let losses = 0;
  let voids = 0;

  let returned = 0;
  let oddsSum = 0;

  for (const x of list) {
    const r =
      settlePick(x);

    oddsSum +=
      x.odds;

    if (
      r.result === "WIN"
    ) {
      wins++;

      returned +=
        STAKE *
        r.odds;
    }
    else if (
      r.result === "VOID"
    ) {
      voids++;

      returned +=
        STAKE;
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

function statsCombo(tickets) {
  let wins = 0;
  let losses = 0;
  let voids = 0;

  let returned = 0;
  let oddsSum = 0;

  for (const t of tickets) {
    const r =
      settleCombo(
        t.anchor,
        t.partner
      );

    oddsSum +=
      t.anchor.odds *
      t.partner.odds;

    if (
      r.result === "WIN"
    ) {
      wins++;

      returned +=
        STAKE *
        r.odds;
    }
    else if (
      r.result === "VOID"
    ) {
      voids++;

      returned +=
        STAKE;
    }
    else {
      losses++;
    }
  }

  const invested =
    tickets.length *
    STAKE;

  const profit =
    returned -
    invested;

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

function evaluate(
  start,
  end
) {
  const anchors = [];

  const result = {};

  for (
    const name
    of Object.keys(
      PARTNERS
    )
  ) {
    result[name] = {
      tickets:[],
      anchorWinPartners:[]
    };
  }

  for (
    const [date,dayRows]
    of groupByDate(
      start,
      end
    )
  ) {
    const anchor =
      anchorOf(
        dayRows
      );

    if (!anchor) {
      continue;
    }

    anchors.push(
      anchor
    );

    for (
      const [name,selector]
      of Object.entries(
        PARTNERS
      )
    ) {
      const partner =
        selector(
          dayRows,
          anchor
        );

      if (!partner) {
        continue;
      }

      result[name]
        .tickets
        .push({
          date,
          anchor,
          partner
        });

      if (
        anchor.result === "WIN"
      ) {
        result[name]
          .anchorWinPartners
          .push(
            partner
          );
      }
    }
  }

  return {
    anchor:
      statsPick(
        anchors
      ),

    partnerResults:
      Object.fromEntries(
        Object.entries(
          result
        )
        .map(
          ([name,x]) => [
            name,
            {
              combo:
                statsCombo(
                  x.tickets
                ),

              partner:
                statsPick(
                  x.tickets.map(
                    t => t.partner
                  )
                ),

              partnerIfAnchorWin:
                statsPick(
                  x.anchorWinPartners
                ),

              sample:
                x.tickets
                  .slice(
                    0,
                    20
                  )
                  .map(t => ({
                    date:
                      t.date,

                    anchor:
                      t.anchor.label,

                    anchorOdds:
                      t.anchor.odds,

                    anchorResult:
                      t.anchor.result,

                    partnerMarket:
                      t.partner.market,

                    partner:
                      t.partner.label,

                    partnerOdds:
                      t.partner.odds,

                    partnerConf:
                      +(
                        t.partner.confidence *
                        100
                      ).toFixed(2),

                    partnerGrade:
                      t.partner.grade,

                    partnerResult:
                      t.partner.result,

                    comboOdds:
                      +(
                        t.anchor.odds *
                        t.partner.odds
                      ).toFixed(3)
                  }))
            }
          ]
        )
      )
  };
}

const discovery =
  evaluate(
    DISC_START,
    DISC_END
  );

const internal =
  evaluate(
    INT_START,
    INT_END
  );

console.log(
  "============================================================"
);

console.log(
  "KBO ML1 SAFETY PARTNER V3.1"
);

console.log(
  "ANCHOR = DAILY BEST ML_EDGE"
);

console.log(
  "PARTNER = SAFETY RANKING ONLY"
);

console.log(
  "FINAL 07~09: LOCKED"
);

console.log(
  "============================================================"
);

console.log();
console.log(
  "===== ML1 BASELINE ====="
);

console.table([
  {
    period:"DISCOVERY",
    ...discovery.anchor
  },
  {
    period:"INTERNAL",
    ...internal.anchor
  }
]);

console.log();
console.log(
  "===== SAFETY PARTNER RESULTS ====="
);

const table = [];

for (
  const name
  of Object.keys(
    PARTNERS
  )
) {
  const d =
    discovery
      .partnerResults[name];

  const i =
    internal
      .partnerResults[name];

  table.push({
    selector:
      name,

    DBets:
      d.combo.bets,

    DComboHit:
      d.combo.hit,

    DComboOdds:
      d.combo.avgOdds,

    DComboROI:
      d.combo.roi,

    DPartnerHitIfAWin:
      d.partnerIfAnchorWin.hit,

    DPartnerOddsIfAWin:
      d.partnerIfAnchorWin.avgOdds,

    IBets:
      i.combo.bets,

    IComboHit:
      i.combo.hit,

    IComboOdds:
      i.combo.avgOdds,

    IComboROI:
      i.combo.roi,

    IPartnerHitIfAWin:
      i.partnerIfAnchorWin.hit,

    IPartnerOddsIfAWin:
      i.partnerIfAnchorWin.avgOdds
  });
}

console.table(
  table
);

console.log();
console.log(
  "===== INTERNAL SAMPLES ====="
);

for (
  const name
  of Object.keys(
    PARTNERS
  )
) {
  console.log();
  console.log(name);

  console.table(
    internal
      .partnerResults[name]
      .sample
  );
}

fs.writeFileSync(
  "data/kbo-ml1-safety-partner-v31.json",
  JSON.stringify(
    {
      generatedAt:
        new Date()
          .toISOString(),

      final:
        "LOCKED",

      anchor:
        "daily best ML_EDGE",

      selectors:
        Object.keys(
          PARTNERS
        ),

      discovery,

      internal
    },
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-ml1-safety-partner-v31.json"
);

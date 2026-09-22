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

function isUnder(x) {
  return (
    x.market === "TOTAL" &&
    (
      labelOf(x).includes("UNDER") ||
      labelOf(x).includes("언더")
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

        confidence:
          num(x.confidence),

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

function evPct(x) {
  if (x.ev === null) {
    return null;
  }

  return (
    Math.abs(x.ev) <= 1
      ? x.ev * 100
      : x.ev
  );
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

/*
  ------------------------------------------------------
  ML1 ANCHOR
  ------------------------------------------------------
*/

function getMlCandidates(dayRows) {
  return dayRows
    .filter(
      x =>
        x.market === "ML" &&
        x.selectedSide &&
        mlSignal(x) > 0
    )
    .map(x => ({
      ...x,
      signal:
        mlSignal(x)
    }))
    .sort(
      (a,b) =>
        b.signal -
        a.signal
    );
}

function getAnchor(dayRows) {
  const ml =
    getMlCandidates(
      dayRows
    );

  return ml[0] || null;
}

/*
  ------------------------------------------------------
  PARTNER FAMILIES
  ------------------------------------------------------
*/

const PARTNERS = {

  ML2:
    function(dayRows,anchor) {
      return getMlCandidates(
        dayRows
      )
        .filter(
          x =>
            pickKey(x) !==
            pickKey(anchor)
        )
        .filter(
          x =>
            canPair(
              anchor,
              x
            )
        )[0] || null;
    },

  HANDI1:
    function(dayRows,anchor) {
      return dayRows
        .filter(
          x =>
            x.market === "HANDICAP" &&
            x.selectedSide &&
            handiSignal(x) > 0
        )
        .map(x => ({
          ...x,
          signal:
            handiSignal(x)
        }))
        .filter(
          x =>
            canPair(
              anchor,
              x
            )
        )
        .sort(
          (a,b) =>
            b.signal -
            a.signal
        )[0] || null;
    },

  OVER_EV3_10:
    function(dayRows,anchor) {
      return dayRows
        .filter(
          x => {
            const ev =
              evPct(x);

            return (
              isOver(x) &&
              ev !== null &&
              ev >= 3 &&
              ev < 10 &&
              canPair(
                anchor,
                x
              )
            );
          }
        )
        .sort(
          (a,b) =>
            (evPct(b) || 0) -
            (evPct(a) || 0)
        )[0] || null;
    },

  UNDER_ANY:
    function(dayRows,anchor) {
      return dayRows
        .filter(
          x =>
            isUnder(x) &&
            canPair(
              anchor,
              x
            )
        )
        .sort(
          (a,b) => {
            const ae =
              evPct(a) ?? -999;

            const be =
              evPct(b) ?? -999;

            return be-ae;
          }
        )[0] || null;
    },

  TOTAL_ANY:
    function(dayRows,anchor) {
      return dayRows
        .filter(
          x =>
            x.market === "TOTAL" &&
            canPair(
              anchor,
              x
            )
        )
        .sort(
          (a,b) => {
            const ae =
              evPct(a) ?? -999;

            const be =
              evPct(b) ?? -999;

            return be-ae;
          }
        )[0] || null;
    },

  ANY_EV3_10:
    function(dayRows,anchor) {
      return dayRows
        .filter(
          x => {
            const ev =
              evPct(x);

            return (
              ev !== null &&
              ev >= 3 &&
              ev < 10 &&
              canPair(
                anchor,
                x
              )
            );
          }
        )
        .sort(
          (a,b) =>
            (evPct(b) || 0) -
            (evPct(a) || 0)
        )[0] || null;
    }
};

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

function pickStats(list) {
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
      returned += STAKE;
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

function comboStats(tickets) {
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
      returned += STAKE;
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

function evaluatePeriod(
  start,
  end
) {
  const anchors = [];

  const output = {};

  for (
    const name
    of Object.keys(
      PARTNERS
    )
  ) {
    output[name] = {
      tickets:[],
      partnerWhenAnchorWon:[],
      anchorWins:0,
      anchorWinPartnerWins:0
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
      getAnchor(
        dayRows
      );

    if (!anchor) {
      continue;
    }

    anchors.push(anchor);

    const anchorWon =
      anchor.result === "WIN";

    for (
      const [name,fn]
      of Object.entries(
        PARTNERS
      )
    ) {
      const partner =
        fn(
          dayRows,
          anchor
        );

      if (!partner) {
        continue;
      }

      output[name]
        .tickets
        .push({
          date,
          anchor,
          partner
        });

      if (anchorWon) {
        output[name]
          .anchorWins++;

        output[name]
          .partnerWhenAnchorWon
          .push(
            partner
          );

        if (
          partner.result ===
          "WIN"
        ) {
          output[name]
            .anchorWinPartnerWins++;
        }
      }
    }
  }

  return {
    anchorStats:
      pickStats(
        anchors
      ),

    anchorCount:
      anchors.length,

    partners:
      Object.fromEntries(
        Object.entries(
          output
        )
        .map(
          ([name,x]) => [
            name,
            {
              combo:
                comboStats(
                  x.tickets
                ),

              partnerOverall:
                pickStats(
                  x.tickets
                    .map(
                      t =>
                        t.partner
                    )
                ),

              anchorWinDays:
                x.anchorWins,

              partnerWinsOnAnchorWinDays:
                x.anchorWinPartnerWins,

              partnerHitWhenAnchorWins:
                x.anchorWins
                  ? +(
                      x.anchorWinPartnerWins /
                      x.anchorWins *
                      100
                    ).toFixed(2)
                  : 0,

              sample:
                x.tickets
                  .slice(0,15)
                  .map(
                    t => ({
                      date:
                        t.date,

                      anchor:
                        `${t.anchor.market}:${t.anchor.label}`,

                      anchorOdds:
                        t.anchor.odds,

                      anchorResult:
                        t.anchor.result,

                      partner:
                        `${t.partner.market}:${t.partner.label}`,

                      partnerOdds:
                        t.partner.odds,

                      partnerResult:
                        t.partner.result,

                      comboOdds:
                        +(
                          t.anchor.odds *
                          t.partner.odds
                        ).toFixed(3)
                    })
                  )
            }
          ]
        )
      )
  };
}

const discovery =
  evaluatePeriod(
    DISC_START,
    DISC_END
  );

const internal =
  evaluatePeriod(
    INT_START,
    INT_END
  );

console.log(
  "============================================================"
);

console.log(
  "KBO ML1 PARTNER AUDIT V3.0"
);

console.log(
  "ANCHOR = DAILY BEST ML_EDGE"
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

console.log();
console.log(
  "===== ML1 BASELINE ====="
);

console.table([
  {
    period:"DISCOVERY",
    ...discovery.anchorStats
  },
  {
    period:"INTERNAL",
    ...internal.anchorStats
  }
]);

console.log();
console.log(
  "===== PARTNER AUDIT ====="
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
      .partners[name];

  const i =
    internal
      .partners[name];

  table.push({
    partner:
      name,

    DBets:
      d.combo.bets,

    DComboROI:
      d.combo.roi,

    DPartnerROI:
      d.partnerOverall.roi,

    DAnchorWinDays:
      d.anchorWinDays,

    DPartnerHitIfAWin:
      d.partnerHitWhenAnchorWins,

    IBets:
      i.combo.bets,

    IComboROI:
      i.combo.roi,

    IPartnerROI:
      i.partnerOverall.roi,

    IAnchorWinDays:
      i.anchorWinDays,

    IPartnerHitIfAWin:
      i.partnerHitWhenAnchorWins
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
  console.log(
    name
  );

  console.table(
    internal
      .partners[name]
      .sample
  );
}

fs.writeFileSync(
  "data/kbo-ml1-partner-audit-v30.json",
  JSON.stringify(
    {
      generatedAt:
        new Date()
          .toISOString(),

      final:
        "LOCKED",

      anchor:
        "daily best ML_EDGE",

      discovery,

      internal
    },
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-ml1-partner-audit-v30.json"
);

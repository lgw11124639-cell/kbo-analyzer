const fs = require("fs");

const INPUT =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw =
  JSON.parse(
    fs.readFileSync(INPUT,"utf8")
  );

const all =
  (raw.results || raw)
    .filter(x =>
      ["WIN","LOSS"].includes(x.result) &&
      ["ML","HANDICAP","TOTAL"].includes(x.market) &&
      Number.isFinite(Number(x.odds)) &&
      Number(x.odds) > 1
    )
    .map(x => {
      let confidence =
        Number(x.confidence);

      if (
        Number.isFinite(confidence) &&
        confidence > 1
      ) {
        confidence /= 100;
      }

      return {
        ...x,
        odds:Number(x.odds),
        confidence:
          Number.isFinite(confidence)
            ? confidence
            : null,
        ev:
          Number.isFinite(Number(x.ev))
            ? Number(x.ev)
            : null,
        actual:
          x.result === "WIN"
            ? 1
            : 0
      };
    });

function num(v) {
  const x =
    Number(v);

  return Number.isFinite(x)
    ? x
    : null;
}

function mean(a) {
  if (!a.length)
    return 0;

  return (
    a.reduce(
      (s,x)=>s+x,
      0
    ) /
    a.length
  );
}

function sd(a) {
  if (!a.length)
    return 1;

  const m =
    mean(a);

  return (
    Math.sqrt(
      mean(
        a.map(
          x=>(x-m)**2
        )
      )
    ) ||
    1
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

function pickKey(x) {
  return `${x.gameId}:${x.market}:${x.label}`;
}

/*
  ---------------------------------------------------------
  A ENGINE
  HANDICAP FORM V3.7 그대로
  ---------------------------------------------------------
*/

const handiRows =
  all.filter(
    x =>
      x.market === "HANDICAP"
  );

const handiGroups =
  new Map();

for (const x of handiRows) {
  const key =
    `${x.date}:${x.gameId}:HANDICAP`;

  if (!handiGroups.has(key)) {
    handiGroups.set(key,[]);
  }

  handiGroups
    .get(key)
    .push(x);
}

const pairedHandi = [];

for (const list of handiGroups.values()) {
  if (list.length !== 2)
    continue;

  const [a,b] =
    list;

  const denom =
    1/a.odds +
    1/b.odds;

  for (
    const x
    of [a,b]
  ) {
    const s =
      side(x);

    const form =
      num(x.formEdge);

    if (
      !s ||
      form === null
    ) {
      continue;
    }

    const signedForm =
      s === "AWAY"
        ? form
        : -form;

    pairedHandi.push({
      ...x,

      signedForm,

      marketProb:
        (1/x.odds) /
        denom
    });
  }
}

const DISC_START =
  "2026-03-28";

const DISC_END =
  "2026-04-30";

const INT_START =
  "2026-05-01";

const INT_END =
  "2026-06-30";

const discoveryHandi =
  pairedHandi.filter(
    x =>
      x.date >= DISC_START &&
      x.date <= DISC_END
  );

const FORM_SD =
  sd(
    discoveryHandi.map(
      x=>x.signedForm
    )
  );

function zForm(x) {
  return (
    x.signedForm /
    FORM_SD
  );
}

const z =
  discoveryHandi.map(
    zForm
  );

const residual =
  discoveryHandi.map(
    x =>
      x.actual -
      x.marketProb
  );

const mz =
  mean(z);

const mr =
  mean(residual);

const covariance =
  mean(
    z.map(
      (v,i) =>
        (v-mz) *
        (residual[i]-mr)
    )
  );

const variance =
  mean(
    z.map(
      v =>
        (v-mz)**2
    )
  );

const BETA =
  variance
    ? covariance/variance
    : 0;

function enrichAnchor(x) {
  const adjustment =
    BETA *
    zForm(x);

  const adjustedProb =
    Math.max(
      .05,
      Math.min(
        .95,
        x.marketProb +
        adjustment
      )
    );

  return {
    ...x,

    adjustedProb,

    adjustedEV:
      adjustedProb *
      x.odds -
      1
  };
}

const anchorRows =
  pairedHandi.map(
    enrichAnchor
  );

function dailyAnchor(
  start,
  end
) {
  const days =
    new Map();

  for (const x of anchorRows) {
    if (
      x.date < start ||
      x.date > end ||
      x.adjustedEV <= 0
    ) {
      continue;
    }

    if (
      !days.has(x.date) ||
      x.adjustedEV >
      days.get(x.date).adjustedEV
    ) {
      days.set(
        x.date,
        x
      );
    }
  }

  return days;
}

/*
  ---------------------------------------------------------
  PARTNER SIGNALS
  threshold tuning 없음
  ---------------------------------------------------------
*/

function isOver(x) {
  const label =
    String(x.label || "")
      .toUpperCase();

  return (
    x.market === "TOTAL" &&
    (
      label.includes("OVER") ||
      label.includes("오버")
    )
  );
}

function isUnder(x) {
  const label =
    String(x.label || "")
      .toUpperCase();

  return (
    x.market === "TOTAL" &&
    (
      label.includes("UNDER") ||
      label.includes("언더")
    )
  );
}

const PARTNER_FAMILIES = {
  ML_ANY:
    x =>
      x.market === "ML",

  ML_EV_POS:
    x =>
      x.market === "ML" &&
      x.ev !== null &&
      x.ev > 0,

  ML_CONF50:
    x =>
      x.market === "ML" &&
      x.confidence !== null &&
      x.confidence >= .50,

  HANDI_ANY:
    x =>
      x.market === "HANDICAP",

  HANDI_EV_POS:
    x =>
      x.market === "HANDICAP" &&
      x.ev !== null &&
      x.ev > 0,

  OVER_ANY:
    x =>
      isOver(x),

  OVER_EV_POS:
    x =>
      isOver(x) &&
      x.ev !== null &&
      x.ev > 0,

  UNDER_ANY:
    x =>
      isUnder(x),

  UNDER_EV_POS:
    x =>
      isUnder(x) &&
      x.ev !== null &&
      x.ev > 0,

  ANY_EV_POS:
    x =>
      x.ev !== null &&
      x.ev > 0
};

function partnerScore(x) {
  const conf =
    x.confidence ?? 0;

  const ev =
    x.ev ?? -1;

  return (
    conf * 100 +
    ev * 100
  );
}

function selectPartner(
  anchor,
  dateRows,
  predicate
) {
  const candidates =
    dateRows
      .filter(
        x =>
          pickKey(x) !==
          pickKey(anchor)
      )
      .filter(
        predicate
      )
      .sort(
        (a,b) =>
          partnerScore(b) -
          partnerScore(a)
      );

  return (
    candidates[0] ||
    null
  );
}

function roiOfCombos(list) {
  if (!list.length) {
    return {
      bets:0,
      wins:0,
      hit:0,
      avgOdds:0,
      roi:0
    };
  }

  let wins = 0;
  let returned = 0;
  let oddsSum = 0;

  for (const x of list) {
    const comboOdds =
      x.anchor.odds *
      x.partner.odds;

    oddsSum +=
      comboOdds;

    const win =
      x.anchor.actual === 1 &&
      x.partner.actual === 1;

    if (win) {
      wins++;
      returned +=
        comboOdds;
    }
  }

  return {
    bets:
      list.length,

    wins,

    hit:
      +(wins/list.length*100)
        .toFixed(2),

    avgOdds:
      +(oddsSum/list.length)
        .toFixed(3),

    roi:
      +(
        (
          returned/list.length -
          1
        ) *
        100
      ).toFixed(2)
  };
}

function evaluatePeriod(
  name,
  start,
  end
) {
  const anchors =
    dailyAnchor(
      start,
      end
    );

  const rowsByDate =
    new Map();

  for (const x of all) {
    if (
      x.date < start ||
      x.date > end
    ) {
      continue;
    }

    if (!rowsByDate.has(x.date)) {
      rowsByDate.set(
        x.date,
        []
      );
    }

    rowsByDate
      .get(x.date)
      .push(x);
  }

  const output = {};

  console.log();
  console.log(
    `===== ${name} =====`
  );

  for (
    const [family,predicate]
    of Object.entries(
      PARTNER_FAMILIES
    )
  ) {
    const combos = [];

    for (
      const [date,anchor]
      of anchors.entries()
    ) {
      const dateRows =
        rowsByDate.get(date) ||
        [];

      const partner =
        selectPartner(
          anchor,
          dateRows,
          predicate
        );

      if (!partner)
        continue;

      combos.push({
        date,
        anchor,
        partner
      });
    }

    const anchorHitCombos =
      combos.filter(
        x =>
          x.anchor.actual === 1
      );

    const conditionalPartnerHit =
      anchorHitCombos.length
        ? (
            anchorHitCombos.filter(
              x =>
                x.partner.actual === 1
            ).length /
            anchorHitCombos.length *
            100
          )
        : 0;

    const sameGame =
      combos.filter(
        x =>
          x.anchor.gameId ===
          x.partner.gameId
      ).length;

    const stats =
      roiOfCombos(
        combos
      );

    output[family] = {
      ...stats,

      anchorHitDays:
        anchorHitCombos.length,

      partnerHitWhenAnchorHit:
        +conditionalPartnerHit
          .toFixed(2),

      sameGame,

      differentGame:
        combos.length -
        sameGame
    };
  }

  console.table(
    Object.entries(output)
      .map(
        ([family,x]) => ({
          family,
          ...x
        })
      )
  );

  return output;
}

console.log(
  "============================================================"
);

console.log(
  "KBO A-ANCHOR PARTNER AUDIT V3.8"
);

console.log(
  "A = HANDICAP FORM V3.7 / FROZEN"
);

console.log(
  "FINAL 07~09: NOT USED"
);

console.log(
  "============================================================"
);

console.log(
  "FORM_SD:",
  FORM_SD
);

console.log(
  "BETA:",
  BETA
);

const output = {
  formSd:
    FORM_SD,

  beta:
    BETA,

  discovery:
    evaluatePeriod(
      "DISCOVERY",
      DISC_START,
      DISC_END
    ),

  internal:
    evaluatePeriod(
      "INTERNAL",
      INT_START,
      INT_END
    )
};

fs.writeFileSync(
  "data/kbo-a-anchor-partners-v38.json",
  JSON.stringify(
    output,
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-a-anchor-partners-v38.json"
);

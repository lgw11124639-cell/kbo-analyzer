const fs = require("fs");

const INPUT =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw =
  JSON.parse(
    fs.readFileSync(INPUT, "utf8")
  );

const all =
  (raw.results || raw)
    .filter(x =>
      ["WIN", "LOSS"].includes(x.result) &&
      ["ML", "HANDICAP", "TOTAL"].includes(x.market) &&
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
        odds: Number(x.odds),
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
  const x = Number(v);

  return Number.isFinite(x)
    ? x
    : null;
}

function mean(a) {
  if (!a.length)
    return 0;

  return (
    a.reduce((s, x) => s + x, 0) /
    a.length
  );
}

function sd(a) {
  if (!a.length)
    return 1;

  const m = mean(a);

  return (
    Math.sqrt(
      mean(
        a.map(
          x => (x - m) ** 2
        )
      )
    ) || 1
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
  ==========================================================
  A ENGINE = HANDICAP FORM V3.7
  ==========================================================
*/

const handiRows =
  all.filter(
    x => x.market === "HANDICAP"
  );

const handiGroups =
  new Map();

for (const x of handiRows) {
  const key =
    `${x.date}:${x.gameId}:HANDICAP`;

  if (!handiGroups.has(key)) {
    handiGroups.set(key, []);
  }

  handiGroups
    .get(key)
    .push(x);
}

const pairedHandi = [];

for (const list of handiGroups.values()) {
  if (list.length !== 2)
    continue;

  const [a, b] = list;

  const denom =
    1 / a.odds +
    1 / b.odds;

  for (const x of [a, b]) {
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
        (1 / x.odds) /
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
      x => x.signedForm
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
      (v, i) =>
        (v - mz) *
        (residual[i] - mr)
    )
  );

const variance =
  mean(
    z.map(
      v =>
        (v - mz) ** 2
    )
  );

const BETA =
  variance
    ? covariance / variance
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

function dailyAnchor(start, end) {
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
  ==========================================================
  B ENGINE = ML_ANY / V3.8 FIXED
  ==========================================================
*/

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

function selectMLPartner(
  anchor,
  dateRows
) {
  const candidates =
    dateRows
      .filter(
        x =>
          x.market === "ML"
      )
      .filter(
        x =>
          pickKey(x) !==
          pickKey(anchor)
      )
      .sort(
        (a, b) =>
          partnerScore(b) -
          partnerScore(a)
      );

  return (
    candidates[0] ||
    null
  );
}

/*
  ==========================================================
  COMBO BUILD
  ==========================================================
*/

function buildCombos(
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

    if (
      !rowsByDate.has(x.date)
    ) {
      rowsByDate.set(
        x.date,
        []
      );
    }

    rowsByDate
      .get(x.date)
      .push(x);
  }

  const combos = [];

  for (
    const [date, anchor]
    of anchors.entries()
  ) {
    const dateRows =
      rowsByDate.get(date) ||
      [];

    const partner =
      selectMLPartner(
        anchor,
        dateRows
      );

    if (!partner)
      continue;

    const comboOdds =
      anchor.odds *
      partner.odds;

    const comboWin =
      anchor.actual === 1 &&
      partner.actual === 1;

    combos.push({
      date,
      anchor,
      partner,
      comboOdds,
      comboWin,
      sameGame:
        anchor.gameId ===
        partner.gameId
    });
  }

  return combos.sort(
    (a, b) =>
      a.date.localeCompare(
        b.date
      )
  );
}

function comboStats(list) {
  if (!list.length) {
    return {
      bets: 0,
      wins: 0,
      losses: 0,
      hit: 0,
      avgOdds: 0,
      roi: 0
    };
  }

  const wins =
    list.filter(
      x => x.comboWin
    ).length;

  const returned =
    list.reduce(
      (s, x) =>
        s +
        (
          x.comboWin
            ? x.comboOdds
            : 0
        ),
      0
    );

  return {
    bets:
      list.length,

    wins,

    losses:
      list.length - wins,

    hit:
      +(
        wins /
        list.length *
        100
      ).toFixed(2),

    avgOdds:
      +mean(
        list.map(
          x => x.comboOdds
        )
      ).toFixed(3),

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

function month(x) {
  return x.date.slice(0, 7);
}

function monthlyStats(list) {
  const map =
    new Map();

  for (const x of list) {
    const m =
      month(x);

    if (!map.has(m)) {
      map.set(m, []);
    }

    map.get(m).push(x);
  }

  return [
    ...map.entries()
  ]
    .sort(
      ([a], [b]) =>
        a.localeCompare(b)
    )
    .map(
      ([m, rows]) => ({
        month: m,
        ...comboStats(rows)
      })
    );
}

function bankrollStats(
  list,
  initial = 1000000,
  stake = 10000
) {
  let bank =
    initial;

  let peak =
    initial;

  let maxDD =
    0;

  let losingStreak =
    0;

  let maxLosingStreak =
    0;

  for (const x of list) {
    const pnl =
      x.comboWin
        ? (
            stake *
            x.comboOdds -
            stake
          )
        : -stake;

    bank += pnl;

    if (bank > peak) {
      peak = bank;
    }

    const dd =
      peak > 0
        ? (
            peak - bank
          ) / peak
        : 0;

    if (dd > maxDD) {
      maxDD = dd;
    }

    if (x.comboWin) {
      losingStreak = 0;
    } else {
      losingStreak++;

      maxLosingStreak =
        Math.max(
          maxLosingStreak,
          losingStreak
        );
    }
  }

  return {
    initial,

    final:
      Math.round(bank),

    profit:
      Math.round(
        bank - initial
      ),

    mdd:
      +(maxDD * 100)
        .toFixed(2),

    maxLosingStreak
  };
}

function report(
  name,
  start,
  end
) {
  const combos =
    buildCombos(
      start,
      end
    );

  const same =
    combos.filter(
      x => x.sameGame
    );

  const diff =
    combos.filter(
      x => !x.sameGame
    );

  console.log();
  console.log(
    `===== ${name} =====`
  );

  console.log();
  console.log(
    "ALL A+B"
  );

  console.table([
    comboStats(combos)
  ]);

  console.log();
  console.log(
    "MONTHLY"
  );

  console.table(
    monthlyStats(combos)
  );

  console.log();
  console.log(
    "SAME GAME / DIFFERENT GAME"
  );

  console.table([
    {
      type: "SAME_GAME",
      ...comboStats(same)
    },
    {
      type: "DIFFERENT_GAME",
      ...comboStats(diff)
    }
  ]);

  console.log();
  console.log(
    "BANKROLL"
  );

  console.table([
    bankrollStats(combos)
  ]);

  return {
    overall:
      comboStats(combos),

    monthly:
      monthlyStats(combos),

    sameGame:
      comboStats(same),

    differentGame:
      comboStats(diff),

    bankroll:
      bankrollStats(combos)
  };
}

console.log(
  "============================================================"
);

console.log(
  "KBO A+B COMBO BACKTEST V3.9"
);

console.log(
  "A = HANDICAP FORM V3.7 DAILY BEST"
);

console.log(
  "B = ML_ANY / HIGHEST partnerScore"
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
    report(
      "DISCOVERY",
      DISC_START,
      DISC_END
    ),

  internal:
    report(
      "INTERNAL",
      INT_START,
      INT_END
    )
};

fs.writeFileSync(
  "data/kbo-ab-combo-v39.json",
  JSON.stringify(
    output,
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-ab-combo-v39.json"
);

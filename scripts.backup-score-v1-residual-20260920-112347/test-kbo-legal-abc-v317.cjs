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

const FINAL_START =
  "2026-07-01";

const FINAL_END =
  "2026-09-30";

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
      .filter(x => x.gameId !== anchor.gameId)
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
  C / D EXTENSION AUDIT V3.11
  A+B RULES ARE FROZEN.
  FINAL 07~09 IS NOT USED.
  ==========================================================
*/

function extensionScore(x) {
  return partnerScore(x);
}

function extensionCandidates(anchor, partner, dateRows, family) {
  const used = new Set([
    pickKey(anchor),
    pickKey(partner)
  ]);

  return dateRows
    .filter(x => !used.has(pickKey(x)))

    // 실전 규칙:
    // A가 HANDICAP이므로
    // 같은 경기 ML은 조합 불가
    .filter(x =>
      !(
        x.market === "ML" &&
        x.gameId === anchor.gameId
      )
    )

    .filter(x => {
      if (family === "ANY")
        return true;

      if (family === "ML")
        return x.market === "ML";

      if (family === "HANDI")
        return x.market === "HANDICAP";

      if (family === "OVER")
        return (
          x.market === "TOTAL" &&
          String(x.label || "").includes("오버")
        );

      if (family === "UNDER")
        return (
          x.market === "TOTAL" &&
          String(x.label || "").includes("언더")
        );

      return false;
    })
    .sort((a, b) => extensionScore(b) - extensionScore(a));
}

function auditExtensions(start, end) {
  const anchors = dailyAnchor(start, end);

  const rowsByDate = new Map();

  for (const x of all) {
    if (x.date < start || x.date > end)
      continue;

    if (!rowsByDate.has(x.date))
      rowsByDate.set(x.date, []);

    rowsByDate.get(x.date).push(x);
  }

  const families = [
    "ML"
  ];

  const result = [];

  for (const family of families) {
    const rows = [];

    for (const [date, anchor] of anchors.entries()) {
      const dateRows = rowsByDate.get(date) || [];

      const legalMLRows =
        dateRows.filter(x =>
          !(
            x.market === "ML" &&
            x.gameId === anchor.gameId
          )
        );

      const partner =
        selectMLPartner(anchor, legalMLRows);

      if (!partner)
        continue;

      const ext =
        extensionCandidates(
          anchor,
          partner,
          dateRows,
          family
        );

      const c = ext[0] || null;
      const d = null;

      if (!c)
        continue;

      const abWin =
        anchor.actual === 1 &&
        partner.actual === 1;

      const abcWin =
        abWin &&
        c.actual === 1;

      const abcdWin =
        abcWin &&
        d &&
        d.actual === 1;

      rows.push({
        date,
        anchor,
        partner,
        c,
        d,

        abWin,
        abcWin,
        abcdWin: !!abcdWin,

        abcOdds:
          anchor.odds *
          partner.odds *
          c.odds,

        abcdOdds:
          d
            ? anchor.odds *
              partner.odds *
              c.odds *
              d.odds
            : null,

        cHitWhenABHit:
          abWin
            ? c.actual
            : null,

        dHitWhenABCHit:
          abcWin && d
            ? d.actual
            : null,

        cSameAsAnchorGame:
          c.gameId === anchor.gameId,

        dSameAsAnchorGame:
          d
            ? d.gameId === anchor.gameId
            : null
      });
    }

    const abcRows = rows;

    const abcdRows =
      rows.filter(x => x.d);

    const abcWins =
      abcRows.filter(x => x.abcWin).length;

    const abcdWins =
      abcdRows.filter(x => x.abcdWin).length;

    const abcReturned =
      abcRows.reduce(
        (sum, x) =>
          sum +
          (x.abcWin ? x.abcOdds : 0),
        0
      );

    const abcdReturned =
      abcdRows.reduce(
        (sum, x) =>
          sum +
          (x.abcdWin ? x.abcdOdds : 0),
        0
      );

    const abHitRows =
      rows.filter(x => x.abWin);

    const abcHitRows =
      rows.filter(x => x.abcWin && x.d);

    result.push({
      family,

      cDays:
        abcRows.length,

      cWins:
        abcWins,

      abcHit:
        abcRows.length
          ? +(abcWins / abcRows.length * 100).toFixed(2)
          : 0,

      abcAvgOdds:
        abcRows.length
          ? +mean(
              abcRows.map(x => x.abcOdds)
            ).toFixed(3)
          : 0,

      abcROI:
        abcRows.length
          ? +(
              (abcReturned / abcRows.length - 1) *
              100
            ).toFixed(2)
          : 0,

      abHitDays:
        abHitRows.length,

      cHitWhenABHit:
        abHitRows.length
          ? +(
              abHitRows.filter(
                x => x.c.actual === 1
              ).length /
              abHitRows.length *
              100
            ).toFixed(2)
          : 0,

      dDays:
        abcdRows.length,

      dWins:
        abcdWins,

      abcdHit:
        abcdRows.length
          ? +(abcdWins / abcdRows.length * 100).toFixed(2)
          : 0,

      abcdAvgOdds:
        abcdRows.length
          ? +mean(
              abcdRows.map(x => x.abcdOdds)
            ).toFixed(3)
          : 0,

      abcdROI:
        abcdRows.length
          ? +(
              (abcdReturned / abcdRows.length - 1) *
              100
            ).toFixed(2)
          : 0,

      abcHitDays:
        abcHitRows.length,

      dHitWhenABCHit:
        abcHitRows.length
          ? +(
              abcHitRows.filter(
                x => x.d.actual === 1
              ).length /
              abcHitRows.length *
              100
            ).toFixed(2)
          : 0
    });
  }

  return result;
}

function printExtensionAudit(name, start, end) {
  console.log();
  console.log(`===== ${name} C/D EXTENSION =====`);

  const result =
    auditExtensions(start, end);

  console.table(result);

  return result;
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
  "KBO LEGAL A+B+C V3.17"
);

console.log(
  "A = HANDICAP FORM V3.7 DAILY BEST"
);

console.log(
  "B = ML_ANY / HIGHEST partnerScore"
);

console.log(
  "RULE CHANGE = SAME-GAME ML+HANDICAP EXCLUDED / NO SCORE RETUNING"
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

  discoveryAB:
    report(
      "DISCOVERY",
      DISC_START,
      DISC_END
    ),

  internalAB:
    report(
      "INTERNAL",
      INT_START,
      INT_END
    ),

  discoveryExtensions:
    printExtensionAudit(
      "DISCOVERY",
      DISC_START,
      DISC_END
    ),

  internalExtensions:
    printExtensionAudit(
      "INTERNAL",
      INT_START,
      INT_END
    ),

  finalExtensions:
    printExtensionAudit(
      "FINAL 07~09",
      FINAL_START,
      FINAL_END
    )
};

fs.writeFileSync(
  "data/kbo-legal-abc-v317.json",
  JSON.stringify(
    output,
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-legal-abc-v317.json"
);

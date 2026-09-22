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

const DISC_START = "2026-03-28";
const DISC_END   = "2026-04-30";
const INT_START  = "2026-05-01";
const INT_END    = "2026-06-30";

function mean(a) {
  if (!a.length) return 0;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function sd(a) {
  if (!a.length) return 1;

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

function num(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function side(x) {
  const label = String(x.label || "");
  const away = String(x.awayTeam || "");
  const home = String(x.homeTeam || "");

  if (away && label.includes(away))
    return "AWAY";

  if (home && label.includes(home))
    return "HOME";

  return null;
}

function pickKey(x) {
  return `${x.gameId}:${x.market}:${x.label}`;
}

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

/*
============================================================
A ENGINE
============================================================
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

  if (!handiGroups.has(key))
    handiGroups.set(key, []);

  handiGroups.get(key).push(x);
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
    const s = side(x);
    const form = num(x.formEdge);

    if (!s || form === null)
      continue;

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
  return x.signedForm / FORM_SD;
}

const z =
  discoveryHandi.map(zForm);

const residual =
  discoveryHandi.map(
    x =>
      x.actual -
      x.marketProb
  );

const mz = mean(z);
const mr = mean(residual);

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

const anchorRows =
  pairedHandi.map(x => {
    const adjustedProb =
      Math.max(
        .05,
        Math.min(
          .95,
          x.marketProb +
          BETA * zForm(x)
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
  });

function dailyAnchor(start, end) {
  const days = new Map();

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
      days.set(x.date, x);
    }
  }

  return days;
}

/*
============================================================
B / C
B = ML #1
C = ML #2
============================================================
*/

function getBC(anchor, dateRows) {
  const ml =
    dateRows
      .filter(
        x => x.market === "ML"
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

  return {
    b: ml[0] || null,
    c: ml[1] || null
  };
}

/*
============================================================
D CANDIDATE
============================================================
*/

function isFamily(x, family) {
  const label =
    String(x.label || "");

  if (family === "ML")
    return x.market === "ML";

  if (family === "HANDI")
    return x.market === "HANDICAP";

  if (family === "OVER")
    return (
      x.market === "TOTAL" &&
      label.includes("오버")
    );

  if (family === "UNDER")
    return (
      x.market === "TOTAL" &&
      label.includes("언더")
    );

  return false;
}

function selectD(
  a,
  b,
  c,
  dateRows,
  family
) {
  const used =
    new Set([
      pickKey(a),
      pickKey(b),
      pickKey(c)
    ]);

  return (
    dateRows
      .filter(
        x =>
          !used.has(
            pickKey(x)
          )
      )
      .filter(
        x =>
          isFamily(
            x,
            family
          )
      )
      .sort(
        (x, y) =>
          partnerScore(y) -
          partnerScore(x)
      )[0] ||
    null
  );
}

/*
============================================================
AUDIT
============================================================
*/

function auditPeriod(
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

    if (!rowsByDate.has(x.date))
      rowsByDate.set(x.date, []);

    rowsByDate
      .get(x.date)
      .push(x);
  }

  const families = [
    "ML",
    "HANDI",
    "OVER",
    "UNDER"
  ];

  const output = [];

  for (const family of families) {
    const rows = [];

    for (
      const [date, a]
      of anchors.entries()
    ) {
      const dateRows =
        rowsByDate.get(date) ||
        [];

      const { b, c } =
        getBC(
          a,
          dateRows
        );

      if (!b || !c)
        continue;

      const d =
        selectD(
          a,
          b,
          c,
          dateRows,
          family
        );

      if (!d)
        continue;

      const abWin =
        a.actual === 1 &&
        b.actual === 1;

      const abcWin =
        abWin &&
        c.actual === 1;

      const abcdWin =
        abcWin &&
        d.actual === 1;

      const abcdOdds =
        a.odds *
        b.odds *
        c.odds *
        d.odds;

      rows.push({
        date,
        a,
        b,
        c,
        d,
        abcWin,
        abcdWin,
        abcdOdds
      });
    }

    const wins =
      rows.filter(
        x => x.abcdWin
      ).length;

    const returned =
      rows.reduce(
        (sum, x) =>
          sum +
          (
            x.abcdWin
              ? x.abcdOdds
              : 0
          ),
        0
      );

    const abcHitRows =
      rows.filter(
        x => x.abcWin
      );

    const dHitGivenABC =
      abcHitRows.length
        ? (
            abcHitRows.filter(
              x => x.d.actual === 1
            ).length /
            abcHitRows.length *
            100
          )
        : 0;

    output.push({
      family,

      days:
        rows.length,

      wins,

      hit:
        rows.length
          ? +(
              wins /
              rows.length *
              100
            ).toFixed(2)
          : 0,

      avgOdds:
        rows.length
          ? +mean(
              rows.map(
                x => x.abcdOdds
              )
            ).toFixed(3)
          : 0,

      roi:
        rows.length
          ? +(
              (
                returned /
                rows.length -
                1
              ) *
              100
            ).toFixed(2)
          : 0,

      abcHitDays:
        abcHitRows.length,

      dHitWhenABCHit:
        +dHitGivenABC
          .toFixed(2)
    });
  }

  console.log();
  console.log(
    `===== ${name} D AUDIT =====`
  );

  console.table(output);

  return output;
}

console.log(
  "============================================================"
);

console.log(
  "KBO D-LEG AUDIT V3.14"
);

console.log(
  "A = HANDICAP FORM V3.7"
);

console.log(
  "B = ML #1"
);

console.log(
  "C = ML #2"
);

console.log(
  "D = BEST REMAINING BY FAMILY"
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

const discovery =
  auditPeriod(
    "DISCOVERY",
    DISC_START,
    DISC_END
  );

const internal =
  auditPeriod(
    "INTERNAL",
    INT_START,
    INT_END
  );

const output = {
  formSd:
    FORM_SD,

  beta:
    BETA,

  discovery,
  internal
};

fs.writeFileSync(
  "data/kbo-d-leg-v314.json",
  JSON.stringify(
    output,
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-d-leg-v314.json"
);

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
B = LEGAL PARTNER FAMILY AUDIT
SAME-GAME ML + HANDICAP = FORBIDDEN
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


function isBFamily(x, anchor, family) {
  /*
  핵심 실전 규칙:
  A = HANDICAP
  같은 gameId의 ML은 선택 금지.
  */

  if (
    x.market === "ML" &&
    x.gameId === anchor.gameId
  ) {
    return false;
  }

  if (family === "ML_DIFF") {
    return (
      x.market === "ML" &&
      x.gameId !== anchor.gameId
    );
  }

  if (family === "HANDI_DIFF") {
    return (
      x.market === "HANDICAP" &&
      x.gameId !== anchor.gameId
    );
  }

  if (family === "OVER") {
    return (
      x.market === "TOTAL" &&
      String(x.label || "").includes("오버")
    );
  }

  if (family === "UNDER") {
    return (
      x.market === "TOTAL" &&
      String(x.label || "").includes("언더")
    );
  }

  if (family === "TOTAL") {
    return x.market === "TOTAL";
  }

  if (family === "ANY_LEGAL") {
    return (
      pickKey(x) !== pickKey(anchor)
    );
  }

  return false;
}

function selectB(
  anchor,
  dateRows,
  family
) {
  return (
    dateRows
      .filter(
        x =>
          pickKey(x) !==
          pickKey(anchor)
      )
      .filter(
        x =>
          isBFamily(
            x,
            anchor,
            family
          )
      )
      .sort(
        (a, b) =>
          partnerScore(b) -
          partnerScore(a)
      )[0] ||
    null
  );
}

/*
============================================================
AUDIT
============================================================
*/


function bankrollStats(rows) {
  let bank = 1000000;
  let peak = bank;
  let maxDD = 0;

  let losing = 0;
  let maxLosing = 0;

  for (const x of rows) {
    const stake = 10000;

    const returned =
      x.win
        ? stake * x.comboOdds
        : 0;

    bank +=
      returned -
      stake;

    if (bank > peak)
      peak = bank;

    const dd =
      peak > 0
        ? (
            (peak - bank) /
            peak *
            100
          )
        : 0;

    if (dd > maxDD)
      maxDD = dd;

    if (x.win) {
      losing = 0;
    } else {
      losing++;

      if (losing > maxLosing)
        maxLosing = losing;
    }
  }

  return {
    finalBank:
      Math.round(bank),

    profit:
      Math.round(
        bank -
        1000000
      ),

    mdd:
      +maxDD.toFixed(2),

    maxLosingStreak:
      maxLosing
  };
}

function monthlyStats(rows) {
  const m = new Map();

  for (const x of rows) {
    const month =
      x.date.slice(0, 7);

    if (!m.has(month)) {
      m.set(month, {
        month,
        bets: 0,
        wins: 0,
        returned: 0
      });
    }

    const r =
      m.get(month);

    r.bets++;

    if (x.win) {
      r.wins++;
      r.returned +=
        x.comboOdds;
    }
  }

  return [...m.values()]
    .map(x => ({
      month:
        x.month,

      bets:
        x.bets,

      wins:
        x.wins,

      hit:
        x.bets
          ? +(
              x.wins /
              x.bets *
              100
            ).toFixed(2)
          : 0,

      roi:
        x.bets
          ? +(
              (
                x.returned /
                x.bets -
                1
              ) *
              100
            ).toFixed(2)
          : 0
    }));
}

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
    "ML_DIFF",
    "HANDI_DIFF",
    "OVER",
    "UNDER",
    "TOTAL",
    "ANY_LEGAL"
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

      const b =
        selectB(
          a,
          dateRows,
          family
        );

      if (!b)
        continue;

      /*
      이 체크는 실수 방지용.
      ML + HANDICAP 같은 경기면
      절대 B에 포함시키지 않는다.
      */

      if (
        b.market === "ML" &&
        b.gameId === a.gameId
      ) {
        continue;
      }

      const win =
        a.actual === 1 &&
        b.actual === 1;

      const comboOdds =
        a.odds *
        b.odds;

      rows.push({
        date,
        a,
        b,
        win,
        comboOdds
      });
    }

    const wins =
      rows.filter(
        x => x.win
      ).length;

    const returned =
      rows.reduce(
        (sum, x) =>
          sum +
          (
            x.win
              ? x.comboOdds
              : 0
          ),
        0
      );

    const bank =
      bankrollStats(rows);

    output.push({
      family,

      bets:
        rows.length,

      wins,

      losses:
        rows.length -
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
                x => x.comboOdds
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

      mdd:
        bank.mdd,

      losingStreak:
        bank.maxLosingStreak,

      finalBank:
        bank.finalBank,

      monthly:
        monthlyStats(rows)
    });
  }

  console.log();
  console.log(
    `===== ${name} LEGAL B AUDIT =====`
  );

  console.table(
    output.map(x => ({
      family:
        x.family,

      bets:
        x.bets,

      wins:
        x.wins,

      hit:
        x.hit,

      avgOdds:
        x.avgOdds,

      roi:
        x.roi,

      mdd:
        x.mdd,

      losingStreak:
        x.losingStreak
    }))
  );

  console.log();

  for (const x of output) {
    console.log(
      `--- ${name} / ${x.family} MONTHLY ---`
    );

    console.table(
      x.monthly
    );
  }

  return output;
}

console.log(
  "============================================================"
);

console.log(
  "KBO LEGAL B AUDIT V3.18"
);

console.log(
  "A = HANDICAP FORM V3.7 / FROZEN"
);

console.log(
  "B = LEGAL PARTNER FAMILY AUDIT"
);

console.log(
  "SAME-GAME ML + HANDICAP = FORBIDDEN"
);

console.log(
  "FINAL 07~09 = NOT USED"
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
  "data/kbo-legal-b-v318.json",
  JSON.stringify(
    output,
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-legal-b-v318.json"
);

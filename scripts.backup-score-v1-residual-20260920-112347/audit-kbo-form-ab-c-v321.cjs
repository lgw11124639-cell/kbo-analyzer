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

const FINAL_START = "2026-07-01";
const FINAL_END   = "2026-09-30";

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
B = SAME FROZEN HANDICAP FORM MODEL / NEXT DIFFERENT GAME
A/B = DIFFERENT GAME HANDICAP PICKS
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



function partnerScore(x) {
  const conf =
    Number(x.confidence || 0);

  const ev =
    Number(x.ev || 0);

  return (
    conf * 100 +
    ev * 100
  );
}

function isCFamily(x, a, b, family) {
  /*
  실전 조합 규칙

  A/B = HANDICAP

  같은 경기 ML + HANDICAP 금지.
  따라서 C가 ML이면
  A/B 경기 모두 제외.

  TOTAL은 HANDICAP과
  같은 경기여도 허용.
  */

  if (
    x.market === "ML" &&
    (
      x.gameId === a.gameId ||
      x.gameId === b.gameId
    )
  ) {
    return false;
  }

  if (family === "ML") {
    return x.market === "ML";
  }

  if (family === "OVER") {
    return (
      x.market === "TOTAL" &&
      String(x.label || "")
        .includes("오버")
    );
  }

  if (family === "UNDER") {
    return (
      x.market === "TOTAL" &&
      String(x.label || "")
        .includes("언더")
    );
  }

  if (family === "TOTAL") {
    return x.market === "TOTAL";
  }

  return false;
}

function auditC(
  name,
  start,
  end
) {
  const abRows =
    getFormAB(start, end);

  const byDate =
    new Map();

  for (const x of all) {
    if (
      x.date < start ||
      x.date > end
    ) {
      continue;
    }

    if (!byDate.has(x.date))
      byDate.set(x.date, []);

    byDate
      .get(x.date)
      .push(x);
  }

  const families = [
    "ML",
    "OVER",
    "UNDER",
    "TOTAL"
  ];

  const output = [];

  for (const family of families) {
    const rows = [];

    for (const ab of abRows) {
      const dateRows =
        byDate.get(ab.date) || [];

      const candidates =
        dateRows
          .filter(
            x =>
              isCFamily(
                x,
                ab.a,
                ab.b,
                family
              )
          )
          .sort(
            (x, y) =>
              partnerScore(y) -
              partnerScore(x)
          );

      const c =
        candidates[0] || null;

      if (!c)
        continue;

      const abWin =
        ab.win;

      const cWin =
        c.actual === 1;

      const abcWin =
        abWin && cWin;

      const abcOdds =
        ab.comboOdds *
        c.odds;

      rows.push({
        date:
          ab.date,

        a:
          ab.a,

        b:
          ab.b,

        c,

        abWin,
        cWin,
        abcWin,
        abcOdds
      });
    }

    const wins =
      rows.filter(
        x => x.abcWin
      ).length;

    const abHitRows =
      rows.filter(
        x => x.abWin
      );

    const cHitOnAB =
      abHitRows.filter(
        x => x.cWin
      ).length;

    const returned =
      rows.reduce(
        (sum, x) =>
          sum +
          (
            x.abcWin
              ? x.abcOdds
              : 0
          ),
        0
      );

    const avgOdds =
      rows.length
        ? rows.reduce(
            (sum, x) =>
              sum + x.abcOdds,
            0
          ) / rows.length
        : 0;

    const roi =
      rows.length
        ? (
            returned /
            rows.length -
            1
          ) * 100
        : 0;

    output.push({
      family,

      days:
        rows.length,

      abcWins:
        wins,

      abcHit:
        rows.length
          ? +(
              wins /
              rows.length *
              100
            ).toFixed(2)
          : 0,

      avgOdds:
        +avgOdds.toFixed(3),

      abcROI:
        +roi.toFixed(2),

      abHitDays:
        abHitRows.length,

      cHitWhenABHit:
        abHitRows.length
          ? +(
              cHitOnAB /
              abHitRows.length *
              100
            ).toFixed(2)
          : 0
    });
  }

  console.log();
  console.log(
    `===== ${name} C AUDIT =====`
  );

  console.table(output);

  return output;
}

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


function getFormAB(start, end) {
  const byDate = new Map();

  for (const x of anchorRows) {
    if (
      x.date < start ||
      x.date > end ||
      x.adjustedEV <= 0
    ) {
      continue;
    }

    if (!byDate.has(x.date))
      byDate.set(x.date, []);

    byDate.get(x.date).push(x);
  }

  const rows = [];

  for (const [date, picks] of byDate.entries()) {
    const sorted =
      [...picks].sort(
        (a, b) =>
          b.adjustedEV -
          a.adjustedEV
      );

    const a =
      sorted[0] || null;

    if (!a)
      continue;

    const b =
      sorted.find(
        x =>
          x.gameId !== a.gameId
      ) || null;

    if (!b)
      continue;

    const comboOdds =
      a.odds *
      b.odds;

    const win =
      a.actual === 1 &&
      b.actual === 1;

    rows.push({
      date,
      a,
      b,
      win,
      comboOdds
    });
  }

  return rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date)
  );
}

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

    bank += returned - stake;

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

    maxDD =
      Math.max(
        maxDD,
        dd
      );

    if (x.win) {
      losing = 0;
    } else {
      losing++;
      maxLosing =
        Math.max(
          maxLosing,
          losing
        );
    }
  }

  return {
    finalBank:
      Math.round(bank),

    profit:
      Math.round(
        bank - 1000000
      ),

    mdd:
      +maxDD.toFixed(2),

    maxLosingStreak:
      maxLosing
  };
}

function auditPeriod(
  name,
  start,
  end
) {
  const rows =
    getFormAB(
      start,
      end
    );

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

  const avgOdds =
    rows.length
      ? mean(
          rows.map(
            x => x.comboOdds
          )
        )
      : 0;

  const roi =
    rows.length
      ? (
          returned /
          rows.length -
          1
        ) * 100
      : 0;

  const bank =
    bankrollStats(rows);

  const months =
    new Map();

  for (const x of rows) {
    const month =
      x.date.slice(0, 7);

    if (!months.has(month)) {
      months.set(month, {
        month,
        bets: 0,
        wins: 0,
        returned: 0
      });
    }

    const m =
      months.get(month);

    m.bets++;

    if (x.win) {
      m.wins++;
      m.returned +=
        x.comboOdds;
    }
  }

  const monthly =
    [...months.values()]
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

  const result = {
    bets:
      rows.length,

    wins,

    losses:
      rows.length - wins,

    hit:
      rows.length
        ? +(
            wins /
            rows.length *
            100
          ).toFixed(2)
        : 0,

    avgOdds:
      +avgOdds.toFixed(3),

    roi:
      +roi.toFixed(2),

    mdd:
      bank.mdd,

    losingStreak:
      bank.maxLosingStreak,

    finalBank:
      bank.finalBank,

    monthly
  };

  console.log();
  console.log(
    `===== ${name} FORM #1 + FORM #2 =====`
  );

  console.table([
    {
      bets:
        result.bets,
      wins:
        result.wins,
      losses:
        result.losses,
      hit:
        result.hit,
      avgOdds:
        result.avgOdds,
      roi:
        result.roi,
      mdd:
        result.mdd,
      losingStreak:
        result.losingStreak
    }
  ]);

  console.log();
  console.log("MONTHLY");
  console.table(monthly);

  return result;
}

console.log(
  "============================================================"
);

console.log(
  "KBO FROZEN A+B / C AUDIT V3.21"
);

console.log(
  "A = HANDICAP FORM V3.7 / FROZEN"
);

console.log(
  "B = SAME FROZEN HANDICAP FORM MODEL / NEXT DIFFERENT GAME"
);

console.log(
  "A/B = DIFFERENT GAME HANDICAP PICKS"
);

console.log(
  "C SELECTION = DISCOVERY + INTERNAL ONLY / FINAL NOT USED"
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

const discoveryC =
  auditC(
    "DISCOVERY",
    DISC_START,
    DISC_END
  );

const internalC =
  auditC(
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
  internal,
  discoveryC,
  internalC
};

fs.writeFileSync(
  "data/kbo-form-ab-c-v321.json",
  JSON.stringify(
    output,
    null,
    2
  )
);

console.log();
console.log(
  "SAVED: data/kbo-form-ab-c-v321.json"
);

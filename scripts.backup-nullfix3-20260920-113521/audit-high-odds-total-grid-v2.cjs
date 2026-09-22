const fs =
  require("fs");

const raw =
  JSON.parse(
    fs.readFileSync(
      "data/kbo-engine-stats-v0.1-backtest.json",
      "utf8"
    )
  );

const rows =
  raw?.aiCombos?.records ||
  [];

const base =
  rows.filter(
    r =>
      r.mode === "HIGH_ODDS" &&
      Number(r.leg) === 2 &&
      Array.isArray(r.picks) &&
      r.picks.length === 2 &&
      r.picks.every(
        p =>
          String(
            p.market || ""
          ).toUpperCase() ===
          "TOTAL"
      )
  );

const avgConfList = [
  0.58,
  0.60,
  0.62,
  0.64,
  0.65,
];

const avgEvList = [
  -0.03,
  -0.01,
  0,
  0.01,
  0.03,
];

const minPickConfList = [
  0.55,
  0.57,
  0.60,
];

function phase(r) {
  return String(
    r.date || ""
  ) <= "2026-07-31"
    ? "TRAIN"
    : "VALID";
}

function settle(list) {
  let wins = 0;
  let losses = 0;
  let stake = 0;
  let returned = 0;

  for (
    const r of list
  ) {
    const result =
      String(
        r.result || ""
      ).toUpperCase();

    const odds =
      Number(
        r.effectiveOdds ??
        r.odds
      );

    stake += 1;

    if (
      result === "WIN"
    ) {
      wins++;

      returned +=
        Number.isFinite(
          odds
        )
          ? odds
          : 0;

    } else if (
      result === "LOSS"
    ) {
      losses++;

    } else {
      returned += 1;
    }
  }

  const decided =
    wins +
    losses;

  return {
    n:
      list.length,

    wins,
    losses,

    hit:
      decided
        ? wins /
          decided
        : null,

    roi:
      stake
        ? (
            returned -
            stake
          ) /
          stake
        : null,

    profit:
      returned -
      stake,
  };
}

function pct(v) {
  return v === null
    ? "-"
    : (
        v *
        100
      ).toFixed(1) +
      "%";
}

const results = [];

for (
  const avgConf
  of avgConfList
) {
  for (
    const avgEv
    of avgEvList
  ) {
    for (
      const minPickConf
      of minPickConfList
    ) {
      const list =
        base.filter(
          r => {
            if (
              Number(
                r.averageConfidence
              ) <
              avgConf
            ) {
              return false;
            }

            if (
              Number(
                r.averageEv
              ) <
              avgEv
            ) {
              return false;
            }

            return (
              r.picks.every(
                p =>
                  Number(
                    p.confidence
                  ) >=
                  minPickConf
              )
            );
          }
        );

      if (
        list.length < 8
      ) {
        continue;
      }

      const train =
        list.filter(
          r =>
            phase(r) ===
            "TRAIN"
        );

      const valid =
        list.filter(
          r =>
            phase(r) ===
            "VALID"
        );

      const a =
        settle(list);

      const t =
        settle(train);

      const v =
        settle(valid);

      results.push({
        avgConf,
        avgEv,
        minPickConf,

        all:
          a,

        train:
          t,

        valid:
          v,
      });
    }
  }
}

results.sort(
  (a, b) => {
    /*
      TRAIN/VALID 둘 다 망하지 않는 조건을 우선.
      그 다음 전체 ROI.
    */

    const aMin =
      Math.min(
        a.train.roi ??
          -999,
        a.valid.roi ??
          -999
      );

    const bMin =
      Math.min(
        b.train.roi ??
          -999,
        b.valid.roi ??
          -999
      );

    if (
      bMin !== aMin
    ) {
      return (
        bMin -
        aMin
      );
    }

    return (
      (
        b.all.roi ??
        -999
      ) -
      (
        a.all.roi ??
        -999
      )
    );
  }
);

console.log(
  "============================================"
);

console.log(
  "HIGH_ODDS TOTAL+TOTAL GRID V2"
);

console.log(
  "============================================"
);

console.log(
  "BASE N=",
  base.length
);

console.log(
  "\n===== TOP STABLE RULES ====="
);

for (
  const r of
  results.slice(
    0,
    40
  )
) {
  console.log(
    [
      `AVGCONF>=${(
        r.avgConf *
        100
      ).toFixed(0)}%`,

      `AVGEV>=${(
        r.avgEv *
        100
      ).toFixed(0)}%`,

      `PICKCONF>=${(
        r.minPickConf *
        100
      ).toFixed(0)}%`,

      `N=${r.all.n}`,

      `ALL=${pct(
        r.all.roi
      )}`,

      `TRAIN=${r.train.n}/${pct(
        r.train.roi
      )}`,

      `VALID=${r.valid.n}/${pct(
        r.valid.roi
      )}`,

      `HIT=${pct(
        r.all.hit
      )}`,
    ].join(
      " | "
    )
  );
}

console.log(
  "\n===== POSITIVE BOTH ====="
);

const positiveBoth =
  results.filter(
    r =>
      r.train.n >= 5 &&
      r.valid.n >= 3 &&
      (r.train.roi ?? -1) >
        0 &&
      (r.valid.roi ?? -1) >
        0
  );

for (
  const r of positiveBoth
) {
  console.log(
    [
      `AVGCONF>=${(
        r.avgConf *
        100
      ).toFixed(0)}%`,

      `AVGEV>=${(
        r.avgEv *
        100
      ).toFixed(0)}%`,

      `PICKCONF>=${(
        r.minPickConf *
        100
      ).toFixed(0)}%`,

      `N=${r.all.n}`,

      `ALL=${pct(
        r.all.roi
      )}`,

      `TRAIN=${r.train.n}/${pct(
        r.train.roi
      )}`,

      `VALID=${r.valid.n}/${pct(
        r.valid.roi
      )}`,
    ].join(
      " | "
    )
  );
}

console.log(
  "\n===== DONE ====="
);

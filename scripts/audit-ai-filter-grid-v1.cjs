const fs = require("fs");

const raw = JSON.parse(
  fs.readFileSync(
    "data/kbo-engine-stats-v0.1-backtest.json",
    "utf8"
  )
);

const rows =
  raw?.aiCombos?.records ||
  [];

const modes = [
  "SAFE",
  "VALUE",
  "HIGH_ODDS",
];

const legs = [2, 3];

const minConfList = [
  0.57,
  0.60,
  0.62,
  0.64,
  0.65,
  0.67,
];

const minEvList = [
  -0.10,
  -0.05,
  -0.03,
  0,
  0.02,
];

function phase(r) {
  return String(
    r.date || ""
  ) <= "2026-07-31"
    ? "TRAIN"
    : "VALID";
}

function summarize(list) {
  let wins = 0;
  let losses = 0;
  let stake = 0;
  let returned = 0;

  for (const r of list) {
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

    if (result === "WIN") {
      wins++;

      returned +=
        Number.isFinite(odds)
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
    wins + losses;

  return {
    n: list.length,
    hit:
      decided
        ? wins / decided
        : null,
    roi:
      stake
        ? (
            returned - stake
          ) / stake
        : null,
  };
}

function pct(v) {
  return v === null
    ? "-"
    : (
        v * 100
      ).toFixed(1) + "%";
}

for (const mode of modes) {
  console.log(
    `\n\n######## ${mode} ########`
  );

  for (const leg of legs) {
    console.log(
      `\n--- ${leg}폴 ---`
    );

    const base =
      rows.filter(
        r =>
          r.mode === mode &&
          Number(r.leg) === leg
      );

    for (
      const minConf
      of minConfList
    ) {
      for (
        const minEv
        of minEvList
      ) {
        const filtered =
          base.filter(
            r =>
              Number(
                r.averageConfidence
              ) >= minConf &&
              Number(
                r.averageEv
              ) >= minEv
          );

        if (
          filtered.length < 10
        ) {
          continue;
        }

        const train =
          summarize(
            filtered.filter(
              r =>
                phase(r) ===
                "TRAIN"
            )
          );

        const valid =
          summarize(
            filtered.filter(
              r =>
                phase(r) ===
                "VALID"
            )
          );

        const all =
          summarize(
            filtered
          );

        console.log(
          [
            `CONF>=${(
              minConf * 100
            ).toFixed(0)}%`,
            `EV>=${(
              minEv * 100
            ).toFixed(0)}%`,
            `N=${all.n}`,
            `ALL ${pct(all.roi)}`,
            `TRAIN ${train.n}/${pct(train.roi)}`,
            `VALID ${valid.n}/${pct(valid.roi)}`,
          ].join(
            " | "
          )
        );
      }
    }
  }
}

console.log(
  "\n===== DONE ====="
);

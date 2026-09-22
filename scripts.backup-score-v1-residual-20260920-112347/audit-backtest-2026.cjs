const fs = require("fs");

const FILE =
  "data/kbo-backtest-2026.json";

const data =
  JSON.parse(
    fs.readFileSync(
      FILE,
      "utf8"
    )
  );

const rows =
  Array.isArray(data.results)
    ? data.results
    : [];

function summary(items) {
  const settled =
    items.filter(
      x =>
        x.result === "WIN" ||
        x.result === "LOSS"
    );

  const wins =
    settled.filter(
      x => x.result === "WIN"
    ).length;

  const losses =
    settled.filter(
      x => x.result === "LOSS"
    ).length;

  const stake =
    items.reduce(
      (s, x) =>
        s +
        Number(x.stake || 0),
      0
    );

  const returned =
    items.reduce(
      (s, x) =>
        s +
        Number(
          x.returned || 0
        ),
      0
    );

  const profit =
    items.reduce(
      (s, x) =>
        s +
        Number(x.profit || 0),
      0
    );

  return {
    bets: items.length,
    wins,
    losses,

    hitRate:
      settled.length
        ? Number(
            (
              wins /
              settled.length *
              100
            ).toFixed(2)
          )
        : 0,

    avgOdds:
      items.length
        ? Number(
            (
              items.reduce(
                (s, x) =>
                  s +
                  Number(
                    x.odds || 0
                  ),
                0
              ) /
              items.length
            ).toFixed(3)
          )
        : 0,

    stake,

    returned:
      Math.round(returned),

    profit:
      Math.round(profit),

    roi:
      stake
        ? Number(
            (
              profit /
              stake *
              100
            ).toFixed(2)
          )
        : 0,
  };
}

function tableBy(
  title,
  keyFn,
  source = rows
) {
  const groups =
    new Map();

  for (const row of source) {
    const key =
      keyFn(row);

    if (!groups.has(key)) {
      groups.set(
        key,
        []
      );
    }

    groups
      .get(key)
      .push(row);
  }

  console.log();
  console.log(
    `===== ${title} =====`
  );

  console.table(
    [...groups.entries()]
      .sort(
        ([a], [b]) =>
          String(a)
            .localeCompare(
              String(b)
            )
      )
      .map(
        ([key, items]) => ({
          group: key,
          ...summary(items),
        })
      )
  );
}

const totals =
  rows.filter(
    x =>
      x.market === "TOTAL"
  );

console.log(
  "===== TOTAL BASE ====="
);

console.table([
  summary(totals),
]);

tableBy(
  "OVER / UNDER",
  x =>
    String(x.label)
      .startsWith("오버")
      ? "OVER"
      : "UNDER",
  totals
);

tableBy(
  "MONTH",
  x => x.month,
  totals
);

tableBy(
  "MONTH + SIDE",
  x =>
    `${x.month} ${
      String(x.label)
        .startsWith("오버")
        ? "OVER"
        : "UNDER"
    }`,
  totals
);

/*
  projectedTotal과 실제 기준점은
  label에서 기준점을 뽑는다.
*/
function totalLine(row) {
  const match =
    String(row.label)
      .match(
        /(-?\d+(?:\.\d+)?)/
      );

  return match
    ? Number(match[1])
    : null;
}

function edge(row) {
  const line =
    totalLine(row);

  const projected =
    Number(
      row.projectedTotal
    );

  if (
    line === null ||
    !Number.isFinite(
      projected
    )
  ) {
    return null;
  }

  return Math.abs(
    projected - line
  );
}

tableBy(
  "TOTAL EDGE",
  row => {
    const e = edge(row);

    if (e === null) {
      return "UNKNOWN";
    }

    if (e < 1.0) {
      return "0.80~0.99";
    }

    if (e < 1.5) {
      return "1.00~1.49";
    }

    if (e < 2.0) {
      return "1.50~1.99";
    }

    return "2.00+";
  },
  totals
);

tableBy(
  "EV BUCKET",
  row => {
    const ev =
      Number(row.ev);

    if (ev < 0.03) {
      return "0~2.9%";
    }

    if (ev < 0.06) {
      return "3~5.9%";
    }

    if (ev < 0.10) {
      return "6~9.9%";
    }

    return "10%+";
  },
  totals
);

tableBy(
  "CONFIDENCE",
  row => {
    const p =
      Number(
        row.confidence
      );

    if (p < 0.58) {
      return "57~57.9%";
    }

    if (p < 0.60) {
      return "58~59.9%";
    }

    if (p < 0.62) {
      return "60~61.9%";
    }

    return "62%+";
  },
  totals
);

tableBy(
  "ODDS",
  row => {
    const odds =
      Number(row.odds);

    if (odds < 1.65) {
      return "<1.65";
    }

    if (odds < 1.75) {
      return "1.65~1.74";
    }

    if (odds < 1.85) {
      return "1.75~1.84";
    }

    return "1.85+";
  },
  totals
);

console.log();
console.log(
  "===== 기간별 안정성 ====="
);

console.table([
  {
    period:
      "전체",
    ...summary(totals),
  },
  {
    period:
      "4월 이후",
    ...summary(
      totals.filter(
        x =>
          x.date >=
          "2026-04-01"
      )
    ),
  },
  {
    period:
      "5월 이후",
    ...summary(
      totals.filter(
        x =>
          x.date >=
          "2026-05-01"
      )
    ),
  },
  {
    period:
      "6월 이후",
    ...summary(
      totals.filter(
        x =>
          x.date >=
          "2026-06-01"
      )
    ),
  },
]);

console.log();
console.log(
  "===== 실제 추천 30개 샘플 ====="
);

console.table(
  totals
    .slice(0, 30)
    .map(
      x => ({
        date:
          x.date,

        match:
          `${x.awayTeam} @ ${x.homeTeam}`,

        pick:
          x.label,

        odds:
          x.odds,

        projected:
          x.projectedTotal,

        edge:
          edge(x) === null
            ? null
            : Number(
                edge(x)
                  .toFixed(2)
              ),

        confidence:
          Number(
            (
              x.confidence *
              100
            ).toFixed(1)
          ),

        ev:
          Number(
            (
              x.ev *
              100
            ).toFixed(1)
          ),

        result:
          x.result,

        profit:
          x.profit,
      })
    )
);

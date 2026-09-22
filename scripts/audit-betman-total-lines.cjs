const fs = require("fs");

const data = JSON.parse(
  fs.readFileSync(
    "data/betman-kbo-history-2026.json",
    "utf8"
  )
);

const games =
  Array.isArray(data.games)
    ? data.games
    : [];

const rows =
  games
    .filter(g => g.total)
    .map(g => ({
      date: g.date,
      round: g.round,
      gmTs: g.gmTs,
      match:
        `${g.awayTeam} @ ${g.homeTeam}`,
      line: g.total?.line ?? null,
      over: g.total?.overOdds ?? null,
      under: g.total?.underOdds ?? null,
    }));

console.log(
  "===== TOTAL LINE 분포 ====="
);

const dist = {};

for (const row of rows) {
  const key =
    String(row.line);

  dist[key] =
    (dist[key] || 0) + 1;
}

console.table(
  Object.entries(dist)
    .sort(
      (a, b) =>
        Number(a[0]) -
        Number(b[0])
    )
    .map(([line, count]) => ({
      line,
      count,
    }))
);

console.log();
console.log(
  "===== 7.5 이하 의심 TOTAL ====="
);

console.table(
  rows
    .filter(
      x =>
        Number(x.line) <= 7.5
    )
    .slice(0, 200)
);

console.log();
console.log(
  "===== 월별 기준점 평균 ====="
);

const months = {};

for (const row of rows) {
  const month =
    row.date.slice(0, 7);

  if (!months[month]) {
    months[month] = [];
  }

  if (
    Number.isFinite(
      Number(row.line)
    )
  ) {
    months[month].push(
      Number(row.line)
    );
  }
}

console.table(
  Object.entries(months)
    .sort()
    .map(([month, values]) => ({
      month,
      count: values.length,
      avgLine:
        Number(
          (
            values.reduce(
              (a, b) => a + b,
              0
            ) /
            values.length
          ).toFixed(2)
        ),
      minLine:
        Math.min(...values),
      maxLine:
        Math.max(...values),
    }))
);

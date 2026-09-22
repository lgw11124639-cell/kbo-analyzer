const fs = require("fs");

const FILE =
  "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const raw =
  JSON.parse(
    fs.readFileSync(
      FILE,
      "utf8"
    )
  );

const source =
  Array.isArray(raw)
    ? raw
    : raw.results ||
      raw.recommendations ||
      [];

function num(v) {
  const n =
    Number(v);

  return Number.isFinite(n)
    ? n
    : null;
}

function conf(v) {
  let n =
    num(v);

  if (n === null) {
    return null;
  }

  if (n > 1) {
    n /= 100;
  }

  return n;
}

function grade(c) {
  if (c >= 0.62) {
    return "A";
  }

  if (c >= 0.57) {
    return "B";
  }

  return "C";
}

function result(v) {
  const s =
    String(v ?? "")
      .toUpperCase();

  if (s === "WIN") {
    return "WIN";
  }

  if (
    s === "LOSS" ||
    s === "LOSE"
  ) {
    return "LOSS";
  }

  return null;
}

function dateOf(r) {
  return String(
    r.date ??
    r.gameDate ??
    ""
  ).slice(0, 10);
}

/*
  경기 + 시장별
  모델 우세 방향 1개만 선택
*/
const map =
  new Map();

for (const r of source) {
  const market =
    String(
      r.market ?? ""
    ).toUpperCase();

  if (
    ![
      "ML",
      "HANDICAP",
      "TOTAL",
    ].includes(market)
  ) {
    continue;
  }

  const c =
    conf(
      r.confidence
    );

  const res =
    result(
      r.result
    );

  const odds =
    num(
      r.odds
    );

  if (
    c === null ||
    res === null ||
    odds === null ||
    odds <= 1
  ) {
    continue;
  }

  const gameId =
    String(
      r.gameId ??
      `${dateOf(r)}:${r.awayTeam}:${r.homeTeam}`
    );

  const key =
    `${gameId}::${market}`;

  const current =
    map.get(key);

  if (
    !current ||
    c >
      conf(
        current.confidence
      )
  ) {
    map.set(
      key,
      r
    );
  }
}

const rows =
  [...map.values()]
    .map(r => {
      const confidence =
        conf(
          r.confidence
        );

      const odds =
        num(
          r.odds
        );

      const ev =
        confidence !== null &&
        odds !== null
          ? confidence *
              odds -
            1
          : null;

      const projected =
        num(
          r.projectedTotal
        );

      const totalLine =
        num(
          r.totalLine
        );

      let totalEdge =
        null;

      if (
        projected !== null &&
        totalLine !== null
      ) {
        totalEdge =
          Math.abs(
            projected -
            totalLine
          );
      }

      return {
        ...r,

        date:
          dateOf(r),

        market:
          String(
            r.market
          ).toUpperCase(),

        confidence,

        odds,

        ev,

        grade:
          grade(
            confidence
          ),

        result:
          result(
            r.result
          ),

        totalEdge,
      };
    })
    .filter(
      r =>
        r.confidence !== null &&
        r.ev !== null &&
        r.result !== null
    );

function summary(list) {
  const wins =
    list.filter(
      r =>
        r.result === "WIN"
    ).length;

  const losses =
    list.filter(
      r =>
        r.result === "LOSS"
    ).length;

  let profit =
    0;

  for (const r of list) {
    if (
      r.result === "WIN"
    ) {
      profit +=
        r.odds - 1;
    } else {
      profit -=
        1;
    }
  }

  return {
    count:
      list.length,

    wins,

    losses,

    hit:
      list.length
        ? wins /
          list.length
        : 0,

    roi:
      list.length
        ? profit /
          list.length
        : 0,

    profit,
  };
}

function fmtPct(v) {
  return (
    v * 100
  ).toFixed(2) + "%";
}

const thresholds = [
  -0.10,
  -0.08,
  -0.05,
  -0.03,
  -0.02,
  -0.01,
  0,
  0.01,
  0.02,
  0.03,
  0.05,
  0.08,
  0.10,
];

const markets = [
  "ML",
  "HANDICAP",
  "TOTAL",
];

function eligible(
  r,
  threshold
) {
  /*
    현재 등급 기준 유지
    A/B만 대상
  */
  if (
    r.grade === "C"
  ) {
    return false;
  }

  /*
    시장별 최소 EV 기준
  */
  if (
    r.ev <
    threshold
  ) {
    return false;
  }

  /*
    현재 O/U 규칙 유지
  */
  if (
    r.market ===
      "TOTAL" &&
    r.totalEdge !==
      null &&
    r.totalEdge <
      0.8
  ) {
    return false;
  }

  return true;
}

function phase(
  r
) {
  if (
    !r.date
  ) {
    return "UNKNOWN";
  }

  return (
    r.date <=
    "2026-07-31"
  )
    ? "TRAIN"
    : "VALID";
}

console.log(
  "=========================================="
);

console.log(
  "EV THRESHOLD AUDIT V1"
);

console.log(
  "A>=62% / B>=57% / C<57%"
);

console.log(
  "TOTAL edge >= 0.8 유지"
);

console.log(
  "TRAIN <= 2026-07-31"
);

console.log(
  "VALID >= 2026-08-01"
);

console.log(
  "=========================================="
);

for (
  const market
  of markets
) {
  console.log(
    `\n\n######## ${market} ########`
  );

  console.log(
    "THRESHOLD | ALL N HIT ROI | TRAIN N HIT ROI | VALID N HIT ROI"
  );

  for (
    const threshold
    of thresholds
  ) {
    const marketRows =
      rows.filter(
        r =>
          r.market ===
            market &&
          eligible(
            r,
            threshold
          )
      );

    const train =
      marketRows.filter(
        r =>
          phase(r) ===
          "TRAIN"
      );

    const valid =
      marketRows.filter(
        r =>
          phase(r) ===
          "VALID"
      );

    const a =
      summary(
        marketRows
      );

    const t =
      summary(
        train
      );

    const v =
      summary(
        valid
      );

    console.log(
      [
        `${threshold >= 0 ? "+" : ""}${(
          threshold *
          100
        ).toFixed(0)}%`
          .padStart(5),

        `ALL ${String(
          a.count
        ).padStart(3)} ${fmtPct(
          a.hit
        ).padStart(7)} ${fmtPct(
          a.roi
        ).padStart(8)}`,

        `TRAIN ${String(
          t.count
        ).padStart(3)} ${fmtPct(
          t.hit
        ).padStart(7)} ${fmtPct(
          t.roi
        ).padStart(8)}`,

        `VALID ${String(
          v.count
        ).padStart(3)} ${fmtPct(
          v.hit
        ).padStart(7)} ${fmtPct(
          v.roi
        ).padStart(8)}`,
      ].join(
        " | "
      )
    );
  }
}

/*
  EV 자체 구간도 확인
*/
const buckets = [
  {
    name:
      "< -10%",
    min:
      -Infinity,
    max:
      -0.10,
  },
  {
    name:
      "-10~-5%",
    min:
      -0.10,
    max:
      -0.05,
  },
  {
    name:
      "-5~-3%",
    min:
      -0.05,
    max:
      -0.03,
  },
  {
    name:
      "-3~0%",
    min:
      -0.03,
    max:
      0,
  },
  {
    name:
      "0~3%",
    min:
      0,
    max:
      0.03,
  },
  {
    name:
      "3~5%",
    min:
      0.03,
    max:
      0.05,
  },
  {
    name:
      "5~10%",
    min:
      0.05,
    max:
      0.10,
  },
  {
    name:
      "10%+",
    min:
      0.10,
    max:
      Infinity,
  },
];

console.log(
  "\n\n=========================================="
);

console.log(
  "EV BUCKET PERFORMANCE"
);

console.log(
  "A/B급만 집계"
);

console.log(
  "=========================================="
);

for (
  const market
  of markets
) {
  console.log(
    `\n### ${market}`
  );

  for (
    const bucket
    of buckets
  ) {
    const list =
      rows.filter(
        r =>
          r.market ===
            market &&
          r.grade !==
            "C" &&
          r.ev >=
            bucket.min &&
          r.ev <
            bucket.max &&
          (
            market !==
              "TOTAL" ||
            r.totalEdge ===
              null ||
            r.totalEdge >=
              0.8
          )
      );

    const s =
      summary(
        list
      );

    console.log(
      `${bucket.name.padEnd(
        9
      )} N=${String(
        s.count
      ).padStart(
        3
      )} HIT=${fmtPct(
        s.hit
      ).padStart(
        7
      )} ROI=${fmtPct(
        s.roi
      ).padStart(
        8
      )}`
    );
  }
}

console.log(
  "\n===== DONE ====="
);

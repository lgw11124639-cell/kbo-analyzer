const fs = require("fs");

const INPUT =
  "data/kbo-score-features-v06.json";

const OUT =
  "data/kbo-score-model-v06-round2.json";

const raw =
  JSON.parse(
    fs.readFileSync(INPUT, "utf8")
  );

const games =
  (raw.games || []).filter(
    g =>
      g?.target &&
      Number.isFinite(
        Number(g.target.awayScore)
      ) &&
      Number.isFinite(
        Number(g.target.homeScore)
      )
  );

function num(v) {
  const n = Number(v);
  return Number.isFinite(n)
    ? n
    : null;
}

function clamp(v,lo,hi) {
  return Math.max(
    lo,
    Math.min(hi,v)
  );
}

function splitOf(date) {
  if (date <= "2026-04-30")
    return "DISCOVERY";

  if (date <= "2026-06-30")
    return "INTERNAL";

  return "FINAL";
}

/*
  ============================================================
  V0.3와 같은 usable sample

  기존 V0.3 predictV03는
  away/home avgRuns + avgRunsAllowed가
  모두 있어야 prediction을 생성했다.

  따라서 여기서도 동일 조건으로 제한한다.
  ============================================================
*/

function baseInputs(g) {
  const league =
    num(
      g.environment
        ?.leagueRunsPerTeamD1
    );

  const ar =
    num(
      g.awayTeamForm
        ?.seasonAvgRuns
    );

  const ara =
    num(
      g.awayTeamForm
        ?.seasonAvgRunsAllowed
    );

  const hr =
    num(
      g.homeTeamForm
        ?.seasonAvgRuns
    );

  const hra =
    num(
      g.homeTeamForm
        ?.seasonAvgRunsAllowed
    );

  if (
    league === null ||
    ar === null ||
    ara === null ||
    hr === null ||
    hra === null
  ) {
    return null;
  }

  return {
    league,
    ar,
    ara,
    hr,
    hra
  };
}

/*
  ============================================================
  V0.3 P80 W0.40 TEAM BASE 재현

  league 60%
  team/opponent 40%
  ============================================================
*/

function v03TeamBase(g) {
  const x =
    baseInputs(g);

  if (!x)
    return null;

  const awayExpectation =
    (x.ar + x.hra) / 2;

  const homeExpectation =
    (x.hr + x.ara) / 2;

  return {
    away:
      x.league*0.60 +
      awayExpectation*0.40,

    home:
      x.league*0.60 +
      homeExpectation*0.40,

    league:
      x.league
  };
}

/*
  ============================================================
  V0.3 STARTER 단계 재현

  기존 최고 margin 후보의 base는
  V03 P80 W0.4 STARTER였다.

  season ERA 60%
  recent5 ERA 40%

  ERA coefficient = 0.09
  clamp ±0.40
  ============================================================
*/

function blendedEraV03(
  season,
  recent5
) {
  const s = num(season);
  const r = num(recent5);

  if (
    s !== null &&
    r !== null
  ) {
    return s*0.60 + r*0.40;
  }

  if (s !== null)
    return s;

  if (r !== null)
    return r;

  return null;
}

function addV03Starter(g,p) {
  const league =
    p.league;

  const awayStarter =
    g.starter?.away;

  const homeStarter =
    g.starter?.home;

  const awayEra =
    blendedEraV03(
      awayStarter?.era,
      awayStarter?.recent5?.era
    );

  const homeEra =
    blendedEraV03(
      homeStarter?.era,
      homeStarter?.recent5?.era
    );

  let away = p.away;
  let home = p.home;

  if (homeEra !== null) {
    away += clamp(
      (homeEra-league)*0.09,
      -0.40,
      0.40
    );
  }

  if (awayEra !== null) {
    home += clamp(
      (awayEra-league)*0.09,
      -0.40,
      0.40
    );
  }

  return {
    ...p,
    away,
    home
  };
}

/*
  ============================================================
  V0.3 M4.5 시장 margin
  ============================================================
*/

function addMarket45(g,p) {
  const prob =
    num(
      g.market?.awayNoVig
    );

  if (prob === null)
    return p;

  const edge =
    (prob-0.50)*2;

  const shift =
    edge*4.50;

  return {
    ...p,

    away:
      p.away +
      shift/2,

    home:
      p.home -
      shift/2
  };
}

function finish(p) {
  if (!p)
    return null;

  return {
    away:
      clamp(
        p.away,
        1.75,
        7.75
      ),

    home:
      clamp(
        p.home,
        1.75,
        7.75
      )
  };
}

function champion(g) {
  let p =
    v03TeamBase(g);

  if (!p)
    return null;

  p =
    addV03Starter(g,p);

  p =
    addMarket45(g,p);

  return finish(p);
}

/*
  ============================================================
  평가
  ============================================================
*/

function evaluate(
  predictor,
  split
) {
  if (
    split !== "DISCOVERY" &&
    split !== "INTERNAL"
  ) {
    throw new Error(
      "FINAL HOLDOUT IS LOCKED"
    );
  }

  let n = 0;

  let teamAbs = 0;
  let totalAbs = 0;
  let diffAbs = 0;

  let within1 = 0;
  let within2 = 0;

  let winnerN = 0;
  let winnerHit = 0;

  let awayBias = 0;
  let homeBias = 0;

  for (const g of games) {
    if (
      splitOf(g.date) !== split
    ) {
      continue;
    }

    const p =
      predictor(g);

    if (!p)
      continue;

    const a =
      Number(
        g.target.awayScore
      );

    const h =
      Number(
        g.target.homeScore
      );

    const aeA =
      Math.abs(
        p.away-a
      );

    const aeH =
      Math.abs(
        p.home-h
      );

    const predTotal =
      p.away+p.home;

    const actualTotal =
      a+h;

    const predDiff =
      p.away-p.home;

    const actualDiff =
      a-h;

    teamAbs +=
      (aeA+aeH)/2;

    totalAbs +=
      Math.abs(
        predTotal-actualTotal
      );

    diffAbs +=
      Math.abs(
        predDiff-actualDiff
      );

    awayBias +=
      p.away-a;

    homeBias +=
      p.home-h;

    if (
      aeA <= 1 &&
      aeH <= 1
    ) {
      within1++;
    }

    if (
      aeA <= 2 &&
      aeH <= 2
    ) {
      within2++;
    }

    if (
      actualDiff !== 0
    ) {
      winnerN++;

      if (
        Math.sign(predDiff) ===
        Math.sign(actualDiff)
      ) {
        winnerHit++;
      }
    }

    n++;
  }

  return {
    n,

    teamMAE:
      n
        ? teamAbs/n
        : null,

    totalMAE:
      n
        ? totalAbs/n
        : null,

    diffMAE:
      n
        ? diffAbs/n
        : null,

    within1:
      n
        ? within1/n
        : null,

    within2:
      n
        ? within2/n
        : null,

    winnerAcc:
      winnerN
        ? winnerHit/winnerN
        : null,

    awayBias:
      n
        ? awayBias/n
        : null,

    homeBias:
      n
        ? homeBias/n
        : null
  };
}

function score(
  predictor
) {
  const d =
    evaluate(
      predictor,
      "DISCOVERY"
    );

  const i =
    evaluate(
      predictor,
      "INTERNAL"
    );

  return {
    discovery: d,
    internal: i,

    avgTeamMAE:
      (
        d.teamMAE +
        i.teamMAE
      )/2,

    avgTotalMAE:
      (
        d.totalMAE +
        i.totalMAE
      )/2,

    avgDiffMAE:
      (
        d.diffMAE +
        i.diffMAE
      )/2
  };
}

/*
  ============================================================
  Feature transforms

  전부 champion 결과 위에
  단 하나씩만 적용한다.
  ============================================================
*/

function recentExpectation(
  g,
  window
) {
  const a =
    g.awayTeamForm?.[
      `recent${window}`
    ];

  const h =
    g.homeTeamForm?.[
      `recent${window}`
    ];

  if (
    !a ||
    !h ||
    a.games < window ||
    h.games < window
  ) {
    return null;
  }

  const ar =
    num(a.avgRuns);

  const ara =
    num(
      a.avgRunsAllowed
    );

  const hr =
    num(h.avgRuns);

  const hra =
    num(
      h.avgRunsAllowed
    );

  if (
    ar === null ||
    ara === null ||
    hr === null ||
    hra === null
  ) {
    return null;
  }

  return {
    away:
      (ar+hra)/2,

    home:
      (hr+ara)/2
  };
}

function venueExpectation(g) {
  const a =
    g.awayTeamForm;

  const h =
    g.homeTeamForm;

  if (
    !a ||
    !h ||
    a.awayGames < 5 ||
    h.homeGames < 5
  ) {
    return null;
  }

  const ar =
    num(a.awayAvgRuns);

  const ara =
    num(
      a.awayAvgRunsAllowed
    );

  const hr =
    num(h.homeAvgRuns);

  const hra =
    num(
      h.homeAvgRunsAllowed
    );

  if (
    ar === null ||
    ara === null ||
    hr === null ||
    hra === null
  ) {
    return null;
  }

  return {
    away:
      (ar+hra)/2,

    home:
      (hr+ara)/2
  };
}

function addBlendFeature(
  p,
  target,
  weight
) {
  if (!target)
    return p;

  return {
    ...p,

    away:
      p.away*(1-weight) +
      target.away*weight,

    home:
      p.home*(1-weight) +
      target.home*weight
  };
}

/*
  WHIP:
  상대 선발 WHIP가 높으면
  공격 예상득점 증가.
*/

function addWhip(
  g,p,coef
) {
  const aw =
    num(
      g.starter
        ?.away?.whip
    );

  const hw =
    num(
      g.starter
        ?.home?.whip
    );

  return {
    ...p,

    away:
      p.away +
      (
        hw === null
          ? 0
          : clamp(
              (hw-1.40)*coef,
              -0.35,
              0.35
            )
      ),

    home:
      p.home +
      (
        aw === null
          ? 0
          : clamp(
              (aw-1.40)*coef,
              -0.35,
              0.35
            )
      )
  };
}

/*
  선발 AVG:
  historical starter stats의 avg.
  높을수록 피안타율이 나쁜 것으로 해석.
*/

function addStarterAvg(
  g,p,coef
) {
  const aa =
    num(
      g.starter
        ?.away?.avg
    );

  const ha =
    num(
      g.starter
        ?.home?.avg
    );

  return {
    ...p,

    away:
      p.away +
      (
        ha === null
          ? 0
          : clamp(
              (ha-0.260)*coef,
              -0.30,
              0.30
            )
      ),

    home:
      p.home +
      (
        aa === null
          ? 0
          : clamp(
              (aa-0.260)*coef,
              -0.30,
              0.30
            )
      )
  };
}

/*
  K/BB proxy.

  BB가 많고 K가 적으면
  상대 공격에 플러스.

  누적값이라 innings로 normalize.
*/

function pitcherControl(s) {
  if (!s)
    return null;

  const ip =
    num(s.innings);

  const k =
    num(s.strikeouts);

  const bb =
    num(s.walks);

  if (
    ip === null ||
    ip < 5 ||
    k === null ||
    bb === null
  ) {
    return null;
  }

  return {
    k9:
      k/ip*9,

    bb9:
      bb/ip*9
  };
}

function addControl(
  g,p,coef
) {
  const a =
    pitcherControl(
      g.starter?.away
    );

  const h =
    pitcherControl(
      g.starter?.home
    );

  function weakness(x) {
    if (!x)
      return 0;

    return (
      (x.bb9-3.2)*0.35 -
      (x.k9-7.5)*0.12
    );
  }

  return {
    ...p,

    away:
      p.away +
      clamp(
        weakness(h)*coef,
        -0.30,
        0.30
      ),

    home:
      p.home +
      clamp(
        weakness(a)*coef,
        -0.30,
        0.30
      )
  };
}

/*
  라인업 OPS.
*/

function addLineupOps(
  g,p,coef
) {
  const a =
    num(
      g.lineup
        ?.away?.avgOps
    );

  const h =
    num(
      g.lineup
        ?.home?.avgOps
    );

  return {
    ...p,

    away:
      p.away +
      (
        a === null
          ? 0
          : clamp(
              (a-0.750)*coef,
              -0.35,
              0.35
            )
      ),

    home:
      p.home +
      (
        h === null
          ? 0
          : clamp(
              (h-0.750)*coef,
              -0.35,
              0.35
            )
      )
  };
}

/*
  라인업 OBP.
*/

function addLineupObp(
  g,p,coef
) {
  const a =
    num(
      g.lineup
        ?.away?.avgObp
    );

  const h =
    num(
      g.lineup
        ?.home?.avgObp
    );

  return {
    ...p,

    away:
      p.away +
      (
        a === null
          ? 0
          : clamp(
              (a-0.330)*coef,
              -0.30,
              0.30
            )
      ),

    home:
      p.home +
      (
        h === null
          ? 0
          : clamp(
              (h-0.330)*coef,
              -0.30,
              0.30
            )
      )
  };
}

/*
  라인업 SLG.
*/

function addLineupSlg(
  g,p,coef
) {
  const a =
    num(
      g.lineup
        ?.away?.avgSlg
    );

  const h =
    num(
      g.lineup
        ?.home?.avgSlg
    );

  return {
    ...p,

    away:
      p.away +
      (
        a === null
          ? 0
          : clamp(
              (a-0.420)*coef,
              -0.30,
              0.30
            )
      ),

    home:
      p.home +
      (
        h === null
          ? 0
          : clamp(
              (h-0.420)*coef,
              -0.30,
              0.30
            )
      )
  };
}

/*
  팀 vs 상대선발.
  shrinkage + power.
*/

function matchupOne(
  base,
  x,
  prior,
  power
) {
  const n =
    num(x?.games);

  const r =
    num(x?.avgRuns);

  if (
    n === null ||
    n < 1 ||
    r === null
  ) {
    return base;
  }

  const rel =
    n/(n+prior);

  const target =
    base*(1-rel) +
    clamp(
      r,
      1,
      9
    )*rel;

  return (
    base +
    (target-base)*power
  );
}

function addVsStarter(
  g,p,
  prior,
  power
) {
  return {
    ...p,

    away:
      matchupOne(
        p.away,
        g.vsStarter
          ?.awayVsHomeStarter,
        prior,
        power
      ),

    home:
      matchupOne(
        p.home,
        g.vsStarter
          ?.homeVsAwayStarter,
        prior,
        power
      )
  };
}

/*
  ============================================================
  Challenger factory

  중요:
  champion을 먼저 완성하고
  feature 하나만 추가한다.

  즉 이번 Round 2는
  "feature incremental value" 테스트.
  ============================================================
*/

function challenger(
  featureFn
) {
  return g => {
    const base =
      champion(g);

    if (!base)
      return null;

    const p =
      featureFn(
        g,
        {
          ...base
        }
      );

    return finish(p);
  };
}

/*
  ============================================================
  Champion 재현
  ============================================================
*/

const champ =
  score(champion);

console.log(
  "===== V0.6 ROUND 2 / CHAMPION REPRODUCTION ====="
);

console.log(
  "FINAL HOLDOUT: LOCKED"
);

console.log();

console.log(
  JSON.stringify(
    champ,
    null,
    2
  )
);

console.log();

console.log(
  "OLD V03 REFERENCE AVG TEAM MAE:",
  2.5209403214
);

console.log(
  "REPRO DELTA:",
  champ.avgTeamMAE -
    2.5209403214
);

/*
  ============================================================
  Candidate 생성
  ============================================================
*/

const candidates = [];

/*
  Recent
*/

for (const window of [
  5,
  10,
  20
]) {
  for (const weight of [
    0.025,
    0.05,
    0.075,
    0.10,
    0.15,
    0.20
  ]) {
    candidates.push({
      family:
        `RECENT${window}`,

      config: {
        weight
      },

      predictor:
        challenger(
          (g,p) =>
            addBlendFeature(
              p,
              recentExpectation(
                g,
                window
              ),
              weight
            )
        )
    });
  }
}

/*
  Venue
*/

for (const weight of [
  0.025,
  0.05,
  0.075,
  0.10,
  0.15,
  0.20
]) {
  candidates.push({
    family:
      "VENUE",

    config: {
      weight
    },

    predictor:
      challenger(
        (g,p) =>
          addBlendFeature(
            p,
            venueExpectation(g),
            weight
          )
      )
  });
}

/*
  WHIP
*/

for (const coef of [
  -0.50,
  -0.25,
  0.10,
  0.20,
  0.30,
  0.40,
  0.50,
  0.75
]) {
  candidates.push({
    family:
      "STARTER_WHIP",

    config: {
      coef
    },

    predictor:
      challenger(
        (g,p) =>
          addWhip(
            g,p,coef
          )
      )
  });
}

/*
  Starter AVG
*/

for (const coef of [
  -2,
  -1,
  1,
  2,
  3,
  4,
  5
]) {
  candidates.push({
    family:
      "STARTER_AVG",

    config: {
      coef
    },

    predictor:
      challenger(
        (g,p) =>
          addStarterAvg(
            g,p,coef
          )
      )
  });
}

/*
  K/BB control
*/

for (const coef of [
  -0.20,
  -0.10,
  0.05,
  0.10,
  0.20,
  0.30
]) {
  candidates.push({
    family:
      "STARTER_CONTROL",

    config: {
      coef
    },

    predictor:
      challenger(
        (g,p) =>
          addControl(
            g,p,coef
          )
      )
  });
}

/*
  Lineup OPS
*/

for (const coef of [
  -1.00,
  -0.50,
  0.25,
  0.50,
  0.75,
  1.00,
  1.50,
  2.00
]) {
  candidates.push({
    family:
      "LINEUP_OPS",

    config: {
      coef
    },

    predictor:
      challenger(
        (g,p) =>
          addLineupOps(
            g,p,coef
          )
      )
  });
}

/*
  Lineup OBP
*/

for (const coef of [
  -2,
  -1,
  0.5,
  1,
  2,
  3
]) {
  candidates.push({
    family:
      "LINEUP_OBP",

    config: {
      coef
    },

    predictor:
      challenger(
        (g,p) =>
          addLineupObp(
            g,p,coef
          )
      )
  });
}

/*
  Lineup SLG
*/

for (const coef of [
  -2,
  -1,
  0.5,
  1,
  2,
  3
]) {
  candidates.push({
    family:
      "LINEUP_SLG",

    config: {
      coef
    },

    predictor:
      challenger(
        (g,p) =>
          addLineupSlg(
            g,p,coef
          )
      )
  });
}

/*
  VS STARTER
*/

for (const prior of [
  1,
  2,
  3,
  5,
  8
]) {
  for (const power of [
    0.10,
    0.20,
    0.30,
    0.50
  ]) {
    candidates.push({
      family:
        "VS_STARTER",

      config: {
        prior,
        power
      },

      predictor:
        challenger(
          (g,p) =>
            addVsStarter(
              g,p,
              prior,
              power
            )
        )
    });
  }
}

/*
  ============================================================
  평가
  ============================================================
*/

const tested = [];

for (const c of candidates) {
  const s =
    score(
      c.predictor
    );

  tested.push({
    family:
      c.family,

    config:
      c.config,

    ...s,

    delta:
      s.avgTeamMAE -
      champ.avgTeamMAE,

    discoveryDelta:
      s.discovery.teamMAE -
      champ.discovery.teamMAE,

    internalDelta:
      s.internal.teamMAE -
      champ.internal.teamMAE
  });
}

tested.sort(
  (a,b) =>
    a.avgTeamMAE -
      b.avgTeamMAE ||
    a.avgDiffMAE -
      b.avgDiffMAE
);

/*
  ============================================================
  family별 best
  ============================================================
*/

const families =
  [...new Set(
    tested.map(x => x.family)
  )];

const familyBest = [];

for (const family of families) {
  const xs =
    tested.filter(
      x => x.family === family
    );

  xs.sort(
    (a,b) =>
      a.avgTeamMAE -
        b.avgTeamMAE ||
      a.avgDiffMAE -
        b.avgDiffMAE
  );

  familyBest.push(
    xs[0]
  );
}

familyBest.sort(
  (a,b) =>
    a.avgTeamMAE -
      b.avgTeamMAE
);

function f(v) {
  return v === null
    ? "-"
    : Number(v).toFixed(6);
}

function pct(v) {
  return v === null
    ? "-"
    : (
        v*100
      ).toFixed(1)+"%";
}

console.log();
console.log(
  "===== FAMILY BEST ====="
);

for (const x of familyBest) {
  const robust =
    x.discoveryDelta < 0 &&
    x.internalDelta < 0;

  console.log();

  console.log(
    robust
      ? "ROBUST"
      : x.delta < 0
        ? "AVG+"
        : "DROP",
    x.family,
    JSON.stringify(
      x.config
    )
  );

  console.log(
    " D",
    "n="+x.discovery.n,
    "team="+f(
      x.discovery.teamMAE
    ),
    "delta="+f(
      x.discoveryDelta
    ),
    "total="+f(
      x.discovery.totalMAE
    ),
    "diff="+f(
      x.discovery.diffMAE
    ),
    "W="+pct(
      x.discovery.winnerAcc
    )
  );

  console.log(
    " I",
    "n="+x.internal.n,
    "team="+f(
      x.internal.teamMAE
    ),
    "delta="+f(
      x.internalDelta
    ),
    "total="+f(
      x.internal.totalMAE
    ),
    "diff="+f(
      x.internal.diffMAE
    ),
    "W="+pct(
      x.internal.winnerAcc
    )
  );

  console.log(
    " AVG TEAM:",
    f(
      x.avgTeamMAE
    ),
    "DELTA:",
    f(
      x.delta
    )
  );
}

/*
  ============================================================
  Top 20
  ============================================================
*/

console.log();
console.log(
  "===== TOP 20 CHALLENGERS ====="
);

for (
  const x of tested.slice(0,20)
) {
  console.log(
    x.family,
    JSON.stringify(
      x.config
    ),
    "AVG="+f(
      x.avgTeamMAE
    ),
    "Δ="+f(
      x.delta
    ),
    "DΔ="+f(
      x.discoveryDelta
    ),
    "IΔ="+f(
      x.internalDelta
    )
  );
}

/*
  ============================================================
  엄격한 후보

  Discovery/Internal 둘 다 개선한 것만.
  ============================================================
*/

const robust =
  tested.filter(
    x =>
      x.delta < 0 &&
      x.discoveryDelta < 0 &&
      x.internalDelta < 0
  );

robust.sort(
  (a,b) =>
    a.avgTeamMAE -
      b.avgTeamMAE
);

console.log();
console.log(
  "===== ROBUST BOTH-SPLIT IMPROVERS ====="
);

if (!robust.length) {
  console.log(
    "NONE"
  );
} else {
  for (
    const x of robust.slice(0,20)
  ) {
    console.log(
      x.family,
      JSON.stringify(
        x.config
      ),
      "AVG="+f(
        x.avgTeamMAE
      ),
      "Δ="+f(
        x.delta
      ),
      "DΔ="+f(
        x.discoveryDelta
      ),
      "IΔ="+f(
        x.internalDelta
      )
    );
  }
}

/*
  ============================================================
  저장
  ============================================================
*/

const result = {
  generatedAt:
    new Date().toISOString(),

  methodology: {
    final:
      "LOCKED / NOT EVALUATED",

    primary:
      "per-team score MAE",

    rule:
      "Each feature family is tested incrementally on top of the reproduced V0.3 champion."
  },

  oldReference: {
    avgTeamMAE:
      2.5209403214
  },

  championReproduction:
    champ,

  reproductionDelta:
    champ.avgTeamMAE -
    2.5209403214,

  familyBest,

  robustBothSplit:
    robust.slice(0,50),

  top20:
    tested.slice(0,20),

  finalOpened:
    false
};

fs.writeFileSync(
  OUT,
  JSON.stringify(
    result,
    null,
    2
  )
);

console.log();
console.log(
  "OUTPUT:",
  OUT
);

console.log(
  "FINAL OPENED:",
  false
);

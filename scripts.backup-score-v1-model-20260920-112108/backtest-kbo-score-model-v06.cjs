const fs = require("fs");

const INPUT =
  "data/kbo-score-features-v06.json";

const OUT =
  "data/kbo-score-model-v06-round1.json";

const raw =
  JSON.parse(
    fs.readFileSync(INPUT, "utf8")
  );

const games =
  (raw.games || []).filter(
    g =>
      g?.target &&
      Number.isFinite(Number(g.target.awayScore)) &&
      Number.isFinite(Number(g.target.homeScore))
  );

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function mean(xs) {
  const a = xs.filter(Number.isFinite);
  if (!a.length) return null;

  return (
    a.reduce((s,x) => s+x,0) /
    a.length
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
  평가

  FINAL은 절대 호출하지 않는다.
  ============================================================
*/

function evaluate(predictor, split) {
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
    if (splitOf(g.date) !== split)
      continue;

    const p = predictor(g);

    if (
      !p ||
      !Number.isFinite(p.away) ||
      !Number.isFinite(p.home)
    ) {
      continue;
    }

    const a =
      Number(g.target.awayScore);

    const h =
      Number(g.target.homeScore);

    const actualTotal = a + h;
    const actualDiff = a - h;

    const predTotal =
      p.away + p.home;

    const predDiff =
      p.away - p.home;

    const aeAway =
      Math.abs(p.away - a);

    const aeHome =
      Math.abs(p.home - h);

    teamAbs +=
      (aeAway + aeHome) / 2;

    totalAbs +=
      Math.abs(predTotal - actualTotal);

    diffAbs +=
      Math.abs(predDiff - actualDiff);

    awayBias += p.away - a;
    homeBias += p.home - h;

    if (
      aeAway <= 1 &&
      aeHome <= 1
    ) {
      within1++;
    }

    if (
      aeAway <= 2 &&
      aeHome <= 2
    ) {
      within2++;
    }

    if (actualDiff !== 0) {
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
      n ? teamAbs/n : null,

    totalMAE:
      n ? totalAbs/n : null,

    diffMAE:
      n ? diffAbs/n : null,

    within1:
      n ? within1/n : null,

    within2:
      n ? within2/n : null,

    winnerAcc:
      winnerN
        ? winnerHit/winnerN
        : null,

    awayBias:
      n ? awayBias/n : null,

    homeBias:
      n ? homeBias/n : null
  };
}

/*
  ============================================================
  기본 팀 기대득점

  V0.6 데이터셋의 D-1 season 평균 사용.

  기존 V0.3 구조와 최대한 비슷하게:
    league 60%
    team/opponent expectation 40%

  Round 1에서는 이 값을 고정.
  ============================================================
*/

function baseTeam(g) {
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

  const awayTeam =
    (ar + hra) / 2;

  const homeTeam =
    (hr + ara) / 2;

  return {
    away:
      league * 0.60 +
      awayTeam * 0.40,

    home:
      league * 0.60 +
      homeTeam * 0.40,

    league
  };
}

/*
  ============================================================
  시장 margin 보정

  V0.3 최고 후보:
    FORM = 0
    MARKET RUNS = 4.5

  총점은 보존.
  ============================================================
*/

function marketMargin(g, p) {
  const awayProb =
    num(g.market?.awayNoVig);

  if (awayProb === null)
    return p;

  const edge =
    (awayProb - 0.50) * 2;

  const shift =
    edge * 4.50;

  return {
    ...p,

    away:
      p.away + shift/2,

    home:
      p.home - shift/2
  };
}

/*
  ============================================================
  최근 팀 득실점

  season expectation과 recent expectation을 혼합.

  Round 1에서는 작은 고정값만 사용.
  ============================================================
*/

function addRecent(
  g,
  p,
  window,
  weight
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
    return p;
  }

  const ar =
    num(a.avgRuns);

  const ara =
    num(a.avgRunsAllowed);

  const hr =
    num(h.avgRuns);

  const hra =
    num(h.avgRunsAllowed);

  if (
    ar === null ||
    ara === null ||
    hr === null ||
    hra === null
  ) {
    return p;
  }

  const awayRecent =
    (ar + hra) / 2;

  const homeRecent =
    (hr + ara) / 2;

  return {
    ...p,

    away:
      p.away*(1-weight) +
      awayRecent*weight,

    home:
      p.home*(1-weight) +
      homeRecent*weight
  };
}

/*
  ============================================================
  홈/원정 split

  원정팀 = away split
  홈팀 = home split

  상대의 반대 split 실점도 함께 사용.
  ============================================================
*/

function addVenueSplit(
  g,
  p,
  weight = 0.15
) {
  const af = g.awayTeamForm;
  const hf = g.homeTeamForm;

  if (
    !af ||
    !hf ||
    af.awayGames < 5 ||
    hf.homeGames < 5
  ) {
    return p;
  }

  const ar =
    num(af.awayAvgRuns);

  const ara =
    num(af.awayAvgRunsAllowed);

  const hr =
    num(hf.homeAvgRuns);

  const hra =
    num(hf.homeAvgRunsAllowed);

  if (
    ar === null ||
    ara === null ||
    hr === null ||
    hra === null
  ) {
    return p;
  }

  const awayVenue =
    (ar + hra) / 2;

  const homeVenue =
    (hr + ara) / 2;

  return {
    ...p,

    away:
      p.away*(1-weight) +
      awayVenue*weight,

    home:
      p.home*(1-weight) +
      homeVenue*weight
  };
}

/*
  ============================================================
  선발

  상대 선발의:
    ERA
    WHIP
    최근5 ERA
    최근10 ERA

  를 리그 중립점 대비 득점 shift로 변환.

  아직 grid tuning 하지 않는다.
  ============================================================
*/

function starterEraBlend(s) {
  if (!s) return null;

  const season =
    num(s.era);

  const r5 =
    num(s.recent5?.era);

  const r10 =
    num(s.recent10?.era);

  const values = [];

  if (season !== null)
    values.push({
      v: season,
      w: 0.45
    });

  if (r10 !== null)
    values.push({
      v: r10,
      w: 0.30
    });

  if (r5 !== null)
    values.push({
      v: r5,
      w: 0.25
    });

  if (!values.length)
    return null;

  const sw =
    values.reduce(
      (s,x) => s+x.w,
      0
    );

  return (
    values.reduce(
      (s,x) => s+x.v*x.w,
      0
    ) / sw
  );
}

function addStarter(g,p) {
  const league =
    num(
      g.environment
        ?.leagueRunsPerTeamD1
    );

  if (league === null)
    return p;

  const awayStarter =
    g.starter?.away;

  const homeStarter =
    g.starter?.home;

  const awayEra =
    starterEraBlend(
      awayStarter
    );

  const homeEra =
    starterEraBlend(
      homeStarter
    );

  const awayWhip =
    num(awayStarter?.whip);

  const homeWhip =
    num(homeStarter?.whip);

  let awayShift = 0;
  let homeShift = 0;

  /*
    상대 선발이 나쁘면 공격팀 예상득점 증가.
  */

  if (homeEra !== null) {
    awayShift +=
      clamp(
        (homeEra-league)*0.09,
        -0.45,
        0.45
      );
  }

  if (awayEra !== null) {
    homeShift +=
      clamp(
        (awayEra-league)*0.09,
        -0.45,
        0.45
      );
  }

  /*
    WHIP 중립점은 1.40 근처로 두되
    영향은 작게 시작.
  */

  if (homeWhip !== null) {
    awayShift +=
      clamp(
        (homeWhip-1.40)*0.35,
        -0.20,
        0.20
      );
  }

  if (awayWhip !== null) {
    homeShift +=
      clamp(
        (awayWhip-1.40)*0.35,
        -0.20,
        0.20
      );
  }

  return {
    ...p,
    away: p.away + awayShift,
    home: p.home + homeShift
  };
}

/*
  ============================================================
  불펜 피로
  ============================================================
*/

function addBullpen(g,p) {
  const awayFatigue =
    num(
      g.bullpen?.awayFatigue
    );

  const homeFatigue =
    num(
      g.bullpen?.homeFatigue
    );

  let awayShift = 0;
  let homeShift = 0;

  if (homeFatigue !== null) {
    awayShift +=
      clamp(
        (homeFatigue-50)*0.004,
        -0.18,
        0.18
      );
  }

  if (awayFatigue !== null) {
    homeShift +=
      clamp(
        (awayFatigue-50)*0.004,
        -0.18,
        0.18
      );
  }

  return {
    ...p,
    away: p.away + awayShift,
    home: p.home + homeShift
  };
}

/*
  ============================================================
  라인업

  OPS + OBP + SLG.
  리그 기준은 일단 보수적으로 고정.
  ============================================================
*/

function lineupStrength(x) {
  if (!x) return null;

  const ops = num(x.avgOps);
  const obp = num(x.avgObp);
  const slg = num(x.avgSlg);

  const signals = [];

  if (ops !== null)
    signals.push(
      (ops-0.750) * 1.00
    );

  if (obp !== null)
    signals.push(
      (obp-0.330) * 0.70
    );

  if (slg !== null)
    signals.push(
      (slg-0.420) * 0.70
    );

  return mean(signals);
}

function addLineup(g,p) {
  const a =
    lineupStrength(
      g.lineup?.away
    );

  const h =
    lineupStrength(
      g.lineup?.home
    );

  return {
    ...p,

    away:
      p.away +
      (
        a === null
          ? 0
          : clamp(
              a,
              -0.25,
              0.25
            )
      ),

    home:
      p.home +
      (
        h === null
          ? 0
          : clamp(
              h,
              -0.25,
              0.25
            )
      )
  };
}

/*
  ============================================================
  팀 vs 상대 선발

  small sample shrinkage.
  ============================================================
*/

function matchupAdjusted(
  base,
  x
) {
  const n =
    num(x?.games);

  const avgRuns =
    num(x?.avgRuns);

  if (
    n === null ||
    n < 1 ||
    avgRuns === null
  ) {
    return base;
  }

  const reliability =
    n / (n + 3);

  const target =
    clamp(
      avgRuns,
      1.0,
      9.0
    );

  /*
    V0.5 best의 power 0.5 구조.
  */
  return (
    base +
    (
      (
        base*(1-reliability) +
        target*reliability
      ) -
      base
    ) * 0.50
  );
}

function addVsStarter(g,p) {
  return {
    ...p,

    away:
      matchupAdjusted(
        p.away,
        g.vsStarter
          ?.awayVsHomeStarter
      ),

    home:
      matchupAdjusted(
        p.home,
        g.vsStarter
          ?.homeVsAwayStarter
      )
  };
}

/*
  ============================================================
  휴식일

  큰 가정을 하지 않는다.
  연전/장기휴식만 아주 작게 반영.
  ============================================================
*/

function restShift(rest) {
  const r = num(rest);

  if (r === null)
    return 0;

  if (r === 0)
    return -0.04;

  if (r >= 3)
    return 0.04;

  return 0;
}

function addRest(g,p) {
  return {
    ...p,

    away:
      p.away +
      restShift(
        g.awayTeamForm
          ?.restDays
      ),

    home:
      p.home +
      restShift(
        g.homeTeamForm
          ?.restDays
      )
  };
}

/*
  ============================================================
  공통 clamp
  ============================================================
*/

function finish(p) {
  if (!p) return null;

  return {
    away:
      clamp(p.away,1.50,8.50),

    home:
      clamp(p.home,1.50,8.50)
  };
}

/*
  ============================================================
  모델 단계
  ============================================================
*/

const stages = [
  {
    name:
      "S0 BASE",

    apply(g) {
      return finish(
        baseTeam(g)
      );
    }
  },

  {
    name:
      "S1 + MARKET M4.5",

    apply(g) {
      let p = baseTeam(g);
      if (!p) return null;

      p = marketMargin(g,p);

      return finish(p);
    }
  },

  {
    name:
      "S2 + RECENT5",

    apply(g) {
      let p = baseTeam(g);
      if (!p) return null;

      p = addRecent(
        g,p,5,0.15
      );

      p = marketMargin(g,p);

      return finish(p);
    }
  },

  {
    name:
      "S3 + RECENT10",

    apply(g) {
      let p = baseTeam(g);
      if (!p) return null;

      p = addRecent(
        g,p,10,0.15
      );

      p = marketMargin(g,p);

      return finish(p);
    }
  },

  {
    name:
      "S4 + RECENT20",

    apply(g) {
      let p = baseTeam(g);
      if (!p) return null;

      p = addRecent(
        g,p,20,0.15
      );

      p = marketMargin(g,p);

      return finish(p);
    }
  },

  {
    name:
      "S5 + VENUE",

    apply(g) {
      let p = baseTeam(g);
      if (!p) return null;

      p = addVenueSplit(
        g,p,0.15
      );

      p = marketMargin(g,p);

      return finish(p);
    }
  },

  {
    name:
      "S6 + STARTER",

    apply(g) {
      let p = baseTeam(g);
      if (!p) return null;

      p = addStarter(g,p);
      p = marketMargin(g,p);

      return finish(p);
    }
  },

  {
    name:
      "S7 + BULLPEN",

    apply(g) {
      let p = baseTeam(g);
      if (!p) return null;

      p = addBullpen(g,p);
      p = marketMargin(g,p);

      return finish(p);
    }
  },

  {
    name:
      "S8 + LINEUP",

    apply(g) {
      let p = baseTeam(g);
      if (!p) return null;

      p = addLineup(g,p);
      p = marketMargin(g,p);

      return finish(p);
    }
  },

  {
    name:
      "S9 + VS STARTER",

    apply(g) {
      let p = baseTeam(g);
      if (!p) return null;

      p = addVsStarter(g,p);
      p = marketMargin(g,p);

      return finish(p);
    }
  },

  {
    name:
      "S10 + REST",

    apply(g) {
      let p = baseTeam(g);
      if (!p) return null;

      p = addRest(g,p);
      p = marketMargin(g,p);

      return finish(p);
    }
  }
];

/*
  ============================================================
  개별 feature family 비교
  ============================================================
*/

const results = [];

for (const stage of stages) {
  const d =
    evaluate(
      stage.apply,
      "DISCOVERY"
    );

  const i =
    evaluate(
      stage.apply,
      "INTERNAL"
    );

  const avgTeamMAE =
    (
      d.teamMAE +
      i.teamMAE
    ) / 2;

  const avgTotalMAE =
    (
      d.totalMAE +
      i.totalMAE
    ) / 2;

  const avgDiffMAE =
    (
      d.diffMAE +
      i.diffMAE
    ) / 2;

  results.push({
    name: stage.name,
    discovery: d,
    internal: i,
    avgTeamMAE,
    avgTotalMAE,
    avgDiffMAE
  });
}

results.sort(
  (a,b) =>
    a.avgTeamMAE -
      b.avgTeamMAE ||
    a.avgDiffMAE -
      b.avgDiffMAE
);

function pct(v) {
  return v === null
    ? "-"
    : (v*100).toFixed(1)+"%";
}

function f(v) {
  return v === null
    ? "-"
    : v.toFixed(4);
}

console.log(
  "===== V0.6 ROUND 1 / INDIVIDUAL FEATURE ABLATION ====="
);

console.log(
  "FINAL HOLDOUT: LOCKED"
);

console.log();

for (const r of results) {
  console.log(
    r.name
  );

  console.log(
    " D",
    "n="+r.discovery.n,
    "team="+f(r.discovery.teamMAE),
    "total="+f(r.discovery.totalMAE),
    "diff="+f(r.discovery.diffMAE),
    "±1="+pct(r.discovery.within1),
    "±2="+pct(r.discovery.within2),
    "W="+pct(r.discovery.winnerAcc),
    "biasA="+f(r.discovery.awayBias),
    "biasH="+f(r.discovery.homeBias)
  );

  console.log(
    " I",
    "n="+r.internal.n,
    "team="+f(r.internal.teamMAE),
    "total="+f(r.internal.totalMAE),
    "diff="+f(r.internal.diffMAE),
    "±1="+pct(r.internal.within1),
    "±2="+pct(r.internal.within2),
    "W="+pct(r.internal.winnerAcc),
    "biasA="+f(r.internal.awayBias),
    "biasH="+f(r.internal.homeBias)
  );

  console.log(
    " AVG",
    "team="+f(r.avgTeamMAE),
    "total="+f(r.avgTotalMAE),
    "diff="+f(r.avgDiffMAE)
  );

  console.log();
}

/*
  ============================================================
  greedy 조합

  개별 성능이 좋은 family부터 하나씩 추가하되,
  실제로 avg team MAE가 좋아질 때만 유지.

  MARKET은 기존 검증값이므로 항상 포함.
  ============================================================
*/

const featureFns = {
  RECENT5:
    (g,p) =>
      addRecent(g,p,5,0.15),

  RECENT10:
    (g,p) =>
      addRecent(g,p,10,0.15),

  RECENT20:
    (g,p) =>
      addRecent(g,p,20,0.15),

  VENUE:
    (g,p) =>
      addVenueSplit(g,p,0.15),

  STARTER:
    (g,p) =>
      addStarter(g,p),

  BULLPEN:
    (g,p) =>
      addBullpen(g,p),

  LINEUP:
    (g,p) =>
      addLineup(g,p),

  VS_STARTER:
    (g,p) =>
      addVsStarter(g,p),

  REST:
    (g,p) =>
      addRest(g,p)
};

const individualOrder =
  results
    .filter(
      r =>
        !r.name.startsWith("S0") &&
        !r.name.startsWith("S1")
    )
    .map(r =>
      r.name
        .replace(/^S\d+\s+\+\s+/,"")
        .trim()
    );

function makeCombo(names) {
  return g => {
    let p = baseTeam(g);

    if (!p)
      return null;

    for (const name of names) {
      const fn =
        featureFns[name];

      if (fn)
        p = fn(g,p);
    }

    p = marketMargin(g,p);

    return finish(p);
  };
}

function scoreModel(predictor) {
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
    d,
    i,

    team:
      (
        d.teamMAE +
        i.teamMAE
      ) / 2,

    total:
      (
        d.totalMAE +
        i.totalMAE
      ) / 2,

    diff:
      (
        d.diffMAE +
        i.diffMAE
      ) / 2
  };
}

let selected = [];

let current =
  scoreModel(
    makeCombo([])
  );

const greedyLog = [];

for (const candidate of individualOrder) {
  if (
    selected.includes(candidate)
  ) {
    continue;
  }

  const trialNames =
    [...selected,candidate];

  const trial =
    scoreModel(
      makeCombo(trialNames)
    );

  const improved =
    trial.team <
    current.team - 0.000001;

  greedyLog.push({
    candidate,
    before: current.team,
    after: trial.team,
    improved
  });

  if (improved) {
    selected = trialNames;
    current = trial;
  }
}

console.log(
  "===== V0.6 GREEDY FEATURE SELECTION ====="
);

for (const x of greedyLog) {
  console.log(
    x.improved
      ? "KEEP"
      : "DROP",
    x.candidate,
    f(x.before),
    "->",
    f(x.after)
  );
}

console.log();

console.log(
  "SELECTED:",
  selected.length
    ? selected.join(" + ")
    : "MARKET ONLY"
);

console.log();

console.log(
  "GREEDY DISCOVERY:",
  JSON.stringify(
    current.d,
    null,
    2
  )
);

console.log(
  "GREEDY INTERNAL:",
  JSON.stringify(
    current.i,
    null,
    2
  )
);

console.log(
  "GREEDY AVG TEAM MAE:",
  current.team
);

console.log(
  "GREEDY AVG TOTAL MAE:",
  current.total
);

console.log(
  "GREEDY AVG DIFF MAE:",
  current.diff
);

/*
  기존 최고 benchmark.
*/
const benchmark = {
  name:
    "V0.3 F0 M4.5",

  avgTeamMAE:
    2.5209403214
};

console.log();

console.log(
  "===== BENCHMARK ====="
);

console.log(
  JSON.stringify(
    benchmark,
    null,
    2
  )
);

console.log();

console.log(
  "V06 VS BENCHMARK TEAM MAE:",
  current.team -
    benchmark.avgTeamMAE
);

const result = {
  generatedAt:
    new Date().toISOString(),

  methodology: {
    discovery:
      "<= 2026-04-30",

    internal:
      "2026-05-01 ~ 2026-06-30",

    final:
      "LOCKED / NOT EVALUATED",

    primaryMetric:
      "Average per-team score MAE"
  },

  benchmark,

  individualResults:
    results,

  greedy: {
    selected,
    log: greedyLog,

    discovery:
      current.d,

    internal:
      current.i,

    avgTeamMAE:
      current.team,

    avgTotalMAE:
      current.total,

    avgDiffMAE:
      current.diff,

    deltaVsBenchmark:
      current.team -
      benchmark.avgTeamMAE
  }
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

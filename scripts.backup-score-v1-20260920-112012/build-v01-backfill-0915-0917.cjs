const fs =
  require("fs");

const ts =
  require("typescript");

const vm =
  require("vm");

const path =
  require("path");


const TARGET_DATES = [
  "2026-09-15",
  "2026-09-16",
  "2026-09-17",
];


const statsFile =
  path.join(
    process.cwd(),
    "data",
    "kbo-engine-stats-v0.1-backtest.json"
  );


const oddsFile =
  path.join(
    process.cwd(),
    "data",
    "kbo-odds-history.json"
  );


/*
  analyzer.ts 자체를 현재 서버 소스 그대로 transpile해서
  analyzeGame을 사용한다.

  즉 별도 복제 모델이 아니라
  현재 analyzer 함수 자체를 호출한다.

  다만 당시 starter/form/bullpen/lineup 전체 feature snapshot이
  보존되지 않은 날짜가 있으므로 optional edge는 0으로 복원한다.
*/
function loadAnalyzer() {
  const file =
    path.join(
      process.cwd(),
      "src",
      "lib",
      "analyzer.ts"
    );

  const source =
    fs.readFileSync(
      file,
      "utf8"
    );

  const js =
    ts.transpileModule(
      source,
      {
        compilerOptions: {
          module:
            ts.ModuleKind.CommonJS,

          target:
            ts.ScriptTarget.ES2022,

          esModuleInterop:
            true,
        },
      }
    ).outputText;

  const module = {
    exports: {},
  };

  const sandbox = {
    module,
    exports:
      module.exports,

    require,
    console,
    process,
    __dirname:
      path.dirname(file),
    __filename:
      file,
  };

  vm.runInNewContext(
    js,
    sandbox,
    {
      filename:
        "analyzer.backfill.cjs",
    }
  );

  return module.exports;
}


function normalizeOddsRows(
  raw
) {
  if (
    Array.isArray(raw)
  ) {
    return raw;
  }

  return (
    raw?.items ||
    raw?.history ||
    raw?.snapshots ||
    raw?.records ||
    []
  );
}


function latestSnapshots(
  rows,
  date
) {
  const map =
    new Map();

  for (
    const row of rows
  ) {
    if (
      row?.date !==
      date ||
      !row?.gameId
    ) {
      continue;
    }

    const previous =
      map.get(
        row.gameId
      );

    if (
      !previous ||
      String(
        row.capturedAt || ""
      ) >
      String(
        previous.capturedAt || ""
      )
    ) {
      map.set(
        row.gameId,
        row
      );
    }
  }

  return map;
}


function toOdds(
  row
) {
  return {
    awayMl:
      finite(row?.awayMl),

    homeMl:
      finite(row?.homeMl),

    awayHandicap:
      finite(
        row?.awayHandicap
      ),

    homeHandicap:
      finite(
        row?.homeHandicap
      ),

    awayHandicapLine:
      finite(
        row?.awayHandicapLine
      ),

    homeHandicapLine:
      finite(
        row?.homeHandicapLine
      ),

    totalLine:
      finite(
        row?.totalLine
      ),

    overOdds:
      finite(
        row?.overOdds
      ),

    underOdds:
      finite(
        row?.underOdds
      ),
  };
}


function finite(
  value
) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function gameList(
  json
) {
  if (
    Array.isArray(json)
  ) {
    return json;
  }

  if (
    Array.isArray(
      json?.games
    )
  ) {
    return json.games;
  }

  if (
    Array.isArray(
      json?.data
    )
  ) {
    return json.data;
  }

  return [];
}


function settlePick(
  pick,
  game,
  odds
) {
  if (
    !game ||
    String(
      game?.status?.stateCode
    ) !== "3"
  ) {
    return "PENDING";
  }

  const away =
    Number(
      game?.score?.away
    );

  const home =
    Number(
      game?.score?.home
    );

  if (
    !Number.isFinite(away) ||
    !Number.isFinite(home)
  ) {
    return "PENDING";
  }

  if (
    pick.market ===
    "ML"
  ) {
    const awayChosen =
      String(pick.label)
        .startsWith(
          String(
            game.awayTeamName
          )
        );

    if (
      away === home
    ) {
      return "PUSH";
    }

    const awayWon =
      away > home;

    return awayChosen ===
      awayWon
      ? "WIN"
      : "LOSS";
  }


  if (
    pick.market ===
    "HANDICAP"
  ) {
    const awayChosen =
      String(pick.label)
        .startsWith(
          String(
            game.awayTeamName
          )
        );

    const match =
      String(
        pick.label
      ).match(
        /([+-]\d+(?:\.\d+)?)\s*$/
      );

    let line =
      match
        ? Number(
            match[1]
          )
        : null;

    if (
      !Number.isFinite(line)
    ) {
      line =
        awayChosen
          ? odds
              .awayHandicapLine
          : odds
              .homeHandicapLine;
    }

    if (
      !Number.isFinite(line)
    ) {
      return "VOID";
    }

    const chosenScore =
      awayChosen
        ? away
        : home;

    const opponentScore =
      awayChosen
        ? home
        : away;

    const adjusted =
      chosenScore +
      line;

    if (
      adjusted ===
      opponentScore
    ) {
      return "PUSH";
    }

    return adjusted >
      opponentScore
      ? "WIN"
      : "LOSS";
  }


  if (
    pick.market ===
    "TOTAL"
  ) {
    const total =
      away + home;

    const lineMatch =
      String(
        pick.label
      ).match(
        /(\d+(?:\.\d+)?)\s*$/
      );

    const line =
      lineMatch
        ? Number(
            lineMatch[1]
          )
        : odds.totalLine;

    if (
      !Number.isFinite(line)
    ) {
      return "VOID";
    }

    if (
      total === line
    ) {
      return "PUSH";
    }

    const over =
      String(
        pick.label
      ).includes(
        "오버"
      );

    return (
      over
        ? total > line
        : total < line
    )
      ? "WIN"
      : "LOSS";
  }


  return "VOID";
}


function gradeValue(
  grade
) {
  if (
    grade === "A"
  ) {
    return 3;
  }

  if (
    grade === "B"
  ) {
    return 2;
  }

  return 1;
}


function comboMetrics(
  picks
) {
  const odds =
    picks.reduce(
      (
        value,
        pick
      ) =>
        value *
        Number(
          pick.odds
        ),
      1
    );

  const probability =
    picks.reduce(
      (
        value,
        pick
      ) =>
        value *
        Number(
          pick.confidence
        ),
      1
    );

  const averageConfidence =
    picks.reduce(
      (
        sum,
        pick
      ) =>
        sum +
        Number(
          pick.confidence
        ),
      0
    ) /
    picks.length;

  const evs =
    picks
      .map(
        pick =>
          pick.ev
      )
      .filter(
        value =>
          typeof value ===
            "number" &&
          Number.isFinite(
            value
          )
      );

  const averageEv =
    evs.length
      ? evs.reduce(
          (
            sum,
            value
          ) =>
            sum + value,
          0
        ) /
        evs.length
      : null;

  const averageGrade =
    picks.reduce(
      (
        sum,
        pick
      ) =>
        sum +
        gradeValue(
          pick.grade
        ),
      0
    ) /
    picks.length;

  const negativeEvCount =
    picks.filter(
      pick =>
        (
          pick.ev ??
          -1
        ) < 0
    ).length;

  return {
    odds,
    probability,
    averageConfidence,
    averageEv,
    averageGrade,
    negativeEvCount,
  };
}


function comboScore(
  metrics,
  mode
) {
  const averageEv =
    metrics.averageEv ??
    -0.20;

  if (
    mode === "SAFE"
  ) {
    return (
      metrics.probability *
        100 *
        0.68 +
      metrics.averageConfidence *
        100 *
        0.24 +
      averageEv *
        100 *
        0.05 +
      metrics.averageGrade *
        1.8 -
      metrics.negativeEvCount *
        1.5
    );
  }

  if (
    mode === "VALUE"
  ) {
    return (
      metrics.probability *
        100 *
        0.40 +
      metrics.averageConfidence *
        100 *
        0.18 +
      averageEv *
        100 *
        0.30 +
      Math.log(
        Math.max(
          1,
          metrics.odds
        )
      ) *
        6 +
      metrics.averageGrade *
        1.6 -
      metrics.negativeEvCount *
        2
    );
  }

  return (
    Math.log(
      Math.max(
        1,
        metrics.odds
      )
    ) *
      18 +
    metrics.probability *
      100 *
      0.28 +
    metrics.averageConfidence *
      100 *
      0.14 +
    averageEv *
      100 *
      0.20 +
    metrics.averageGrade *
      1.2 -
    metrics.negativeEvCount *
      2.5
  );
}


function settleCombo(
  picks
) {
  if (
    picks.some(
      pick =>
        pick.result ===
        "LOSS"
    )
  ) {
    return {
      result:
        "LOSS",

      effectiveOdds:
        0,
    };
  }

  if (
    picks.some(
      pick =>
        pick.result ===
        "PENDING"
    )
  ) {
    return {
      result:
        "PENDING",

      effectiveOdds:
        null,
    };
  }

  const active =
    picks.filter(
      pick =>
        pick.result !==
          "PUSH" &&
        pick.result !==
          "VOID"
    );

  if (
    active.length === 0
  ) {
    return {
      result:
        "VOID",

      effectiveOdds:
        1,
    };
  }

  return {
    result:
      "WIN",

    effectiveOdds:
      active.reduce(
        (
          total,
          pick
        ) =>
          total *
          Number(
            pick.odds
          ),
        1
      ),
  };
}


function bestCombo(
  candidates,
  mode
) {
  if (
    !candidates.length
  ) {
    return null;
  }

  let pool =
    candidates;

  if (
    mode ===
    "HIGH_ODDS"
  ) {
    const quality =
      candidates.filter(
        combo =>
          combo.metrics
            .averageConfidence >=
            0.52 &&
          (
            combo.metrics
              .averageEv ??
            -1
          ) >=
            -0.05
      );

    if (
      quality.length
    ) {
      pool =
        quality;
    }
  }

  let best =
    null;

  for (
    const combo of pool
  ) {
    const score =
      comboScore(
        combo.metrics,
        mode
      );

    if (
      !best ||
      score >
        best.score
    ) {
      best = {
        ...combo,
        score,
      };
    }
  }

  return best;
}


function generateCandidates(
  picks,
  leg
) {
  const out = [];
  const selected = [];

  const recurse = (
    start
  ) => {
    if (
      selected.length ===
      leg
    ) {
      const chosen =
        [...selected];

      out.push({
        picks:
          chosen,

        metrics:
          comboMetrics(
            chosen
          ),
      });

      return;
    }

    const needed =
      leg -
      selected.length;

    for (
      let i = start;
      i <=
        picks.length -
        needed;
      i += 1
    ) {
      const pick =
        picks[i];

      if (
        selected.some(
          current =>
            current.gameId ===
            pick.gameId
        )
      ) {
        continue;
      }

      selected.push(
        pick
      );

      recurse(
        i + 1
      );

      selected.pop();
    }
  };

  recurse(0);

  return out;
}


async function main() {
  const {
    analyzeGame,
  } =
    loadAnalyzer();

  if (
    typeof analyzeGame !==
    "function"
  ) {
    throw new Error(
      "analyzeGame load failed"
    );
  }


  const rawOdds =
    JSON.parse(
      fs.readFileSync(
        oddsFile,
        "utf8"
      )
    );

  const oddsRows =
    normalizeOddsRows(
      rawOdds
    );


  const allRecords = [];
  const comboRecords = [];


  for (
    const date of
    TARGET_DATES
  ) {
    const response =
      await fetch(
        `http://127.0.0.1:3200/api/kbo/today?date=${date}`,
        {
          cache:
            "no-store",
        }
      );

    if (
      !response.ok
    ) {
      throw new Error(
        `${date} KBO API ${response.status}`
      );
    }

    const json =
      await response.json();

    const games =
      gameList(
        json
      );

    const snapshots =
      latestSnapshots(
        oddsRows,
        date
      );

    const gameMap =
      new Map(
        games.map(
          game => [
            game.gameId,
            game,
          ]
        )
      );

    const oddsMap =
      new Map();

    const candidates = [];


    for (
      const game of games
    ) {
      const snapshot =
        snapshots.get(
          game.gameId
        );

      if (
        !snapshot
      ) {
        console.log(
          "NO ODDS",
          date,
          game.gameId
        );

        continue;
      }

      const odds =
        toOdds(
          snapshot
        );

      oddsMap.set(
        game.gameId,
        odds
      );

      /*
        optional historical features는
        보존되지 않은 날이 있으므로 0/null 복원.
      */
      const picks =
        analyzeGame(
          game,
          odds,
          0,
          0,
          0,
          0,
          null
        );


      for (
        const pick of picks
      ) {
        if (
          !Number.isFinite(
            Number(
              pick.confidence
            )
          ) ||
          !Number.isFinite(
            Number(
              pick.odds
            )
          ) ||
          Number(
            pick.odds
          ) <= 1
        ) {
          continue;
        }

        candidates.push({
          ...pick,

          date,

          awayTeam:
            game.awayTeamName,

          homeTeam:
            game.homeTeamName,

          result:
            settlePick(
              pick,
              game,
              odds
            ),
        });
      }
    }


    /*
      경기×시장 실제 방향:
      confidence 최고 1개
    */
    const selected =
      new Map();

    for (
      const pick of
      candidates
    ) {
      const key =
        `${pick.gameId}:${pick.market}`;

      const previous =
        selected.get(
          key
        );

      if (
        !previous ||
        Number(
          pick.confidence
        ) >
        Number(
          previous.confidence
        )
      ) {
        selected.set(
          key,
          pick
        );
      }
    }


    for (
      const pick of
      selected.values()
    ) {
      allRecords.push({
        source:
          "BACKFILL",

        date:
          pick.date,

        month:
          pick.date.slice(
            0,
            7
          ),

        gameId:
          pick.gameId,

        awayTeam:
          pick.awayTeam,

        homeTeam:
          pick.homeTeam,

        market:
          pick.market,

        label:
          pick.label,

        grade:
          pick.grade,

        confidence:
          pick.confidence,

        ev:
          pick.ev,

        odds:
          pick.odds,

        result:
          pick.result,
      });
    }


    const eligible =
      candidates.filter(
        pick =>
          Number(
            pick.confidence
          ) > 0 &&
          Number(
            pick.odds
          ) > 1
      );


    for (
      const leg of
      [
        2,
        3,
        4,
        5,
      ]
    ) {
      const comboCandidates =
        generateCandidates(
          eligible,
          leg
        );


      for (
        const mode of
        [
          "SAFE",
          "VALUE",
          "HIGH_ODDS",
        ]
      ) {
        const best =
          bestCombo(
            comboCandidates,
            mode
          );

        if (
          !best
        ) {
          continue;
        }


        const settled =
          settleCombo(
            best.picks
          );


        comboRecords.push({
          engineVersion:
            "v0.1",

          source:
            "BACKFILL",

          date,

          mode,

          leg,

          name:
            `AI ${
              mode === "SAFE"
                ? "안전형"
                : mode === "VALUE"
                  ? "가치형"
                  : "고배당형"
            } ${leg}폴`,

          odds:
            best.metrics.odds,

          probability:
            best.metrics
              .probability,

          averageConfidence:
            best.metrics
              .averageConfidence,

          averageEv:
            best.metrics
              .averageEv,

          result:
            settled.result,

          effectiveOdds:
            settled
              .effectiveOdds,

          picks:
            best.picks.map(
              pick => ({
                gameId:
                  pick.gameId,

                awayTeam:
                  pick.awayTeam,

                homeTeam:
                  pick.homeTeam,

                market:
                  pick.market,

                label:
                  pick.label,

                grade:
                  pick.grade,

                confidence:
                  pick.confidence,

                ev:
                  pick.ev,

                odds:
                  pick.odds,

                result:
                  pick.result,
              })
            ),
        });
      }
    }


    console.log(
      date,
      "GAMES=",
      games.length,
      "CANDIDATES=",
      candidates.length,
      "ALL=",
      [
        ...selected.values(),
      ].length,
      "AI=",
      comboRecords.filter(
        x =>
          x.date === date
      ).length
    );
  }


  const stats =
    JSON.parse(
      fs.readFileSync(
        statsFile,
        "utf8"
      )
    );


  stats.allPredictions =
    stats.allPredictions ||
    {};

  stats.aiCombos =
    stats.aiCombos ||
    {};


  const originalAll =
    Array.isArray(
      stats
        .allPredictions
        .records
    )
      ? stats
          .allPredictions
          .records
      : [];


  const originalCombos =
    Array.isArray(
      stats
        .aiCombos
        .records
    )
      ? stats
          .aiCombos
          .records
      : [];


  stats
    .allPredictions
    .records =
      originalAll
        .filter(
          row =>
            !(
              row?.source ===
                "BACKFILL" &&
              TARGET_DATES.includes(
                row?.date
              )
            )
        )
        .concat(
          allRecords
        );


  stats
    .aiCombos
    .records =
      originalCombos
        .filter(
          row =>
            !(
              row?.source ===
                "BACKFILL" &&
              TARGET_DATES.includes(
                row?.date
              )
            )
        )
        .concat(
          comboRecords
        );


  stats.period =
    stats.period ||
    {};

  stats.period.backfillStart =
    TARGET_DATES[0];

  stats.period.backfillEnd =
    TARGET_DATES[
      TARGET_DATES.length -
      1
    ];


  stats.backfill = {
    method:
      "RECONSTRUCTED_CURRENT_ANALYZER_ZERO_OPTIONAL_FEATURE_EDGES",

    dates:
      TARGET_DATES,

    allPredictionRecords:
      allRecords.length,

    aiComboRecords:
      comboRecords.length,

    note:
      "당시 전체 starter/form/bullpen/lineup feature snapshot이 완전하지 않아 저장 배당+경기결과+현재 analyzer 기본 edge로 복원",
  };


  fs.writeFileSync(
    statsFile,
    JSON.stringify(
      stats,
      null,
      2
    ),
    "utf8"
  );


  console.log("");
  console.log(
    "BACKFILL ALL:",
    allRecords.length
  );

  console.log(
    "BACKFILL AI:",
    comboRecords.length
  );


  for (
    const date of
    TARGET_DATES
  ) {
    console.log("");
    console.log(
      "====",
      date,
      "===="
    );

    console.log(
      "ALL",
      allRecords
        .filter(
          x =>
            x.date === date
        )
        .map(
          x => ({
            game:
              `${x.awayTeam}-${x.homeTeam}`,
            market:
              x.market,
            label:
              x.label,
            grade:
              x.grade,
            result:
              x.result
          })
        )
    );

    console.log(
      "AI",
      comboRecords
        .filter(
          x =>
            x.date === date
        )
        .map(
          x => ({
            mode:
              x.mode,
            leg:
              x.leg,
            result:
              x.result,
            picks:
              x.picks.map(
                p =>
                  `${p.label}:${p.result}`
              )
          })
        )
    );
  }
}


main()
  .catch(
    error => {
      console.error(
        error
      );

      process.exitCode =
        1;
    }
  );

import fs from "node:fs";
import path from "node:path";

import {
  analyzeGame,
} from "../src/lib/analyzer";

import type {
  KboGame,
  OddsInput,
  Pick,
} from "../src/types/kbo";

const BASE =
  "http://127.0.0.1:3200";

const HISTORY_FILE =
  path.join(
    process.cwd(),
    "data",
    "betman-kbo-history-2026.json"
  );

const OUTPUT_FILE =
  path.join(
    process.cwd(),
    "data",
    "kbo-backtest-all-candidates-2026.json"
  );

const STAKE = 10000;

type BetmanGame = {
  id: string;
  date: string;
  round: number;
  gmTs: number;

  homeTeam: string;
  awayTeam: string;

  actualScore:
    | {
        home: number;
        away: number;
      }
    | null;

  canceled?: boolean;

  moneyline:
    | {
        homeOdds: number | null;
        awayOdds: number | null;
      }
    | null;

  spread:
    | {
        homeLine: number | null;
        awayLine: number | null;
        homeOdds: number | null;
        awayOdds: number | null;
      }
    | null;

  total:
    | {
        line: number | null;
        overOdds: number | null;
        underOdds: number | null;
      }
    | null;
};

type TeamForm = {
  team: string;
  sampleSize: number;

  wins: number;
  losses: number;
  draws: number;

  winPct: number | null;

  avgRuns: number | null;
  avgRunsAllowed: number | null;

  runDifferential: number;
};

type BullpenData = {
  team: string;

  summary: {
    fatigueIndex: number;
  };
};

function normalizeTeam(
  name: string
) {
  const n =
    String(name || "")
      .replace(/\s+/g, "")
      .toUpperCase();

  if (n.includes("LG")) return "LG";
  if (n.includes("SSG")) return "SSG";
  if (n.includes("NC")) return "NC";
  if (n.includes("KT")) return "KT";
  if (n.includes("KIA")) return "KIA";

  if (n.includes("삼성")) return "삼성";
  if (n.includes("롯데")) return "롯데";
  if (n.includes("두산")) return "두산";
  if (n.includes("한화")) return "한화";
  if (n.includes("키움")) return "키움";

  return String(name).trim();
}

function gameKey(
  game: BetmanGame
) {
  return [
    game.date,
    normalizeTeam(game.homeTeam),
    normalizeTeam(game.awayTeam),
  ].join("|");
}

async function getJson<T>(
  url: string
): Promise<T | null> {
  try {
    const res =
      await fetch(url);

    if (!res.ok) {
      return null;
    }

    return await res.json() as T;
  } catch {
    return null;
  }
}

function teamFormRating(
  form: TeamForm | null
) {
  if (
    !form ||
    form.sampleSize < 5
  ) {
    return null;
  }

  const clamp =
    (v: number) =>
      Math.max(
        0,
        Math.min(100, v)
      );

  const winPct =
    form.winPct ?? 0.5;

  const avgRuns =
    form.avgRuns ?? 4.5;

  const avgRunsAllowed =
    form.avgRunsAllowed ?? 4.5;

  const resultScore =
    clamp(
      winPct * 100
    );

  const offenseScore =
    clamp(
      50 +
      (avgRuns - 4.5) * 12
    );

  const defenseScore =
    clamp(
      50 +
      (4.5 - avgRunsAllowed) * 12
    );

  const score =
    clamp(
      resultScore * 0.35 +
      offenseScore * 0.35 +
      defenseScore * 0.30
    );

  return {
    score:
      Number(score.toFixed(1)),
  };
}

function bullpenRating(
  bullpen: BullpenData | null
) {
  if (!bullpen) {
    return null;
  }

  const score =
    Math.max(
      0,
      Math.min(
        100,
        100 -
        bullpen.summary.fatigueIndex
      )
    );

  return {
    score:
      Number(score.toFixed(1)),
  };
}

function estimateProjectedTotal(
  awayForm: TeamForm | null,
  homeForm: TeamForm | null,
  awayBullpen: BullpenData | null,
  homeBullpen: BullpenData | null
) {
  if (
    awayForm?.avgRuns == null ||
    awayForm.avgRunsAllowed == null ||
    homeForm?.avgRuns == null ||
    homeForm.avgRunsAllowed == null
  ) {
    return null;
  }

  const LEAGUE_TEAM_RUNS =
    4.50;

  const awayRecentExpectation =
    (
      awayForm.avgRuns +
      homeForm.avgRunsAllowed
    ) / 2;

  const homeRecentExpectation =
    (
      homeForm.avgRuns +
      awayForm.avgRunsAllowed
    ) / 2;

  let awayRuns =
    LEAGUE_TEAM_RUNS * 0.45 +
    awayRecentExpectation * 0.55;

  let homeRuns =
    LEAGUE_TEAM_RUNS * 0.45 +
    homeRecentExpectation * 0.55;

  if (homeBullpen) {
    awayRuns +=
      Math.max(
        -0.18,
        Math.min(
          0.18,
          (
            homeBullpen
              .summary
              .fatigueIndex -
            50
          ) * 0.003
        )
      );
  }

  if (awayBullpen) {
    homeRuns +=
      Math.max(
        -0.18,
        Math.min(
          0.18,
          (
            awayBullpen
              .summary
              .fatigueIndex -
            50
          ) * 0.003
        )
      );
  }

  awayRuns =
    Math.max(
      2.75,
      Math.min(
        6.25,
        awayRuns
      )
    );

  homeRuns =
    Math.max(
      2.75,
      Math.min(
        6.25,
        homeRuns
      )
    );

  return Number(
    (
      awayRuns +
      homeRuns
    ).toFixed(2)
  );
}

function makeOdds(
  b: BetmanGame
): OddsInput {
  return {
    awayMl:
      b.moneyline?.awayOdds ??
      null,

    homeMl:
      b.moneyline?.homeOdds ??
      null,

    awayHandicapLine:
      b.spread?.awayLine ??
      null,

    homeHandicapLine:
      b.spread?.homeLine ??
      null,

    awayHandicap:
      b.spread?.awayOdds ??
      null,

    homeHandicap:
      b.spread?.homeOdds ??
      null,

    totalLine:
      b.total?.line ??
      null,

    overOdds:
      b.total?.overOdds ??
      null,

    underOdds:
      b.total?.underOdds ??
      null,
  };
}

function settlePick(
  pick: Pick,
  betman: BetmanGame,
  odds: OddsInput
):
  | "WIN"
  | "LOSS"
  | "VOID" {
  const score =
    betman.actualScore;

  if (!score) {
    return "VOID";
  }

  const home =
    score.home;

  const away =
    score.away;

  if (pick.market === "ML") {
    if (home === away) {
      return "VOID";
    }

    const pickedHome =
      pick.label.includes(
        `${normalizeTeam(
          betman.homeTeam
        )} 승`
      );

    const homeWon =
      home > away;

    return pickedHome === homeWon
      ? "WIN"
      : "LOSS";
  }

  if (
    pick.market ===
    "HANDICAP"
  ) {
    const pickedHome =
      pick.label.startsWith(
        normalizeTeam(
          betman.homeTeam
        )
      );

    const line =
      pickedHome
        ? odds.homeHandicapLine
        : odds.awayHandicapLine;

    if (line === null) {
      return "VOID";
    }

    const adjusted =
      pickedHome
        ? home + line - away
        : away + line - home;

    if (
      Math.abs(adjusted) <
      0.000001
    ) {
      return "VOID";
    }

    return adjusted > 0
      ? "WIN"
      : "LOSS";
  }

  const line =
    odds.totalLine;

  if (line === null) {
    return "VOID";
  }

  const total =
    home + away;

  if (
    Math.abs(
      total - line
    ) < 0.000001
  ) {
    return "VOID";
  }

  const isOver =
    pick.label.startsWith(
      "오버"
    );

  return (
    isOver
      ? total > line
      : total < line
  )
    ? "WIN"
    : "LOSS";
}

function resultMoney(
  result:
    | "WIN"
    | "LOSS"
    | "VOID",
  odds: number
) {
  if (result === "WIN") {
    const returned =
      STAKE * odds;

    return {
      stake: STAKE,
      returned,
      profit:
        returned - STAKE,
    };
  }

  if (result === "LOSS") {
    return {
      stake: STAKE,
      returned: 0,
      profit: -STAKE,
    };
  }

  return {
    stake: 0,
    returned: 0,
    profit: 0,
  };
}

function selectRecommendation(
  picks: Pick[],
  projectedTotal: number | null,
  odds: OddsInput
) {
  return (
    picks.find(
      (pick) => {
        if (
          !pick.odds ||
          pick.ev === null ||
          pick.ev <= 0 ||
          pick.grade === "C"
        ) {
          return false;
        }

        if (
          pick.market ===
            "TOTAL" &&
          projectedTotal !== null &&
          odds.totalLine !== null
        ) {
          if (
            Math.abs(
              projectedTotal -
              odds.totalLine
            ) < 0.8
          ) {
            return false;
          }
        }

        return true;
      }
    ) ?? null
  );
}

function summary(
  rows: any[]
) {
  const settled =
    rows.filter(
      (x) =>
        x.result === "WIN" ||
        x.result === "LOSS"
    );

  const wins =
    settled.filter(
      (x) =>
        x.result === "WIN"
    ).length;

  const stake =
    rows.reduce(
      (s, x) =>
        s + x.stake,
      0
    );

  const returned =
    rows.reduce(
      (s, x) =>
        s + x.returned,
      0
    );

  const profit =
    rows.reduce(
      (s, x) =>
        s + x.profit,
      0
    );

  return {
    bets: rows.length,

    settled:
      settled.length,

    wins,

    losses:
      settled.length -
      wins,

    voids:
      rows.length -
      settled.length,

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

    totalStake:
      Math.round(stake),

    totalReturned:
      Math.round(returned),

    profit:
      Math.round(profit),

    roi:
      stake > 0
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

async function main() {
  const raw =
    JSON.parse(
      fs.readFileSync(
        HISTORY_FILE,
        "utf8"
      )
    );

  const source:
    BetmanGame[] =
      Array.isArray(raw.games)
        ? raw.games
        : [];

  /*
    동일 실제 경기라면
    더 높은 round = 경기와 가까운
    후기 Proto 배당을 우선.
  */
  const unique =
    new Map<
      string,
      BetmanGame
    >();

  for (
    const game of source
  ) {
    const key =
      gameKey(game);

    const prev =
      unique.get(key);

    if (
      !prev ||
      Number(game.round) >
        Number(prev.round)
    ) {
      unique.set(
        key,
        game
      );
    }
  }

  const games =
    [...unique.values()]
      .sort(
        (a, b) =>
          a.date.localeCompare(
            b.date
          )
      );

  console.log(
    "===== BACKTEST ALL CANDIDATES V2 ====="
  );

  console.log(
    "Betman 원본:",
    source.length
  );

  console.log(
    "고유 경기:",
    games.length
  );

  const byDate =
    new Map<
      string,
      BetmanGame[]
    >();

  for (
    const game of games
  ) {
    const list =
      byDate.get(
        game.date
      ) || [];

    list.push(game);

    byDate.set(
      game.date,
      list
    );
  }

  const results: any[] = [];

  let index = 0;

  for (
    const [
      date,
      betmanGames,
    ] of byDate
  ) {
    index++;

    console.log(
      `[${index}/${byDate.size}] ${date}`
    );

    const today =
      await getJson<{
        games: KboGame[];
      }>(
        `${BASE}/api/kbo/today?date=${date}`
      );

    if (
      !today ||
      !Array.isArray(
        today.games
      )
    ) {
      continue;
    }

    for (
      const betman of
      betmanGames
    ) {
      const home =
        normalizeTeam(
          betman.homeTeam
        );

      const away =
        normalizeTeam(
          betman.awayTeam
        );

      const kboGame =
        today.games.find(
          (g) =>
            normalizeTeam(
              g.homeTeamName
            ) === home &&
            normalizeTeam(
              g.awayTeamName
            ) === away
        );

      if (!kboGame) {
        continue;
      }

      if (
        kboGame.status
          .stateCode !== "3"
      ) {
        continue;
      }

      if (
        kboGame.score.home ===
          null ||
        kboGame.score.away ===
          null
      ) {
        continue;
      }

      const [
        awayForm,
        homeForm,
        awayBullpen,
        homeBullpen,
      ] =
        await Promise.all([
          getJson<TeamForm>(
            `${BASE}/api/kbo/team-form?team=${encodeURIComponent(
              away
            )}&date=${date}`
          ),

          getJson<TeamForm>(
            `${BASE}/api/kbo/team-form?team=${encodeURIComponent(
              home
            )}&date=${date}`
          ),

          getJson<BullpenData>(
            `${BASE}/api/kbo/bullpen?team=${encodeURIComponent(
              away
            )}&date=${date}`
          ),

          getJson<BullpenData>(
            `${BASE}/api/kbo/bullpen?team=${encodeURIComponent(
              home
            )}&date=${date}`
          ),
        ]);

      const awayFormRating =
        teamFormRating(
          awayForm
        );

      const homeFormRating =
        teamFormRating(
          homeForm
        );

      const formEdge =
        awayFormRating &&
        homeFormRating
          ? awayFormRating.score -
            homeFormRating.score
          : 0;

      const awayBullpenRating =
        bullpenRating(
          awayBullpen
        );

      const homeBullpenRating =
        bullpenRating(
          homeBullpen
        );

      const bullpenEdge =
        awayBullpenRating &&
        homeBullpenRating
          ? awayBullpenRating.score -
            homeBullpenRating.score
          : 0;

      const projectedTotal =
        estimateProjectedTotal(
          awayForm,
          homeForm,
          awayBullpen,
          homeBullpen
        );

      const odds =
        makeOdds(
          betman
        );

      /*
        선발 = 0
        라인업 = 0
        미래 데이터 누수 방지
      */
      const picks =
        analyzeGame(
          kboGame,
          odds,
          0,
          formEdge,
          bullpenEdge,
          0,
          projectedTotal
        );

      /*
        V2 진단:
        analyzeGame()이 만든 모든 실제 베팅 가능 후보를 저장한다.

        기존 V1의 첫 추천(find) 로직은 사용하지 않는다.
        analyzer.ts 자체도 수정하지 않는다.
      */
      const settlementGame = {
        ...betman,

        actualScore: {
          home:
            kboGame.score.home,

          away:
            kboGame.score.away,
        },
      };

      for (const candidate of picks) {
        if (
          candidate.odds === null ||
          candidate.odds === undefined ||
          candidate.odds <= 1
        ) {
          continue;
        }

        const result =
          settlePick(
            candidate,
            settlementGame,
            odds
          );

        const money =
          resultMoney(
            result,
            candidate.odds
          );

        const conservativeFactor =
          candidate.market === "ML"
            ? 0.85
            : candidate.market === "HANDICAP"
              ? 0.80
              : 0.70;

        const conservativeProb =
          0.50 +
          (
            candidate.confidence -
            0.50
          ) *
          conservativeFactor;

        const rawEv =
          candidate.confidence *
            candidate.odds -
          1;

        const conservativeEv =
          conservativeProb *
            candidate.odds -
          1;

        const totalEdge =
          candidate.market === "TOTAL" &&
          projectedTotal !== null &&
          odds.totalLine !== null
            ? Math.abs(
                projectedTotal -
                odds.totalLine
              )
            : null;

        const passesCurrentFilter =
          candidate.ev !== null &&
          candidate.ev > 0 &&
          candidate.grade !== "C" &&
          (
            candidate.market !== "TOTAL" ||
            projectedTotal === null ||
            odds.totalLine === null ||
            Math.abs(
              projectedTotal -
              odds.totalLine
            ) >= 0.8
          );

        results.push({
          date,

          month:
            date.slice(
              0,
              7
            ),

          gameId:
            kboGame.gameId,

          round:
            betman.round,

          homeTeam:
            home,

          awayTeam:
            away,

          homeScore:
            kboGame.score.home,

          awayScore:
            kboGame.score.away,

          market:
            candidate.market,

          label:
            candidate.label,

          grade:
            candidate.grade,

          confidence:
            candidate.confidence,

          ev:
            candidate.ev,

          rawEv,

          conservativeProbability:
            conservativeProb,

          conservativeEv,

          odds:
            candidate.odds,

          projectedTotal,

          totalLine:
            candidate.market === "TOTAL"
              ? odds.totalLine
              : null,

          totalEdge,

          passesCurrentFilter,

          result,

          ...money,
        });
      }
    }
  }

  const monthly =
    Object.fromEntries(
      [...new Set(
        results.map(
          (x) => x.month
        )
      )]
        .sort()
        .map(
          (month) => [
            month,
            summary(
              results.filter(
                (x) =>
                  x.month ===
                  month
              )
            ),
          ]
        )
    );

  const markets =
    Object.fromEntries(
      [
        "ML",
        "HANDICAP",
        "TOTAL",
      ].map(
        (market) => [
          market,
          summary(
            results.filter(
              (x) =>
                x.market ===
                market
            )
          ),
        ]
      )
    );

  const grades =
    Object.fromEntries(
      [
        "A",
        "B",
      ].map(
        (grade) => [
          grade,
          summary(
            results.filter(
              (x) =>
                x.grade ===
                grade
            )
          ),
        ]
      )
    );

  const output = {
    generatedAt:
      new Date()
        .toISOString(),

    methodology: {
      stake:
        STAKE,

      model:
        "current-analyzer-all-candidates-v2-no-lookahead",

      included: [
        "Betman odds",
        "historical rank",
        "historical team form",
        "historical bullpen",
      ],

      excluded: [
        "starter rating",
        "lineup matchup",
      ],

      duplicateRule:
        "same date/home/away -> highest Proto round",
    },

    sourceRecords:
      source.length,

    uniqueGames:
      games.length,

    recommendations:
      results.length,

    overall:
      summary(results),

    monthly,

    markets,

    grades,

    results,
  };

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      output,
      null,
      2
    ),
    "utf8"
  );

  console.log();
  console.log(
    "===== OVERALL ====="
  );
  console.table([
    output.overall,
  ]);

  console.log();
  console.log(
    "===== MONTHLY ====="
  );

  console.table(
    Object.entries(
      monthly
    ).map(
      ([month, stat]) => ({
        month,
        ...(stat as any),
      })
    )
  );

  console.log();
  console.log(
    "===== MARKET ====="
  );

  console.table(
    Object.entries(
      markets
    ).map(
      ([market, stat]) => ({
        market,
        ...(stat as any),
      })
    )
  );

  console.log();
  console.log(
    "===== GRADE ====="
  );

  console.table(
    Object.entries(
      grades
    ).map(
      ([grade, stat]) => ({
        grade,
        ...(stat as any),
      })
    )
  );

  console.log();
  console.log(
    "FILE:",
    OUTPUT_FILE
  );
}

main().catch(
  (error) => {
    console.error(error);
    process.exit(1);
  }
);

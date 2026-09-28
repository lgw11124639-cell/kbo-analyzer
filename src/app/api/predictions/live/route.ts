import { savePregameAnalysis, mergePregameResult } from "@/lib/pregame-analysis-store";
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { fetchKboGames } from "@/lib/kbo";

export const dynamic = "force-dynamic";

const LIVE_START = "2026-09-16";

/*
  ENGINE_VERSIONED_LIVE_STATS_V1

  엔진별 통계 원본을 절대 덮어쓰지 않는다.

  scope:
  - ALL = 경기 전체 단일 예측픽
  - AI  = 실제 AI 최종 추천픽

  기존 LIVE 데이터는 v0.1 / AI 로 이관한다.
*/
const DEFAULT_ENGINE_VERSION = "v0.1";

type PredictionScope =
  | "ALL"
  | "AI";

type LivePrediction = {
  id: string;

  engineVersion: string;

  source: "LIVE";

  scope: PredictionScope;

  date: string;

  gameId: string;

  awayTeamName: string;

  homeTeamName: string;

  market:
    | "ML"
    | "HANDICAP"
    | "TOTAL";

  label: string;

  grade: string;

  confidence: number;

  ev: number | null;

  odds: number;

  /*
   * LEARNED_FEATURE_CAPTURE_V1
   * 최초 LIVE 캡처 당시 feature snapshot
   */
  starterEdge?: number | null;
  formEdge?: number | null;
  bullpenEdge?: number | null;
  lineupEdge?: number | null;
  projectedTotal?: number | null;
  projectedScore?: { awayRuns: number; homeRuns: number; total: number } | null;

  shadowRule?: string;
  baselineLabel?: string;
  minusTeam?: string;
  minusMlConfidence?: number;
  starterMargin?: number | null;
  bullpenMargin?: number | null;
  promoted?: boolean;

  firstCapturedAt: string;

  capturedAt: string;

  result:
    | "PENDING"
    | "WIN"
    | "LOSS"
    | "PUSH"
    | "VOID";

  settledAt?: string;

  awayScore?: number | null;

  homeScore?: number | null;    /*    * 경기기록 V2    */   starterSnapshot?: any;   lineupSnapshot?: any;   bullpenSnapshot?: any;   teamFormSnapshot?: any;   environmentSnapshot?: any; };

type LiveStore = {
  version: 2;

  liveStart: string;

  predictions:
    LivePrediction[];
};


const dataFile = path.join(
  process.cwd(),
  "data",
  "kbo-live-predictions.json"
);

function livePredictionId(
  engineVersion: string,
  scope: PredictionScope,
  date: string,
  gameId: string,
  market: string,
  label: string
) {
  if (scope === "AI") {
    return (
      `${engineVersion}:AI:` +
      `${date}:${gameId}`
    );
  }

  return (
    `${engineVersion}:ALL:` +
    `${date}:${gameId}:` +
    `${market}:` +
    encodeURIComponent(label)
  );
}


function normalizePrediction(
  item: any
): LivePrediction | null {
  if (!item) {
    return null;
  }

  const date =
    String(item.date || "");

  const gameId =
    String(item.gameId || "");

  const market =
    String(item.market || "");

  const label =
    String(item.label || "");

  if (
    !date ||
    !gameId ||
    ![
      "ML",
      "HANDICAP",
      "TOTAL",
    ].includes(market) ||
    !label
  ) {
    return null;
  }

  const engineVersion =
    String(
      item.engineVersion ||
      DEFAULT_ENGINE_VERSION
    );

  const scope:
    PredictionScope =
      item.scope === "ALL"
        ? "ALL"
        : "AI";

  const odds =
    Number(item.odds);

  const confidence =
    Number(item.confidence);

  if (
    !Number.isFinite(odds) ||
    odds <= 1 ||
    !Number.isFinite(
      confidence
    )
  ) {
    return null;
  }

  const result =
    [
      "PENDING",
      "WIN",
      "LOSS",
      "PUSH",
      "VOID",
    ].includes(item.result)
      ? item.result
      : "PENDING";

  return {
    ...item,

    id:
      livePredictionId(
        engineVersion,
        scope,
        date,
        gameId,
        market,
        label
      ),

    engineVersion,

    source: "LIVE",

    scope,

    date,

    gameId,

    market:
      market as
        LivePrediction["market"],

    label,

    grade:
      String(
        item.grade ||
        "C"
      ),

    confidence,

    ev:
      item.ev === null ||
      item.ev === undefined
        ? null
        : Number(item.ev),

    odds,

    firstCapturedAt:
      String(
        item.firstCapturedAt ||
        item.capturedAt ||
        new Date().toISOString()
      ),

    capturedAt:
      String(
        item.capturedAt ||
        item.firstCapturedAt ||
        new Date().toISOString()
      ),

    result:
      result as
        LivePrediction["result"],
  };
}


function emptyStore():
  LiveStore {
  return {
    version: 2,

    liveStart:
      LIVE_START,

    predictions: [],
  };
}


async function readStore():
  Promise<LiveStore> {
  try {
    const raw =
      await fs.readFile(
        dataFile,
        "utf8"
      );

    const parsed =
      JSON.parse(raw);

    const predictions =
      (
        Array.isArray(
          parsed?.predictions
        )
          ? parsed.predictions
          : []
      )
        .map(
          normalizePrediction
        )
        .filter(
          (
            item: LivePrediction | null
          ): item is LivePrediction =>
            Boolean(item)
        );

    return {
      version: 2,

      liveStart:
        LIVE_START,

      predictions,
    };

  } catch {
    return emptyStore();
  }
}


/*
  LIVE_STORE_WRITE_QUEUE_V1

  같은 Node 프로세스에서 여러 POST가 동시에
  read -> modify -> write 를 수행하지 못하게 직렬화한다.

  tmp 이름도 pid + time + sequence 로 만들어
  동일 밀리초 충돌을 방지한다.
*/
let storeMutationQueue:
  Promise<void> =
    Promise.resolve();

let tempSequence = 0;


async function withStoreMutationLock<T>(
  task:
    () => Promise<T>
): Promise<T> {
  const previous =
    storeMutationQueue;

  let release:
    () => void =
      () => {};

  storeMutationQueue =
    new Promise<void>(
      (resolve) => {
        release =
          resolve;
      }
    );

  await previous;

  try {
    return await task();

  } finally {
    release();
  }
}


async function writeStore(store: LiveStore) {
  await fs.mkdir(path.dirname(dataFile), {
    recursive: true,
  });

  const temp =
    `${dataFile}.tmp-${process.pid}-${Date.now()}-${++tempSequence}`;

  await fs.writeFile(
    temp,
    JSON.stringify(store, null, 2),
    "utf8"
  );

  await fs.rename(temp, dataFile);
}

function todayKst() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }
  ).format(new Date());
}

function parseLastNumber(label: string) {
  const matches =
    String(label).match(/[+-]?\d+(?:\.\d+)?/g);

  if (!matches?.length) return null;

  const value =
    Number(matches[matches.length - 1]);

  return Number.isFinite(value)
    ? value
    : null;
}

function settlePrediction(
  prediction: LivePrediction,
  game: any
): LivePrediction["result"] {
  if (!game) return "PENDING";

  const cancelName =
    String((game as any)?.status?.cancelName || "").trim();

  if (
    cancelName &&
    cancelName !== "정상경기"
  ) {
    return "VOID";
  }

  if (
    String((game as any)?.status?.stateCode || "") !== "3"
  ) {
    return "PENDING";
  }

  const awayScore =
    (game as any)?.score?.away;

  const homeScore =
    (game as any)?.score?.home;

  if (
    typeof awayScore !== "number" ||
    typeof homeScore !== "number"
  ) {
    return "PENDING";
  }

  if (prediction.market === "ML") {
    if (
      prediction.label.startsWith(
        `${prediction.awayTeamName} `
      )
    ) {
      if (awayScore > homeScore) return "WIN";
      if (awayScore < homeScore) return "LOSS";
      return "PUSH";
    }

    if (
      prediction.label.startsWith(
        `${prediction.homeTeamName} `
      )
    ) {
      if (homeScore > awayScore) return "WIN";
      if (homeScore < awayScore) return "LOSS";
      return "PUSH";
    }

    return "VOID";
  }

  if (prediction.market === "HANDICAP") {
    const line =
      parseLastNumber(prediction.label);

    if (line === null) {
      return "VOID";
    }

    if (
      prediction.label.startsWith(
        `${prediction.awayTeamName} `
      )
    ) {
      const adjusted =
        awayScore + line;

      if (adjusted > homeScore) return "WIN";
      if (adjusted < homeScore) return "LOSS";
      return "PUSH";
    }

    if (
      prediction.label.startsWith(
        `${prediction.homeTeamName} `
      )
    ) {
      const adjusted =
        homeScore + line;

      if (adjusted > awayScore) return "WIN";
      if (adjusted < awayScore) return "LOSS";
      return "PUSH";
    }

    return "VOID";
  }

  if (prediction.market === "TOTAL") {
    const line =
      parseLastNumber(prediction.label);

    if (line === null) {
      return "VOID";
    }

    const total =
      awayScore + homeScore;

    if (
      prediction.label.startsWith("오버")
    ) {
      if (total > line) return "WIN";
      if (total < line) return "LOSS";
      return "PUSH";
    }

    if (
      prediction.label.startsWith("언더")
    ) {
      if (total < line) return "WIN";
      if (total > line) return "LOSS";
      return "PUSH";
    }

    return "VOID";
  }

  return "VOID";
}

export async function GET(
  request: Request
) {
  const store =
    await readStore();

  const url =
    new URL(
      request.url
    );

  const engineVersion =
    String(
      url.searchParams.get(
        "engineVersion"
      ) ||
      DEFAULT_ENGINE_VERSION
    );

  const rawScope =
    String(
      url.searchParams.get(
        "scope"
      ) ||
      "AI"
    ).toUpperCase();

  const scope:
    PredictionScope =
      rawScope === "ALL"
        ? "ALL"
        : "AI";

  const predictions =
    store.predictions
      .filter(
        (item) =>
          item.engineVersion ===
            engineVersion &&
          item.scope ===
            scope
      )
      .sort(
        (a, b) =>
          b.date.localeCompare(
            a.date
          ) ||
          b.gameId.localeCompare(
            a.gameId
          )
      );

  const settled =
    predictions.filter(
      (x) =>
        x.result !==
        "PENDING"
    );

  const wins =
    settled.filter(
      (x) =>
        x.result ===
        "WIN"
    ).length;

  const losses =
    settled.filter(
      (x) =>
        x.result ===
        "LOSS"
    ).length;

  const graded =
    wins + losses;

  const hitRate =
    graded
      ? wins / graded
      : null;

  let stake = 0;

  let returned = 0;

  for (
    const item of
    settled
  ) {
    stake += 10000;

    if (
      item.result ===
      "WIN"
    ) {
      returned +=
        10000 *
        item.odds;

    } else if (
      item.result ===
        "PUSH" ||
      item.result ===
        "VOID"
    ) {
      returned +=
        10000;
    }
  }

  const returnRate =
    stake
      ? (
          returned -
          stake
        ) /
        stake
      : null;

  const engines =
    [
      ...new Set(
        store.predictions.map(
          (item) =>
            item.engineVersion
        )
      ),
    ].sort();

  return NextResponse.json({
    version: 2,

    liveStart:
      LIVE_START,

    engineVersion,

    scope,

    engines,

    count:
      predictions.length,

    settled:
      settled.length,

    pending:
      predictions.length -
      settled.length,

    wins,

    losses,

    hitRate,

    returnRate,

    predictions,
  });
}


export async function POST(
  request: Request
) {
  return withStoreMutationLock(
    () =>
      postUnlocked(
        request
      )
  );
}


async function postUnlocked(
  request: Request
) {
  const body =
    await request.json();

  const date =
    String(
      body?.date ||
      ""
    );

  const engineVersion =
    String(
      body?.engineVersion ||
      DEFAULT_ENGINE_VERSION
    ).trim();

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      date
    ) ||
    date < LIVE_START ||
    !engineVersion
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "INVALID_DATE_OR_ENGINE",
      },
      {
        status: 400,
      }
    );
  }

  /*
    기존 클라이언트 호환:
    predictions가 오면 AI로 취급.
  */
  const allPredictions =
    Array.isArray(
      body?.allPredictions
    )
      ? body.allPredictions
      : [];

  const aiPredictions =
    Array.isArray(
      body?.aiPredictions
    )
      ? body.aiPredictions
      : Array.isArray(
          body?.predictions
        )
        ? body.predictions
        : [];

  const games =
    Array.isArray(
      body?.games
    )
      ? body.games
      : [];

  const gameMap =
    new Map(
      games.map(
        (game: any) => [
          String(
            game?.gameId ||
            ""
          ),
          game,
        ]
      )
    );

  const store =
    await readStore();

  const byId =
    new Map(
      store.predictions.map(
        (item) => [
          item.id,
          item,
        ]
      )
    );

  const now =
    new Date().toISOString();

  const currentDate =
    todayKst();

  let created = 0;

  let updated = 0;

  let settledCount = 0;


  const ingest = (
    input:
      any[],
    scope:
      PredictionScope
  ) => {
    if (
      date !==
      currentDate
    ) {
      return;
    }

    for (
      const raw of
      input
    ) {
      const gameId =
        String(
          raw?.gameId ||
          ""
        );

      const game =
        gameMap.get(
          gameId
        );

      if (
        !gameId ||
        !game
      ) {
        continue;
      }

      const stateCode =
        String(
          (game as any)
            ?.status
            ?.stateCode ||
          ""
        );

      const inning =
        (game as any)
          ?.status
          ?.inning;

      const topBottom =
        (game as any)
          ?.status
          ?.topBottom;

      const cancelled =
        String(
          (game as any)
            ?.status
            ?.cancelName ||
          ""
        ).trim();

      const started =
        stateCode === "2" ||
        stateCode === "3" ||
        (
          inning !== null &&
          inning !== undefined
        ) ||
        Boolean(
          topBottom
        );

      /*
        경기 시작 후에는
        새로운 예측을 만들거나
        기존 예측 내용을
        바꾸지 않는다.
      */
      if (
        started ||
        (
          cancelled &&
          cancelled !==
            "정상경기"
        )
      ) {
        continue;
      }

      const market =
        String(
          raw?.market ||
          ""
        );

      const label =
        String(
          raw?.label ||
          ""
        );

      const odds =
        Number(
          raw?.odds
        );

      const confidence =
        Number(
          raw?.confidence
        );

      if (
        ![
          "ML",
          "HANDICAP",
          "TOTAL",
        ].includes(
          market
        ) ||
        !label ||
        !Number.isFinite(
          odds
        ) ||
        odds <= 1 ||
        !Number.isFinite(
          confidence
        )
      ) {
        continue;
      }

      const id =
        livePredictionId(
          engineVersion,
          scope,
          date,
          gameId,
          market,
          label
        );

      const previous =
        byId.get(
          id
        );

      const next:
        LivePrediction = {
          id,

          engineVersion,

          source:
            "LIVE",

          scope,

          date,

          gameId,

          awayTeamName:
            String(
              (game as any)
                ?.awayTeamName ||
              raw
                ?.awayTeamName ||
              ""
            ),

          homeTeamName:
            String(
              (game as any)
                ?.homeTeamName ||
              raw
                ?.homeTeamName ||
              ""
            ),

          market:
            market as
              LivePrediction[
                "market"
              ],

          label,

          grade:
            String(
              raw?.grade ||
              "C"
            ),

          confidence,

          ev:
            raw?.ev === null ||
            raw?.ev ===
              undefined
              ? null
              : Number(
                  raw.ev
                ),

          odds,

          /*
           * LEARNED_FEATURE_CAPTURE_V1
           *
           * 최초 캡처값 동결.
           * 이미 저장된 feature가 있으면
           * 이후 POST에서는 절대 덮어쓰지 않는다.
           */
          starterEdge:
            previous?.starterEdge !== undefined
              ? previous.starterEdge
              : raw?.starterEdge === null
                ? null
                : Number.isFinite(
                    Number(raw?.starterEdge)
                  )
                  ? Number(raw.starterEdge)
                  : undefined,

          formEdge:
            previous?.formEdge !== undefined
              ? previous.formEdge
              : raw?.formEdge === null
                ? null
                : Number.isFinite(
                    Number(raw?.formEdge)
                  )
                  ? Number(raw.formEdge)
                  : undefined,

          bullpenEdge:
            previous?.bullpenEdge !== undefined
              ? previous.bullpenEdge
              : raw?.bullpenEdge === null
                ? null
                : Number.isFinite(
                    Number(raw?.bullpenEdge)
                  )
                  ? Number(raw.bullpenEdge)
                  : undefined,

          lineupEdge:
            previous?.lineupEdge !== undefined
              ? previous.lineupEdge
              : raw?.lineupEdge === null
                ? null
                : Number.isFinite(
                    Number(raw?.lineupEdge)
                  )
                  ? Number(raw.lineupEdge)
                  : undefined,

          projectedTotal:
            previous?.projectedTotal !== undefined
              ? previous.projectedTotal
              : raw?.projectedTotal === null
                ? null
                : Number.isFinite(
                    Number(raw?.projectedTotal)
                  )
                  ? Number(raw.projectedTotal)
                  : undefined,

          /* PREGAME_PROJECTED_SCORE_FREEZE_V1 */
          projectedScore:
            previous?.projectedScore !== undefined
              ? previous.projectedScore
              : raw?.projectedScore &&
                Number.isFinite(Number(raw.projectedScore.awayRuns)) &&
                Number.isFinite(Number(raw.projectedScore.homeRuns)) &&
                Number.isFinite(Number(raw.projectedScore.total))
                ? {
                    awayRuns: Number(raw.projectedScore.awayRuns),
                    homeRuns: Number(raw.projectedScore.homeRuns),
                    total: Number(raw.projectedScore.total),
                  }
                : undefined,

          shadowRule:
            raw?.shadowRule
              ? String(raw.shadowRule)
              : undefined,

          baselineLabel:
            raw?.baselineLabel
              ? String(raw.baselineLabel)
              : undefined,

          minusTeam:
            raw?.minusTeam
              ? String(raw.minusTeam)
              : undefined,

          minusMlConfidence:
            Number.isFinite(Number(raw?.minusMlConfidence))
              ? Number(raw.minusMlConfidence)
              : undefined,

          starterMargin:
            raw?.starterMargin === null
              ? null
              : Number.isFinite(Number(raw?.starterMargin))
                ? Number(raw.starterMargin)
                : undefined,

          bullpenMargin:
            raw?.bullpenMargin === null
              ? null
              : Number.isFinite(Number(raw?.bullpenMargin))
                ? Number(raw.bullpenMargin)
                : undefined,

          promoted:
            typeof raw?.promoted === "boolean"
              ? raw.promoted
              : undefined,

          starterSnapshot:
            previous?.starterSnapshot ?? raw?.starterSnapshot,

          lineupSnapshot:
            previous?.lineupSnapshot ?? raw?.lineupSnapshot,

          bullpenSnapshot:
            previous?.bullpenSnapshot ?? raw?.bullpenSnapshot,

          teamFormSnapshot:
            previous?.teamFormSnapshot ?? raw?.teamFormSnapshot,

          environmentSnapshot:
            previous?.environmentSnapshot ?? raw?.environmentSnapshot,

          firstCapturedAt:
            previous
              ?.firstCapturedAt ||
            now,

          capturedAt:
            now,

          result:
            "PENDING",
        };

      byId.set(
        id,
        next
      );

      if (
        previous
      ) {
        updated += 1;
      } else {
        created += 1;
      }
    }
  };


  ingest(
    allPredictions,
    "ALL"
  );

  ingest(
    aiPredictions,
    "AI"
  );


  /*
    저장돼 있는 모든 엔진/범주의
    해당 날짜 예측을
    실제 경기결과로 정산한다.
  */
  for (
    const [
      id,
      prediction,
    ] of byId
  ) {
    if (
      prediction.date !==
      date
    ) {
      continue;
    }

    const game =
      gameMap.get(
        prediction.gameId
      );

    if (!game) {
      continue;
    }

    const result =
      settlePrediction(
        prediction,
        game
      );

    if (
      result !==
        "PENDING" &&
      (
        prediction.result !==
          result ||
        prediction.awayScore !==
          (game as any)
            ?.score
            ?.away ||
        prediction.homeScore !==
          (game as any)
            ?.score
            ?.home
      )
    ) {
      byId.set(
        id,
        {
          ...prediction,

          result,

          settledAt:
            now,

          awayScore:
            (game as any)
              ?.score
              ?.away ??
            null,

          homeScore:
            (game as any)
              ?.score
              ?.home ??
            null,
        }
      );

      settledCount += 1;
    }
  }

  store.predictions =
    [
      ...byId.values(),
    ].sort(
      (a, b) =>
        a.date.localeCompare(
          b.date
        ) ||
        a.engineVersion.localeCompare(
          b.engineVersion
        ) ||
        a.scope.localeCompare(
          b.scope
        ) ||
        a.gameId.localeCompare(
          b.gameId
        ) ||
        a.id.localeCompare(
          b.id
        )
    );

  await writeStore(
    store
  );

  try { await savePregameAnalysis(date, games); } catch (error) { console.error("[PREGAME_ANALYSIS_SAVE_FAILED]", error); }

  return NextResponse.json({
    ok: true,

    version: 2,

    date,

    currentDate,

    engineVersion,

    allIncoming:
      allPredictions.length,

    aiIncoming:
      aiPredictions.length,

    created,

    updated,

    settled:
      settledCount,

    total:
      store.predictions.length,
  });
}



/* SERVER_SNAPSHOT_SETTLEMENT_V1 */
export async function PUT(request: Request) {
  try {
    const token = (await fs.readFile(path.join(process.cwd(), "data", ".history-settle-token"), "utf8")).trim();
    if (!token || request.headers.get("authorization") !== "Bearer " + token) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    const initial = await readStore();
    const today = todayKst();

    let historyAnalysisRows: any[] = [];

    try {
      const analysisRaw =
        JSON.parse(
          await fs.readFile(
            path.join(
              process.cwd(),
              "data",
              "kbo-pregame-analysis-snapshots.json"
            ),
            "utf8"
          )
        );

      historyAnalysisRows =
        Array.isArray(
          analysisRaw?.snapshots
        )
          ? analysisRaw.snapshots
          : [];
    } catch {
      historyAnalysisRows = [];
    }

    const predictionDates =
      initial.predictions
        .filter(
          (p) =>
            p.result === "PENDING" &&
            /^\d{4}-\d{2}-\d{2}$/.test(
              p.date
            ) &&
            p.date <= today
        )
        .map(
          (p) => p.date
        );

    const analysisDates =
      historyAnalysisRows
        .filter(
          (row: any) =>
            row?.capturePhase === "PREGAME" &&
            /^\d{4}-\d{2}-\d{2}$/.test(
              String(
                row?.date ||
                ""
              )
            ) &&
            String(
              row.date
            ) <= today &&
            !row?.result
        )
        .map(
          (row: any) =>
            String(
              row.date
            )
        );

    const dates =
      [
        ...new Set([
          ...predictionDates,
          ...analysisDates,
        ]),
      ]
        .sort()
        .reverse()
        .slice(0, 14);
    const official = new Map<string, any>();
    const failures: string[] = [];
    for (const date of dates) {
      try {
        const games = await fetchKboGames(date.replaceAll("-", ""));
        for (const game of games) official.set(date + "|" + game.gameId, game);
      } catch (error) {
        failures.push(date);
        console.error("[HISTORY_SETTLEMENT_FETCH_FAILED]", date, error);
      }
    }
    return await withStoreMutationLock(async () => {
      const store = await readStore();
      const now = new Date().toISOString();
      let settled = 0;
      for (const prediction of store.predictions) {
        if (prediction.result !== "PENDING") continue;
        const game = official.get(prediction.date + "|" + prediction.gameId);
        if (!game) continue;
        const canceled = String(game.status?.cancelName || "").trim();
        const isCanceled = !!canceled && canceled !== "정상경기";
        if (!isCanceled && (String(game.status?.stateCode) !== "3" || !Number.isInteger(game.score?.away) || !Number.isInteger(game.score?.home) || game.score.away < 0 || game.score.home < 0)) continue;
        const result = settlePrediction(prediction, game);
        if (result === "PENDING") continue;
        prediction.result = result;
         await mergePregameResult(prediction, game); 
        prediction.settledAt = now;
        prediction.awayScore = game.score?.away ?? null;
        prediction.homeScore = game.score?.home ?? null;
        settled++;
      }
      if (settled > 0) await writeStore(store);

      /* HISTORY_ANALYSIS_RESULT_ARCHIVE_V20 */
      try {
        const analysisFile =
          path.join(
            process.cwd(),
            "data",
            "kbo-pregame-analysis-snapshots.json"
          );

        const analysisStore =
          JSON.parse(
            await fs.readFile(
              analysisFile,
              "utf8"
            )
          );

        const rows =
          Array.isArray(
            analysisStore?.snapshots
          )
            ? analysisStore.snapshots
            : [];

        let archivedAnalysis = 0;

        for (const row of rows) {
          if (
            !dates.includes(
              String(
                row?.date ||
                ""
              )
            ) ||
            !row?.gameId
          ) {
            continue;
          }

          const game =
            official.get(
              `${row.date}|${row.gameId}`
            );

          if (!game) {
            continue;
          }

          const canceled =
            String(
              game?.status?.cancelName ||
              ""
            ).trim();

          if (
            canceled &&
            canceled !== "정상경기"
          ) {
            continue;
          }

          const awayScore =
            game?.score?.away;

          const homeScore =
            game?.score?.home;

          if (
            String(
              game?.status?.stateCode ||
              ""
            ) !== "3" ||
            !Number.isInteger(
              awayScore
            ) ||
            !Number.isInteger(
              homeScore
            ) ||
            awayScore < 0 ||
            homeScore < 0
          ) {
            continue;
          }

          if (
            row?.result?.awayScore ===
              awayScore &&
            row?.result?.homeScore ===
              homeScore
          ) {
            continue;
          }

          row.result = {
            awayScore,
            homeScore,

            winner:
              awayScore > homeScore
                ? "AWAY"
                : awayScore < homeScore
                  ? "HOME"
                  : "DRAW",

            totalRuns:
              awayScore +
              homeScore,

            settledAt:
              now,
          };

          archivedAnalysis += 1;
        }

        if (
          archivedAnalysis > 0
        ) {
          const temp =
            analysisFile +
            `.tmp-history-${process.pid}-${Date.now()}`;

          await fs.writeFile(
            temp,
            JSON.stringify(
              analysisStore,
              null,
              2
            ),
            "utf8"
          );

          await fs.rename(
            temp,
            analysisFile
          );
        }
      } catch (error) {
        console.error(
          "[HISTORY_ANALYSIS_RESULT_ARCHIVE_FAILED]",
          error
        );
      }
      return NextResponse.json({ ok: failures.length === 0, settled, checkedDates: dates, failedDates: failures, remaining: store.predictions.filter(p => p.result === "PENDING").length }, { headers: { "Cache-Control": "no-store" } });
    });
  } catch (error) {
    console.error("[HISTORY_SETTLEMENT_FAILED]", error);
    return NextResponse.json({ ok: false, error: "SETTLEMENT_FAILED" }, { status: 500 });
  }
}

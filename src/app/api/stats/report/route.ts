import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic =
  "force-dynamic";


type Source =
  | "BACKTEST"
  | "BACKFILL"
  | "LIVE";


type PickRecord = {
  source: Source;

  date: string;

  gameId: string;

  awayTeam: string;

  homeTeam: string;

  market:
    | "ML"
    | "HANDICAP"
    | "TOTAL";

  label: string;

  grade: string;

  odds: number | null;

  result:
    | "PENDING"
    | "WIN"
    | "LOSS"
    | "PUSH"
    | "VOID";
};


type ComboPick = {
  gameId: string;

  market:
    | "ML"
    | "HANDICAP"
    | "TOTAL"
    | string;

  label: string;

  odds:
    | number
    | null;

  result:
    | "PENDING"
    | "WIN"
    | "LOSS"
    | "PUSH"
    | "VOID";
};


type ComboRecord = {
  source: Source;

  date: string;

  mode:
    | "SAFE"
    | "VALUE"
    | "HIGH_ODDS";

  leg: number;

  odds: number;

  effectiveOdds:
    number | null;

  result:
    | "PENDING"
    | "WIN"
    | "LOSS"
    | "VOID";

  picks:
    ComboPick[];
};


const DATA_DIR =
  path.join(
    process.cwd(),
    "data"
  );


const MARKET_KEYS = [
  "ML",
  "HANDICAP",
  "TOTAL",
] as const;


const GRADE_KEYS = [
  "A",
  "B",
  "C",
] as const;


const MODES = [
  "SAFE",
  "VALUE",
  "HIGH_ODDS",
] as const;


const LEGS = [
  2,
  3,
  4,
  5,
];


async function readJsonSafe(
  file: string
): Promise<any | null> {
  try {
    return JSON.parse(
      await fs.readFile(
        file,
        "utf8"
      )
    );
  } catch {
    return null;
  }
}


function engineSort(
  a: string,
  b: string
) {
  const parse = (
    value: string
  ) =>
    value
      .replace(/^v/i, "")
      .split(".")
      .map(
        (part) =>
          Number(part) || 0
      );

  const av =
    parse(a);

  const bv =
    parse(b);

  const length =
    Math.max(
      av.length,
      bv.length
    );

  for (
    let i = 0;
    i < length;
    i += 1
  ) {
    const diff =
      (av[i] || 0) -
      (bv[i] || 0);

    if (diff !== 0) {
      return diff;
    }
  }

  return a.localeCompare(b);
}


function normalizeResult(
  value: unknown
):
  | "PENDING"
  | "WIN"
  | "LOSS"
  | "PUSH"
  | "VOID" {
  const result =
    String(
      value || ""
    ).toUpperCase();

  if (
    result === "WIN" ||
    result === "LOSS" ||
    result === "PUSH" ||
    result === "VOID"
  ) {
    return result;
  }

  return "PENDING";
}


function summarizePicks(
  rows: PickRecord[]
) {
  const wins =
    rows.filter(
      (row) =>
        row.result ===
        "WIN"
    ).length;

  const losses =
    rows.filter(
      (row) =>
        row.result ===
        "LOSS"
    ).length;

  const pushes =
    rows.filter(
      (row) =>
        row.result ===
        "PUSH"
    ).length;

  const voids =
    rows.filter(
      (row) =>
        row.result ===
        "VOID"
    ).length;

  const pending =
    rows.filter(
      (row) =>
        row.result ===
        "PENDING"
    ).length;

  const settled =
    rows.length -
    pending;

  const decided =
    wins +
    losses;

  let stake = 0;
  let returned = 0;
  let betCount = 0;

  const oddsValues:
    number[] = [];

  for (
    const row of rows
  ) {
    if (
      typeof row.odds ===
        "number" &&
      Number.isFinite(
        row.odds
      ) &&
      row.odds > 1
    ) {
      oddsValues.push(
        row.odds
      );
    }

    if (
      row.result ===
      "PENDING"
    ) {
      continue;
    }

    if (
      typeof row.odds !==
        "number" ||
      !Number.isFinite(
        row.odds
      ) ||
      row.odds <= 1
    ) {
      continue;
    }

    stake += 10000;
    betCount += 1;

    if (
      row.result ===
      "WIN"
    ) {
      returned +=
        10000 *
        row.odds;

    } else if (
      row.result ===
        "PUSH" ||
      row.result ===
        "VOID"
    ) {
      returned +=
        10000;
    }
  }

  const profit =
    returned -
    stake;

  return {
    count:
      rows.length,

    settled,

    pending,

    wins,

    losses,

    pushes,

    voids,

    decided,

    hitRate:
      decided > 0
        ? wins /
          decided
        : null,

    betCount,

    stake:
      Math.round(
        stake
      ),

    profit:
      Math.round(
        profit
      ),

    returnRate:
      stake > 0
        ? profit /
          stake
        : null,

    averageOdds:
      oddsValues.length
        ? oddsValues.reduce(
            (
              sum,
              value
            ) =>
              sum + value,
            0
          ) /
          oddsValues.length
        : null,
  };
}


function summarizeCombos(
  rows: ComboRecord[]
) {
  const wins =
    rows.filter(
      (row) =>
        row.result ===
        "WIN"
    ).length;

  const losses =
    rows.filter(
      (row) =>
        row.result ===
        "LOSS"
    ).length;

  const voids =
    rows.filter(
      (row) =>
        row.result ===
        "VOID"
    ).length;

  const pending =
    rows.filter(
      (row) =>
        row.result ===
        "PENDING"
    ).length;

  const settled =
    rows.length -
    pending;

  const decided =
    wins +
    losses;

  let stake = 0;
  let returned = 0;

  const oddsValues =
    rows
      .map(
        (row) =>
          row.odds
      )
      .filter(
        (
          value
        ): value is number =>
          Number.isFinite(
            value
          ) &&
          value > 1
      );

  for (
    const row of rows
  ) {
    if (
      row.result ===
      "PENDING"
    ) {
      continue;
    }

    stake += 10000;

    if (
      row.result ===
      "WIN"
    ) {
      returned +=
        10000 *
        (
          row.effectiveOdds ??
          row.odds
        );

    } else if (
      row.result ===
      "VOID"
    ) {
      returned +=
        10000;
    }
  }


  const pickResults =
    rows.flatMap(
      (row) =>
        row.picks
          .map(
            (pick) =>
              pick.result
          )
    );

  const pickWins =
    pickResults.filter(
      (result) =>
        result ===
        "WIN"
    ).length;

  const pickLosses =
    pickResults.filter(
      (result) =>
        result ===
        "LOSS"
    ).length;

  const pickDecided =
    pickWins +
    pickLosses;

  const profit =
    returned -
    stake;

  return {
    count:
      rows.length,

    settled,

    pending,

    wins,

    losses,

    voids,

    decided,

    hitRate:
      decided > 0
        ? wins /
          decided
        : null,

    pickWins,

    pickLosses,

    pickDecided,

    pickHitRate:
      pickDecided > 0
        ? pickWins /
          pickDecided
        : null,

    averageOdds:
      oddsValues.length
        ? oddsValues.reduce(
            (
              sum,
              value
            ) =>
              sum + value,
            0
          ) /
          oddsValues.length
        : null,

    stake:
      Math.round(
        stake
      ),

    profit:
      Math.round(
        profit
      ),

    returnRate:
      stake > 0
        ? profit /
          stake
        : null,
  };
}


function normalizeBacktestPick(
  row: any
): PickRecord | null {
  if (
    !row ||
    !MARKET_KEYS.includes(
      row.market
    )
  ) {
    return null;
  }

  return {
    source:
      row.source === "BACKFILL"
        ? "BACKFILL"
        : "BACKTEST",

    date:
      String(
        row.date || ""
      ),

    gameId:
      String(
        row.gameId || ""
      ),

    awayTeam:
      String(
        row.awayTeam ||
        row.awayTeamName ||
        ""
      ),

    homeTeam:
      String(
        row.homeTeam ||
        row.homeTeamName ||
        ""
      ),

    market:
      row.market,

    label:
      String(
        row.label || ""
      ),

    grade:
      String(
        row.grade || ""
      ).toUpperCase(),

    odds:
      typeof row.odds ===
        "number"
        ? row.odds
        : Number.isFinite(
              Number(row.odds)
            )
          ? Number(
              row.odds
            )
          : null,

    result:
      normalizeResult(
        row.result
      ),
  };
}


function normalizeLivePick(
  row: any
): PickRecord | null {
  if (
    !row ||
    row.scope !== "ALL" ||
    !MARKET_KEYS.includes(
      row.market
    )
  ) {
    return null;
  }

  return {
    source:
      "LIVE",

    date:
      String(
        row.date || ""
      ),

    gameId:
      String(
        row.gameId || ""
      ),

    awayTeam:
      String(
        row.awayTeamName ||
        row.awayTeam ||
        ""
      ),

    homeTeam:
      String(
        row.homeTeamName ||
        row.homeTeam ||
        ""
      ),

    market:
      row.market,

    label:
      String(
        row.label || ""
      ),

    grade:
      String(
        row.grade || ""
      ).toUpperCase(),

    odds:
      typeof row.odds ===
        "number"
        ? row.odds
        : Number.isFinite(
              Number(row.odds)
            )
          ? Number(
              row.odds
            )
          : null,

    result:
      normalizeResult(
        row.result
      ),
  };
}


function normalizeBacktestCombo(
  row: any
): ComboRecord | null {
  if (
    !row ||
    !MODES.includes(
      row.mode
    ) ||
    !LEGS.includes(
      Number(
        row.leg
      )
    )
  ) {
    return null;
  }

  const picks =
    Array.isArray(
      row.picks
    )
      ? row.picks.map(
          (
            pick: any
          ) => ({
            gameId:
              String(
                pick?.gameId || ""
              ),

            market:
              String(
                pick?.market || ""
              ),

            label:
              String(
                pick?.label || ""
              ),

            odds:
              typeof pick?.odds ===
                "number"
                ? pick.odds
                : Number.isFinite(
                    Number(
                      pick?.odds
                    )
                  )
                  ? Number(
                      pick.odds
                    )
                  : null,

            result:
              normalizeResult(
                pick?.result
              ),
          })
        )
      : [];

  return {
    source:
      row.source === "BACKFILL"
        ? "BACKFILL"
        : "BACKTEST",

    date:
      String(
        row.date || ""
      ),

    mode:
      row.mode,

    leg:
      Number(
        row.leg
      ),

    odds:
      Number(
        row.odds
      ) || 1,

    effectiveOdds:
      typeof row.effectiveOdds ===
        "number"
        ? row.effectiveOdds
        : null,

    result:
      normalizeResult(
        row.result
      ) as ComboRecord["result"],

    picks,
  };
}


function normalizeLiveCombo(
  row: any
): ComboRecord | null {
  if (
    !row ||
    !MODES.includes(
      row.mode
    ) ||
    !LEGS.includes(
      Number(
        row.leg
      )
    )
  ) {
    return null;
  }

  const rawPicks =
    Array.isArray(
      row.picks
    )
      ? row.picks
      : [];

  const rawResults =
    Array.isArray(
      row.pickResults
    )
      ? row.pickResults
      : [];

  const picks =
    rawPicks.map(
      (
        pick: any,
        index: number
      ) => ({
        gameId:
          String(
            pick?.gameId || ""
          ),

        market:
          String(
            pick?.market || ""
          ),

        label:
          String(
            pick?.label || ""
          ),

        odds:
          typeof pick?.odds ===
            "number"
            ? pick.odds
            : Number.isFinite(
                Number(
                  pick?.odds
                )
              )
              ? Number(
                  pick.odds
                )
              : null,

        result:
          normalizeResult(
            rawResults[
              index
            ] ??
            pick?.result
          ),
      })
    );

  return {
    source:
      "LIVE",

    date:
      String(
        row.date || ""
      ),

    mode:
      row.mode,

    leg:
      Number(
        row.leg
      ),

    odds:
      Number(
        row.odds
      ) || 1,

    effectiveOdds:
      typeof row.effectiveOdds ===
        "number"
        ? row.effectiveOdds
        : null,

    result:
      normalizeResult(
        row.result
      ) as ComboRecord["result"],

    picks,
  };
}


function buildMarketStats(
  backtest:
    PickRecord[],
  backfill:
    PickRecord[],
  live:
    PickRecord[]
) {
  return MARKET_KEYS.map(
    (market) => {
      const bt =
        backtest.filter(
          (row) =>
            row.market ===
            market
        );

      const bf =
        backfill.filter(
          (row) =>
            row.market ===
            market
        );

      const lv =
        live.filter(
          (row) =>
            row.market ===
            market
        );

      return {
        market,

        combined:
          summarizePicks(
            [
              ...bt,
              ...bf,
              ...lv,
            ]
          ),

        backtest:
          summarizePicks(
            bt
          ),

        backfill:
          summarizePicks(
            bf
          ),

        live:
          summarizePicks(
            lv
          ),
      };
    }
  );
}


function buildGradeStats(
  backtest:
    PickRecord[],
  backfill:
    PickRecord[],
  live:
    PickRecord[]
) {
  return GRADE_KEYS.map(
    (grade) => {
      const bt =
        backtest.filter(
          (row) =>
            row.grade ===
            grade
        );

      const bf =
        backfill.filter(
          (row) =>
            row.grade ===
            grade
        );

      const lv =
        live.filter(
          (row) =>
            row.grade ===
            grade
        );

      return {
        grade,

        combined:
          summarizePicks(
            [
              ...bt,
              ...bf,
              ...lv,
            ]
          ),

        backtest:
          summarizePicks(
            bt
          ),

        backfill:
          summarizePicks(
            bf
          ),

        live:
          summarizePicks(
            lv
          ),
      };
    }
  );
}


function buildTimeline(
  rows: PickRecord[]
) {
  const map =
    new Map<
      string,
      PickRecord[]
    >();

  for (
    const row of rows
  ) {
    const month =
      row.date.slice(
        0,
        7
      );

    const key =
      `${month}:${row.source}`;

    const list =
      map.get(
        key
      ) || [];

    list.push(
      row
    );

    map.set(
      key,
      list
    );
  }

  return [
    ...map.entries(),
  ]
    .map(
      (
        [
          key,
          list,
        ]
      ) => {
        const [
          month,
          source,
        ] =
          key.split(
            ":"
          );

        return {
          month,

          source:
            source as Source,

          ...summarizePicks(
            list
          ),
        };
      }
    )
    .sort(
      (a, b) =>
        a.month.localeCompare(
          b.month
        ) ||
        (
          (
            a.source === "BACKTEST"
              ? 0
              : a.source === "BACKFILL"
                ? 1
                : 2
          ) -
          (
            b.source === "BACKTEST"
              ? 0
              : b.source === "BACKFILL"
                ? 1
                : 2
          )
        )
    );
}


function buildRecentGames(
  rows: PickRecord[]
) {
  const map =
    new Map<
      string,
      PickRecord[]
    >();

  for (
    const row of rows
  ) {
    const key =
      `${row.source}:${row.date}:${row.gameId}`;

    const list =
      map.get(
        key
      ) || [];

    list.push(
      row
    );

    map.set(
      key,
      list
    );
  }

  return [
    ...map.values(),
  ]
    .map(
      (list) => {
        const first =
          list[0];

        return {
          source:
            first.source,

          date:
            first.date,

          gameId:
            first.gameId,

          awayTeam:
            first.awayTeam,

          homeTeam:
            first.homeTeam,

          ...summarizePicks(
            list
          ),

          markets:
            MARKET_KEYS
              .map(
                (market) =>
                  list.find(
                    (row) =>
                      row.market ===
                      market
                  )
              )
              .filter(
                (
                  row
                ): row is PickRecord =>
                  Boolean(row)
              )
              .map(
                (row) => ({
                  market:
                    row.market,

                  label:
                    row.label,

                  result:
                    row.result,
                })
              ),
        };
      }
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(
          a.date
        ) ||
        b.gameId.localeCompare(
          a.gameId
        )
    )
    .slice(
      0,
      40
    );
}


function buildComboModeLeg(
  backtest:
    ComboRecord[],
  backfill:
    ComboRecord[],
  live:
    ComboRecord[]
) {
  return MODES.flatMap(
    (mode) =>
      LEGS.map(
        (leg) => {
          const bt =
            backtest.filter(
              (row) =>
                row.mode ===
                  mode &&
                row.leg ===
                  leg
            );

          const bf =
            backfill.filter(
              (row) =>
                row.mode ===
                  mode &&
                row.leg ===
                  leg
            );

          const lv =
            live.filter(
              (row) =>
                row.mode ===
                  mode &&
                row.leg ===
                  leg
            );

          return {
            mode,

            leg,

            combined:
              summarizeCombos(
                [
                  ...bt,
                  ...bf,
                  ...lv,
                ]
              ),

            backtest:
              summarizeCombos(
                bt
              ),

            backfill:
              summarizeCombos(
                bf
              ),

            live:
              summarizeCombos(
                lv
              ),
          };
        }
      )
  );
}


function buildRecentCombos(
  rows:
    ComboRecord[]
) {
  return [
    ...rows,
  ]
    .sort(
      (a, b) =>
        b.date.localeCompare(
          a.date
        ) ||
        a.mode.localeCompare(
          b.mode
        ) ||
        a.leg - b.leg
    )
    .slice(
      0,
      60
    )
    .map(
      (row) => ({
        source:
          row.source,

        date:
          row.date,

        mode:
          row.mode,

        leg:
          row.leg,

        odds:
          row.odds,

        result:
          row.result,

        picks:
          row.picks,
      })
    );
}


export async function GET() {
  try {
    const files =
      await fs.readdir(
        DATA_DIR
      );

    const backtestFiles =
      files.filter(
        (name) =>
          /^kbo-engine-stats-v.+-backtest\.json$/
            .test(
              name
            )
      );

    const backtests =
      new Map<
        string,
        any
      >();

    for (
      const name of
      backtestFiles
    ) {
      const data =
        await readJsonSafe(
          path.join(
            DATA_DIR,
            name
          )
        );

      if (
        data?.engineVersion
      ) {
        backtests.set(
          String(
            data.engineVersion
          ),
          data
        );
      }
    }


    const livePickStore =
      await readJsonSafe(
        path.join(
          DATA_DIR,
          "kbo-live-predictions.json"
        )
      );

    const liveComboStore =
      await readJsonSafe(
        path.join(
          DATA_DIR,
          "kbo-live-ai-combos.json"
        )
      );


    /*
      VERIFIED_LEGACY_STATS_V1

      당시 화면/서버 LIVE 저장으로
      실제 검증 가능한 추천픽만 별도 표시한다.

      기존 전체예측 및 AI 조합 통계에는
      절대로 합산하지 않는다.
    */
    const verifiedLegacyStore =
      await readJsonSafe(
        path.join(
          DATA_DIR,
          "kbo-v01-verified-legacy-picks.json"
        )
      );


    const livePickRows =
      Array.isArray(
        livePickStore
          ?.predictions
      )
        ? livePickStore
            .predictions
        : [];

    const liveComboRows =
      Array.isArray(
        liveComboStore
          ?.combos
      )
        ? liveComboStore
            .combos
        : [];


    const verifiedLegacyRows =
      Array.isArray(
        verifiedLegacyStore
          ?.records
      )
        ? verifiedLegacyStore
            .records
        : [];


    const engines =
      [
        ...new Set(
          [
            ...backtests.keys(),

            ...livePickRows.map(
              (row: any) =>
                String(
                  row?.engineVersion ||
                  ""
                )
            ),

            ...liveComboRows.map(
              (row: any) =>
                String(
                  row?.engineVersion ||
                  ""
                )
            ),


            ...verifiedLegacyRows.map(
              (row: any) =>
                String(
                  row?.engineVersion ||
                  ""
                )
            ),
          ].filter(
            Boolean
          )
        ),
      ].sort(
        engineSort
      );


    const reports =
      engines.map(
        (
          engineVersion
        ) => {
          const backtest =
            backtests.get(
              engineVersion
            );

          const btPickRows =
            Array.isArray(
              backtest
                ?.allPredictions
                ?.records
            )
              ? backtest
                  .allPredictions
                  .records
                  .map(
                    normalizeBacktestPick
                  )
                  .filter(
                    (
                      row:
                        PickRecord |
                        null
                    ): row is PickRecord =>
                      Boolean(row)
                  )
              : [];


          const lvPickRows =
            livePickRows
              .filter(
                (
                  row: any
                ) =>
                  String(
                    row
                      ?.engineVersion ||
                    "v0.1"
                  ) ===
                    engineVersion &&
                  row?.scope ===
                    "ALL"
              )
              .map(
                normalizeLivePick
              )
              .filter(
                (
                  row: any
                ): row is PickRecord =>
                  Boolean(row)
              );


          const pureBacktestPickRows =
            btPickRows.filter(
              (
                row:
                  PickRecord
              ) =>
                row.source ===
                "BACKTEST"
            );

          const backfillPickRows =
            btPickRows.filter(
              (
                row:
                  PickRecord
              ) =>
                row.source ===
                "BACKFILL"
            );


          const btComboRows =
            Array.isArray(
              backtest
                ?.aiCombos
                ?.records
            )
              ? backtest
                  .aiCombos
                  .records
                  .map(
                    normalizeBacktestCombo
                  )
                  .filter(
                    (
                      row:
                        ComboRecord |
                        null
                    ): row is ComboRecord =>
                      Boolean(row)
                  )
              : [];


          const lvComboRows =
            liveComboRows
              .filter(
                (
                  row: any
                ) =>
                  String(
                    row
                      ?.engineVersion ||
                    "v0.1"
                  ) ===
                    engineVersion
              )
              .map(
                normalizeLiveCombo
              )
              .filter(
                (
                  row: any
                ): row is ComboRecord =>
                  Boolean(row)
              );


          const pureBacktestComboRows =
            btComboRows.filter(
              (
                row:
                  ComboRecord
              ) =>
                row.source ===
                "BACKTEST"
            );

          const backfillComboRows =
            btComboRows.filter(
              (
                row:
                  ComboRecord
              ) =>
                row.source ===
                "BACKFILL"
            );




          const verifiedRows =
            verifiedLegacyRows
              .filter(
                (
                  row: any
                ) =>
                  String(
                    row?.engineVersion ||
                    "v0.1"
                  ) ===
                    engineVersion
              )
              .map(
                (
                  row: any
                ) => ({
                  engineVersion:
                    String(
                      row?.engineVersion ||
                      engineVersion
                    ),

                  source:
                    String(
                      row?.source ||
                      "VERIFIED_LEGACY"
                    ),

                  scope:
                    String(
                      row?.scope ||
                      "AI_FINAL"
                    ),

                  date:
                    String(
                      row?.date ||
                      ""
                    ),

                  gameId:
                    String(
                      row?.gameId ||
                      ""
                    ),

                  market:
                    String(
                      row?.market ||
                      ""
                    ),

                  label:
                    String(
                      row?.label ||
                      ""
                    ),

                  grade:
                    row?.grade ??
                    null,

                  confidence:
                    typeof row?.confidence ===
                      "number"
                      ? row.confidence
                      : null,

                  ev:
                    typeof row?.ev ===
                      "number"
                      ? row.ev
                      : null,

                  odds:
                    typeof row?.odds ===
                      "number"
                      ? row.odds
                      : null,

                  result:
                    String(
                      row?.result ||
                      "PENDING"
                    ),

                  capturedAt:
                    row?.capturedAt ??
                    null,

                  verification:
                    String(
                      row?.verification ||
                      ""
                    ),
                })
              )
              .filter(
                (
                  row: any
                ) =>
                  Boolean(
                    row.date &&
                    row.gameId &&
                    row.label
                  )
              );


          const verifiedWins =
            verifiedRows.filter(
              (
                row: any
              ) =>
                row.result ===
                "WIN"
            ).length;

          const verifiedLosses =
            verifiedRows.filter(
              (
                row: any
              ) =>
                row.result ===
                "LOSS"
            ).length;

          const verifiedDecided =
            verifiedWins +
            verifiedLosses;

          const verifiedSummary = {
            count:
              verifiedRows.length,

            wins:
              verifiedWins,

            losses:
              verifiedLosses,

            decided:
              verifiedDecided,

            hitRate:
              verifiedDecided
                ? verifiedWins /
                  verifiedDecided
                : null,
          };

          const combinedPicks =
            [
              ...pureBacktestPickRows,
              ...backfillPickRows,
              ...lvPickRows,
            ];

          const combinedCombos =
            [
              ...pureBacktestComboRows,
              ...backfillComboRows,
              ...lvComboRows,
            ];


          const liveDates =
            [
              ...lvPickRows.map(
                (row: any) =>
                  row.date
              ),

              ...lvComboRows.map(
                (row: any) =>
                  row.date
              ),
            ]
              .filter(
                Boolean
              )
              .sort();


          return {
            engineVersion,

            period: {
              backtestStart:
                backtest
                  ?.period
                  ?.start ??
                null,

              backtestEnd:
                backtest
                  ?.period
                  ?.end ??
                null,

              liveStart:
                backtest
                  ?.period
                  ?.liveStart ??
                livePickStore
                  ?.liveStart ??
                liveComboStore
                  ?.liveStart ??
                null,

              lastLiveDate:
                liveDates.length
                  ? liveDates[
                      liveDates.length -
                      1
                    ]
                  : null,
            },


            allPredictions: {
              combined:
                summarizePicks(
                  combinedPicks
                ),

              backtest:
                summarizePicks(
                  pureBacktestPickRows
                ),

              backfill:
                summarizePicks(
                  backfillPickRows
                ),

              live:
                summarizePicks(
                  lvPickRows
                ),

              byMarket:
                buildMarketStats(
                  pureBacktestPickRows,
                  backfillPickRows,
                  lvPickRows
                ),

              byGrade:
                buildGradeStats(
                  pureBacktestPickRows,
                  backfillPickRows,
                  lvPickRows
                ),

              timeline:
                buildTimeline(
                  combinedPicks
                ),

              recentGames:
                buildRecentGames(
                  combinedPicks
                ),
            },


            verifiedLegacy: {
              summary:
                verifiedSummary,

              records:
                [...verifiedRows]
                  .sort(
                    (
                      a: any,
                      b: any
                    ) => {
                      const dateCompare =
                        String(
                          b.date
                        ).localeCompare(
                          String(
                            a.date
                          )
                        );

                      if (
                        dateCompare !==
                        0
                      ) {
                        return dateCompare;
                      }

                      return String(
                        a.label
                      ).localeCompare(
                        String(
                          b.label
                        )
                      );
                    }
                  ),
            },


            aiCombos: {
              combined:
                summarizeCombos(
                  combinedCombos
                ),

              backtest:
                summarizeCombos(
                  pureBacktestComboRows
                ),

              backfill:
                summarizeCombos(
                  backfillComboRows
                ),

              live:
                summarizeCombos(
                  lvComboRows
                ),

              byModeLeg:
                buildComboModeLeg(
                  pureBacktestComboRows,
                  backfillComboRows,
                  lvComboRows
                ),

              recent:
                buildRecentCombos(
                  combinedCombos
                ),
            },
          };
        }
      );


    return NextResponse.json(
      {
        statsRule:
          "ENGINE_STATS_V3",

        generatedAt:
          new Date()
            .toISOString(),

        engines,

        reports,
      },
      {
        headers: {
          "Cache-Control":
            "no-store",
        },
      }
    );

  } catch (
    error
  ) {
    console.error(
      "[stats/report]",
      error
    );

    return NextResponse.json(
      {
        error:
          "통계 데이터를 불러오지 못했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}

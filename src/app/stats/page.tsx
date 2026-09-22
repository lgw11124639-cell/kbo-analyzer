"use client";

import AppSidebar from "../../components/AppSidebar";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import styles from "./stats.module.css";


type Summary = {
  count: number;
  settled: number;
  pending: number;

  wins: number;
  losses: number;

  pushes?: number;
  voids?: number;

  decided: number;

  hitRate:
    | number
    | null;

  returnRate:
    | number
    | null;

  profit: number;
  stake: number;

  averageOdds:
    | number
    | null;

  pickWins?: number;
  pickLosses?: number;
  pickDecided?: number;

  pickHitRate?:
    | number
    | null;
};


type MarketStat = {
  market:
    | "ML"
    | "HANDICAP"
    | "TOTAL";

  combined:
    Summary;

  backtest:
    Summary;

  backfill:
    Summary;

  live:
    Summary;
};


type GradeStat = {
  grade:
    | "A"
    | "B"
    | "C";

  combined:
    Summary;

  backtest:
    Summary;

  backfill:
    Summary;

  live:
    Summary;
};


type TimelineRow =
  Summary & {
    month: string;

    source:
      | "BACKTEST"
      | "BACKFILL"
      | "LIVE";
  };


type GameRow =
  Summary & {
    source:
      | "BACKTEST"
      | "BACKFILL"
      | "LIVE";

    date: string;

    gameId: string;

    awayTeam: string;

    homeTeam: string;

    markets:
      Array<{
        market:
          | "ML"
          | "HANDICAP"
          | "TOTAL";

        label: string;

        result:
          | "PENDING"
          | "WIN"
          | "LOSS"
          | "PUSH"
          | "VOID";
      }>;
  };


type ComboModeLeg = {
  mode:
    | "SAFE"
    | "VALUE"
    | "HIGH_ODDS";

  leg: number;

  combined:
    Summary;

  backtest:
    Summary;

  backfill:
    Summary;

  live:
    Summary;
};


type AiRecentCombo = {
  source:
    | "BACKTEST"
    | "BACKFILL"
    | "LIVE";

  date: string;

  mode:
    | "SAFE"
    | "VALUE"
    | "HIGH_ODDS";

  leg: number;

  odds: number;

  result:
    | "PENDING"
    | "WIN"
    | "LOSS"
    | "VOID";

  picks:
    Array<{
      gameId: string;

      market: string;

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
    }>;
};


type EngineReport = {
  engineVersion:
    string;

  period: {
    backtestStart:
      | string
      | null;

    backtestEnd:
      | string
      | null;

    liveStart:
      | string
      | null;

    lastLiveDate:
      | string
      | null;
  };

  allPredictions: {
    combined:
      Summary;

    backtest:
      Summary;

    backfill:
      Summary;

    live:
      Summary;

    byMarket:
      MarketStat[];

    byGrade:
      GradeStat[];

    timeline:
      TimelineRow[];

    recentGames:
      GameRow[];
  };

  aiCombos: {
    combined:
      Summary;

    backtest:
      Summary;

    backfill:
      Summary;

    live:
      Summary;

    byModeLeg:
      ComboModeLeg[];

    recent:
      AiRecentCombo[];
  };

  /*
    VERIFIED_LEGACY_STATS_V1
    기존 통계와 분리된 실제 검증 기록.
  */
  verifiedLegacy: {
    summary: {
      count: number;
      wins: number;
      losses: number;
      decided: number;
      hitRate:
        | number
        | null;
    };

    records: Array<{
      engineVersion:
        string;

      source:
        string;

      scope:
        string;

      date:
        string;

      gameId:
        string;

      market:
        string;

      label:
        string;

      grade:
        | string
        | null;

      confidence:
        | number
        | null;

      ev:
        | number
        | null;

      odds:
        | number
        | null;

      result:
        string;

      capturedAt:
        | string
        | null;

      verification:
        string;
    }>;
  };
};


type StatsResponse = {
  statsRule: string;

  generatedAt: string;

  engines:
    string[];

  reports:
    EngineReport[];
};


function pct(
  value:
    | number
    | null
    | undefined
) {
  if (
    typeof value !==
      "number" ||
    !Number.isFinite(
      value
    )
  ) {
    return "-";
  }

  return `${(
    value *
    100
  ).toFixed(1)}%`;
}


function signedPct(
  value:
    | number
    | null
    | undefined
) {
  if (
    typeof value !==
      "number" ||
    !Number.isFinite(
      value
    )
  ) {
    return "-";
  }

  const sign =
    value > 0
      ? "+"
      : "";

  return `${sign}${(
    value *
    100
  ).toFixed(1)}%`;
}


function money(
  value:
    | number
    | undefined
) {
  if (
    typeof value !==
    "number"
  ) {
    return "-";
  }

  const sign =
    value > 0
      ? "+"
      : "";

  return (
    `${sign}` +
    `${Math.round(
      value
    ).toLocaleString(
      "ko-KR"
    )}원`
  );
}


function marketName(
  market: string
) {
  if (
    market === "ML"
  ) {
    return "승패";
  }

  if (
    market ===
    "HANDICAP"
  ) {
    return "핸디캡";
  }

  return "오버/언더";
}


function modeName(
  mode: string
) {
  if (
    mode === "SAFE"
  ) {
    return "안전형";
  }

  if (
    mode === "VALUE"
  ) {
    return "가치형";
  }

  return "고배당형";
}


function sourceName(
  source:
    | "BACKTEST"
    | "BACKFILL"
    | "LIVE"
) {
  if (
    source ===
    "BACKTEST"
  ) {
    return "백테스트";
  }

  if (
    source ===
    "BACKFILL"
  ) {
    return "복원";
  }

  return "LIVE";
}


function resultName(
  result: string
) {
  if (
    result === "WIN"
  ) {
    return "적중";
  }

  if (
    result === "LOSS"
  ) {
    return "미적중";
  }

  if (
    result === "PUSH"
  ) {
    return "적특";
  }

  if (
    result === "VOID"
  ) {
    return "무효";
  }

  return "대기";
}


function SummaryBox({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?:
    | "default"
    | "blue"
    | "green"
    | "red";
}) {
  return (
    <article
      className={
        `${styles.summaryBox} ` +
        `${styles[
          `tone${tone
            .charAt(0)
            .toUpperCase()}${tone.slice(1)}`
        ] || ""}`
      }
    >
      <span>
        {label}
      </span>

      <strong>
        {value}
      </strong>

      {sub ? (
        <small>
          {sub}
        </small>
      ) : null}
    </article>
  );
}


function SourceBadge({
  source,
}: {
  source:
    | "BACKTEST"
    | "BACKFILL"
    | "LIVE";
}) {
  return (
    <span
      className={
        source ===
        "LIVE"
          ? styles.liveSource
          : source ===
              "BACKFILL"
            ? styles.backfillSource
            : styles.backtestSource
      }
    >
      {sourceName(
        source
      )}
    </span>
  );
}


export default function StatsPage() {
  const [
    data,
    setData,
  ] =
    useState<
      StatsResponse |
      null
    >(null);

  const [
    selectedEngine,
    setSelectedEngine,
  ] =
    useState(
      "ALL"
    );

  const [
    loading,
    setLoading,
  ] =
    useState(
      true
    );

  const [
    error,
    setError,
  ] =
    useState(
      ""
    );


  const load =
    useCallback(
      async () => {
        setLoading(
          true
        );

        setError(
          ""
        );

        try {
          const response =
            await fetch(
              "/api/stats/report",
              {
                cache:
                  "no-store",
              }
            );

          if (
            !response.ok
          ) {
            throw new Error(
              `통계 API ${response.status}`
            );
          }

          const json:
            StatsResponse =
              await response.json();

          setData(
            json
          );

        } catch (
          e
        ) {
          console.error(
            e
          );

          setError(
            e instanceof
              Error
              ? e.message
              : "통계를 불러오지 못했습니다."
          );

        } finally {
          setLoading(
            false
          );
        }
      },
      []
    );


  useEffect(
    () => {
      void load();
    },
    [
      load,
    ]
  );


  const report =
    useMemo(
      () =>
        data?.reports.find(
          (
            item
          ) =>
            item.engineVersion ===
            selectedEngine
        ) ||
        null,
      [
        data,
        selectedEngine,
      ]
    );


  const overallMarket =
    (
      current:
        EngineReport
    ) => ({
      overall:
        current
          .allPredictions
          .combined,

      ml:
        current
          .allPredictions
          .byMarket
          .find(
            (row) =>
              row.market ===
              "ML"
          )
          ?.combined,

      handicap:
        current
          .allPredictions
          .byMarket
          .find(
            (row) =>
              row.market ===
              "HANDICAP"
          )
          ?.combined,

      total:
        current
          .allPredictions
          .byMarket
          .find(
            (row) =>
              row.market ===
              "TOTAL"
          )
          ?.combined,
    });


  return (
    <main className="shell">
      <AppSidebar
        active="stats"
      />

      <main
        className={
          `content ${styles.main}`
        }
      >
        <header
          className={
            styles.header
          }
        >
          <div>
            <p
              className={
                styles.eyebrow
              }
            >
              KBO ANALYZER PERFORMANCE
            </p>

            <h1>
              엔진 통계 리포트
            </h1>

            <p
              className={
                styles.subtitle
              }
            >
              경기 전체 예측과 AI 추천조합을 엔진 버전별로 백테스트 → LIVE 순서로 누적합니다.
            </p>
          </div>

          <button
            type="button"
            className={
              styles.refreshButton
            }
            onClick={
              () =>
                void load()
            }
            disabled={
              loading
            }
          >
            {loading
              ? "불러오는 중..."
              : "↻ 새로고침"}
          </button>
        </header>


        {error ? (
          <div
            className={
              styles.error
            }
          >
            {error}
          </div>
        ) : null}


        <section
          className={
            styles.engineSelector
          }
        >
          <div
            className={
              styles.engineTabs
            }
          >
            <button
              type="button"
              className={
                selectedEngine ===
                "ALL"
                  ? styles.activeEngine
                  : ""
              }
              onClick={
                () =>
                  setSelectedEngine(
                    "ALL"
                  )
              }
            >
              전체
            </button>

            {(data?.engines ??
              []).map(
              (
                engine
              ) => (
                <button
                  type="button"
                  key={
                    engine
                  }
                  className={
                    selectedEngine ===
                    engine
                      ? styles.activeEngine
                      : ""
                  }
                  onClick={
                    () =>
                      setSelectedEngine(
                        engine
                      )
                  }
                >
                  {engine}
                </button>
              )
            )}
          </div>

          <span>
            엔진이 변경되면 이전 버전 성적은 그대로 보존됩니다.
          </span>
        </section>


        {loading &&
        !data ? (
          <div
            className={
              styles.loadingCard
            }
          >
            통계를 불러오고 있습니다.
          </div>
        ) : null}


        {selectedEngine ===
          "ALL" &&
        data ? (
          <>
            <section
              className={
                styles.sectionCard
              }
            >
              <div
                className={
                  styles.sectionHead
                }
              >
                <div>
                  <span
                    className={
                      styles.sectionBadge
                    }
                  >
                    ENGINE
                  </span>

                  <h2>
                    엔진별 성적 비교
                  </h2>

                  <p>
                    서로 다른 엔진 버전의 성적을 하나로 섞지 않고 각각 비교합니다.
                  </p>
                </div>
              </div>


              <div
                className={
                  styles.engineCompareGrid
                }
              >
                {data.reports.map(
                  (
                    item
                  ) => {
                    const market =
                      overallMarket(
                        item
                      );

                    return (
                      <button
                        type="button"
                        className={
                          styles.engineCompareCard
                        }
                        key={
                          item.engineVersion
                        }
                        onClick={
                          () =>
                            setSelectedEngine(
                              item.engineVersion
                            )
                        }
                      >
                        <div
                          className={
                            styles.engineCompareHead
                          }
                        >
                          <strong>
                            {item.engineVersion}
                          </strong>

                          <span>
                            상세보기 →
                          </span>
                        </div>

                        <div
                          className={
                            styles.engineCompareMain
                          }
                        >
                          <small>
                            전체 예측 적중률
                          </small>

                          <b>
                            {pct(
                              market
                                .overall
                                .hitRate
                            )}
                          </b>
                        </div>

                        <div
                          className={
                            styles.engineMiniGrid
                          }
                        >
                          <div>
                            <span>
                              승패
                            </span>
                            <b>
                              {pct(
                                market
                                  .ml
                                  ?.hitRate
                              )}
                            </b>
                          </div>

                          <div>
                            <span>
                              핸디
                            </span>
                            <b>
                              {pct(
                                market
                                  .handicap
                                  ?.hitRate
                              )}
                            </b>
                          </div>

                          <div>
                            <span>
                              O/U
                            </span>
                            <b>
                              {pct(
                                market
                                  .total
                                  ?.hitRate
                              )}
                            </b>
                          </div>
                        </div>

                        <div
                          className={
                            styles.compareSource
                          }
                        >
                          <span>
                            BT{" "}
                            {
                              item
                                .allPredictions
                                .backtest
                                .count
                            }픽
                          </span>

                          <span>
                            LIVE{" "}
                            {
                              item
                                .allPredictions
                                .live
                                .count
                            }픽
                          </span>
                        </div>


                        <div
                          className={
                            styles.compareAi
                          }
                        >
                          {[
                            "SAFE",
                            "VALUE",
                            "HIGH_ODDS",
                          ].map(
                            (
                              mode
                            ) => (
                              <div
                                key={
                                  mode
                                }
                              >
                                <strong>
                                  {modeName(
                                    mode
                                  )}
                                </strong>

                                <span>
                                  {item
                                    .aiCombos
                                    .byModeLeg
                                    .filter(
                                      (
                                        row
                                      ) =>
                                        row.mode ===
                                        mode
                                    )
                                    .map(
                                      (
                                        row
                                      ) =>
                                        `${row.leg}폴 ${pct(
                                          row
                                            .combined
                                            .hitRate
                                        )}`
                                    )
                                    .join(
                                      " · "
                                    )}
                                </span>
                              </div>
                            )
                          )}
                        </div>
                      </button>
                    );
                  }
                )}
              </div>
            </section>
          </>
        ) : null}


        {selectedEngine !==
          "ALL" &&
        report ? (
          <>
            <section
              className={
                styles.versionBanner
              }
            >
              <div
                className={
                  styles.versionTitle
                }
              >
                <span>
                  ENGINE
                </span>

                <strong>
                  {report.engineVersion}
                </strong>
              </div>

              <div
                className={
                  styles.sourceFlow
                }
              >
                <div>
                  <SourceBadge
                    source="BACKTEST"
                  />

                  <strong>
                    {report.period
                      .backtestStart ??
                      "-"}
                  </strong>

                  <span>
                    ~
                  </span>

                  <strong>
                    {report.period
                      .backtestEnd ??
                      "-"}
                  </strong>
                </div>

                <b>
                  →
                </b>

                <div>
                  <SourceBadge
                    source="LIVE"
                  />

                  <strong>
                    {report.period
                      .liveStart ??
                      "-"}
                  </strong>

                  <span>
                    이후 계속 누적
                  </span>
                </div>
              </div>
            </section>


            <section
              className={
                styles.sectionCard
              }
            >
              <div
                className={
                  styles.sectionHead
                }
              >
                <div>
                  <span
                    className={
                      styles.sectionBadge
                    }
                  >
                    ALL PREDICTIONS
                  </span>

                  <h2>
                    경기 전체 예측 성적
                  </h2>

                  <p>
                    각 경기의 승패 · 핸디캡 · 오버/언더에서 엔진이 선택한 방향을 각각 판정합니다.
                  </p>
                </div>

                <strong
                  className={
                    styles.periodText
                  }
                >
                  BACKTEST → LIVE 누적
                </strong>
              </div>


              <div
                className={
                  styles.summaryGrid
                }
              >
                <SummaryBox
                  label="전체 적중률"
                  value={
                    pct(
                      report
                        .allPredictions
                        .combined
                        .hitRate
                    )
                  }
                  sub={
                    `${report.allPredictions.combined.wins}승 ` +
                    `${report.allPredictions.combined.losses}패`
                  }
                  tone="blue"
                />

                {report
                  .allPredictions
                  .byMarket
                  .map(
                    (
                      row
                    ) => (
                      <SummaryBox
                        key={
                          row.market
                        }
                        label={
                          `${marketName(
                            row.market
                          )} 적중률`
                        }
                        value={
                          pct(
                            row
                              .combined
                              .hitRate
                          )
                        }
                        sub={
                          `${row.combined.wins}승 ` +
                          `${row.combined.losses}패`
                        }
                      />
                    )
                  )}

                <SummaryBox
                  label="수익률(1만원 기준)"
                  value={
                    signedPct(
                      report
                        .allPredictions
                        .combined
                        .returnRate
                    )
                  }
                  sub={
                    money(
                      report
                        .allPredictions
                        .combined
                        .profit
                    )
                  }
                  tone={
                    (
                      report
                        .allPredictions
                        .combined
                        .returnRate ??
                      0
                    ) >= 0
                      ? "green"
                      : "red"
                  }
                />
              </div>


              <div
                className={
                  styles.sourceSplit
                }
              >
                <article>
                  <div>
                    <SourceBadge
                      source="BACKTEST"
                    />

                    <strong>
                      {pct(
                        report
                          .allPredictions
                          .backtest
                          .hitRate
                      )}
                    </strong>
                  </div>

                  <p>
                    {
                      report
                        .allPredictions
                        .backtest
                        .count
                    }픽 ·{" "}
                    {
                      report
                        .allPredictions
                        .backtest
                        .wins
                    }승{" "}
                    {
                      report
                        .allPredictions
                        .backtest
                        .losses
                    }패
                  </p>
                </article>

                <article>
                  <div>
                    <SourceBadge
                      source="BACKFILL"
                    />

                    <strong>
                      {pct(
                        report
                          .allPredictions
                          .backfill
                          .hitRate
                      )}
                    </strong>
                  </div>

                  <p>
                    {
                      report
                        .allPredictions
                        .backfill
                        .count
                    }픽 · 완료{" "}
                    {
                      report
                        .allPredictions
                        .backfill
                        .settled
                    }
                  </p>
                </article>

                <article>
                  <div>
                    <SourceBadge
                      source="LIVE"
                    />

                    <strong>
                      {pct(
                        report
                          .allPredictions
                          .live
                          .hitRate
                      )}
                    </strong>
                  </div>

                  <p>
                    {
                      report
                        .allPredictions
                        .live
                        .count
                    }픽 · 완료{" "}
                    {
                      report
                        .allPredictions
                        .live
                        .settled
                    } · 대기{" "}
                    {
                      report
                        .allPredictions
                        .live
                        .pending
                    }
                  </p>
                </article>
              </div>
            </section>


            <section
              className={
                styles.sectionCard
              }
            >
              <div
                className={
                  styles.sectionHead
                }
              >
                <div>
                  <h2>
                    시장별 상세
                  </h2>

                  <p>
                    적중률과 함께 평균배당 · 손익분기 적중률 · 1만원 고정 ROI를 확인합니다.
                  </p>
                </div>
              </div>


              <div
                className={
                  styles.marketTable
                }
              >
                <div
                  className={
                    styles.marketTableHead
                  }
                >
                  <span>
                    시장
                  </span>
                  <span>
                    누적
                  </span>
                  <span>
                    백테스트
                  </span>
                  <span>
                    LIVE
                  </span>
                  <span>
                    누적 W/L
                  </span>
                  <span>
                    ROI / 배당
                  </span>
                </div>

                {report
                  .allPredictions
                  .byMarket
                  .map(
                    (
                      row
                    ) => (
                      <div
                        className={
                          styles.marketTableRow
                        }
                        key={
                          row.market
                        }
                      >
                        <strong>
                          {marketName(
                            row.market
                          )}
                        </strong>

                        <b>
                          {pct(
                            row
                              .combined
                              .hitRate
                          )}
                        </b>

                        <span>
                          {pct(
                            row
                              .backtest
                              .hitRate
                          )}
                        </span>

                        <span>
                          {pct(
                            row
                              .live
                              .hitRate
                          )}
                          {row.live.decided > 0
                            ? ` (N=${row.live.decided})`
                            : ""}
                        </span>

                        <span>
                          {
                            row
                              .combined
                              .wins
                          }
                          /
                          {
                            row
                              .combined
                              .losses
                          }
                        </span>

                        <span>
                          <b
                            className={
                              (
                                row
                                  .combined
                                  .returnRate ??
                                0
                              ) >= 0
                                ? styles.positive
                                : styles.negative
                            }
                          >
                            {signedPct(
                              row
                                .combined
                                .returnRate
                            )}
                          </b>
                          <small
                            style={{
                              display: "block",
                              marginTop: 4,
                              opacity: 0.72,
                              fontSize: "0.72rem",
                              lineHeight: 1.35,
                            }}
                          >
                            평균배당 {row.combined.averageOdds == null
                              ? "-"
                              : row.combined.averageOdds.toFixed(3)}
                            {row.combined.averageOdds != null && row.combined.averageOdds > 1
                              ? ` · 손익분기 ${(100 / row.combined.averageOdds).toFixed(1)}%`
                              : ""}
                          </small>
                        </span>
                      </div>
                    )
                  )}
              </div>
            </section>


            <section
              className={
                styles.sectionCard
              }
            >
              <div
                className={
                  styles.sectionHead
                }
              >
                <div>
                  <span
                    className={
                      styles.sectionBadge
                    }
                  >
                    GRADE PERFORMANCE
                  </span>

                  <h2>
                    등급별 성적
                  </h2>

                  <p>
                    등급은 경기 전 모델 예측 신뢰도 기준이며, 아래 수치는 각 등급의 사후 실제 적중률 · 평균배당 · 손익분기 적중률 · 1만원 고정 ROI입니다.
                  </p>
                </div>
              </div>


              <div
                className={
                  styles.marketTable
                }
              >
                <div
                  className={
                    styles.marketTableHead
                  }
                >
                  <span>
                    등급
                  </span>

                  <span>
                    누적
                  </span>

                  <span>
                    백테스트
                  </span>

                  <span>
                    LIVE
                  </span>

                  <span>
                    누적 W/L
                  </span>

                  <span>
                    ROI / 배당
                  </span>
                </div>

                {report
                  .allPredictions
                  .byGrade
                  .map(
                    (
                      row
                    ) => (
                      <div
                        className={
                          styles.marketTableRow
                        }
                        key={
                          row.grade
                        }
                      >
                        <strong>
                          {row.grade}등급
                        </strong>

                        <b>
                          {pct(
                            row
                              .combined
                              .hitRate
                          )}
                        </b>

                        <span>
                          {pct(
                            row
                              .backtest
                              .hitRate
                          )}
                        </span>

                        <span>
                          {pct(
                            row
                              .live
                              .hitRate
                          )}
                          {row.live.decided > 0
                            ? ` (N=${row.live.decided})`
                            : ""}
                        </span>

                        <span>
                          {
                            row
                              .combined
                              .wins
                          }
                          /
                          {
                            row
                              .combined
                              .losses
                          }
                        </span>

                        <span>
                          <b
                            className={
                              (
                                row
                                  .combined
                                  .returnRate ??
                                0
                              ) >= 0
                                ? styles.positive
                                : styles.negative
                            }
                          >
                            {signedPct(
                              row
                                .combined
                                .returnRate
                            )}
                          </b>
                          <small
                            style={{
                              display: "block",
                              marginTop: 4,
                              opacity: 0.72,
                              fontSize: "0.72rem",
                              lineHeight: 1.35,
                            }}
                          >
                            평균배당 {row.combined.averageOdds == null
                              ? "-"
                              : row.combined.averageOdds.toFixed(3)}
                            {row.combined.averageOdds != null && row.combined.averageOdds > 1
                              ? ` · 손익분기 ${(100 / row.combined.averageOdds).toFixed(1)}%`
                              : ""}
                          </small>
                        </span>
                      </div>
                    )
                  )}
              </div>
            </section>


            <section
              className={
                styles.sectionCard
              }
            >
              <div
                className={
                  styles.sectionHead
                }
              >
                <div>
                  <span
                    className={
                      styles.sectionBadge
                    }
                  >
                    AI COMBOS
                  </span>

                  <h2>
                    AI 추천픽 성적
                  </h2>

                  <p>
                    실제 안전형 · 가치형 · 고배당형 추천을 2폴부터 5폴까지 각각 집계합니다.
                  </p>
                </div>

                <div
                  className={
                    styles.aiLiveCounter
                  }
                >
                  <span>
                    LIVE 저장
                  </span>

                  <strong>
                    {
                      report
                        .aiCombos
                        .live
                        .count
                    }조합
                  </strong>

                  <small>
                    대기{" "}
                    {
                      report
                        .aiCombos
                        .live
                        .pending
                    }
                  </small>
                </div>
              </div>


              <div
                className={
                  styles.aiModeList
                }
              >
                {[
                  "SAFE",
                  "VALUE",
                  "HIGH_ODDS",
                ].map(
                  (
                    mode
                  ) => (
                    <section
                      className={
                        styles.aiModeSection
                      }
                      key={
                        mode
                      }
                    >
                      <div
                        className={
                          styles.aiModeHead
                        }
                      >
                        <strong>
                          {modeName(
                            mode
                          )}
                        </strong>

                        <span>
                          {mode ===
                          "SAFE"
                            ? "적중확률 중심"
                            : mode ===
                                "VALUE"
                              ? "승률 + EV + 배당가치"
                              : "고배당 + 품질"}
                        </span>
                      </div>

                      <div
                        className={
                          styles.comboGrid
                        }
                      >
                        {report
                          .aiCombos
                          .byModeLeg
                          .filter(
                            (
                              row
                            ) =>
                              row.mode ===
                              mode
                          )
                          .map(
                            (
                              row
                            ) => (
                              <article
                                className={
                                  styles.comboCard
                                }
                                key={
                                  `${row.mode}:${row.leg}`
                                }
                              >
                                <div
                                  className={
                                    styles.comboCardHead
                                  }
                                >
                                  <strong>
                                    {row.leg}폴
                                  </strong>

                                  <span>
                                    평균배당{" "}
                                    {row
                                      .combined
                                      .averageOdds ===
                                    null
                                      ? "-"
                                      : row
                                          .combined
                                          .averageOdds
                                          ?.toFixed(
                                            2
                                          )}
                                  </span>
                                </div>

                                <div
                                  className={
                                    styles.comboHit
                                  }
                                >
                                  <small>
                                    조합 적중률
                                  </small>

                                  <b>
                                    {pct(
                                      row
                                        .combined
                                        .hitRate
                                    )}
                                  </b>
                                </div>

                                <div
                                  className={
                                    styles.comboMeta
                                  }
                                >
                                  <span>
                                    BT{" "}
                                    {pct(
                                      row
                                        .backtest
                                        .hitRate
                                    )}
                                  </span>

                                  <span>
                                    BF{" "}
                                    {pct(
                                      row
                                        .backfill
                                        .hitRate
                                    )}
                                  </span>

                                  <span>
                                    LIVE{" "}
                                    {pct(
                                      row
                                        .live
                                        .hitRate
                                    )}
                                  </span>

                                  <span>
                                    픽 적중{" "}
                                    {pct(
                                      row
                                        .combined
                                        .pickHitRate
                                    )}
                                  </span>
                                </div>

                                <div
                                  className={
                                    styles.comboFooter
                                  }
                                >
                                  <span>
                                    {
                                      row
                                        .combined
                                        .wins
                                    }
                                    /
                                    {
                                      row
                                        .combined
                                        .decided
                                    } 적중
                                  </span>

                                  <strong
                                    className={
                                      (
                                        row
                                          .combined
                                          .returnRate ??
                                        0
                                      ) >=
                                      0
                                        ? styles.positive
                                        : styles.negative
                                    }
                                  >
                                    수익률{" "}
                                    {signedPct(
                                      row
                                        .combined
                                        .returnRate
                                    )}
                                  </strong>
                                </div>
                              </article>
                            )
                          )}
                      </div>
                    </section>
                  )
                )}
              </div>


              <div
                className={
                  styles.aiResultSection
                }
              >
                <div
                  className={
                    styles.aiResultHead
                  }
                >
                  <div>
                    <strong>
                      AI 추천 결과
                    </strong>

                    <span>
                      조합 전체와 구성 픽별 적중 · 미적중
                    </span>
                  </div>
                </div>

                <div
                  className={
                    styles.aiResultList
                  }
                >
                  {report
                    .aiCombos
                    .recent
                    .map(
                      (
                        combo,
                        index
                      ) => (
                        <article
                          className={
                            styles.aiResultCard
                          }
                          key={
                            `${combo.source}:${combo.date}:${combo.mode}:${combo.leg}:${index}`
                          }
                        >
                          <div
                            className={
                              styles.aiResultTop
                            }
                          >
                            <div>
                              <SourceBadge
                                source={
                                  combo.source
                                }
                              />

                              <span>
                                {combo.date}
                              </span>

                              <strong>
                                {modeName(
                                  combo.mode
                                )} {combo.leg}폴
                              </strong>
                            </div>

                            <span
                              className={
                                combo.result ===
                                "WIN"
                                  ? styles.aiComboWin
                                  : combo.result ===
                                      "LOSS"
                                    ? styles.aiComboLoss
                                    : styles.aiComboPending
                              }
                            >
                              {resultName(
                                combo.result
                              )}
                            </span>
                          </div>

                          <div
                            className={
                              styles.aiResultPicks
                            }
                          >
                            {combo.picks.map(
                              (
                                pick,
                                pickIndex
                              ) => (
                                <div
                                  key={
                                    `${pick.gameId}:${pick.market}:${pick.label}:${pickIndex}`
                                  }
                                >
                                  <span
                                    className={
                                      styles.aiPickLabel
                                    }
                                  >
                                    {pick.label}
                                  </span>

                                  <span
                                    className={
                                      pick.result ===
                                      "WIN"
                                        ? styles.resultWin
                                        : pick.result ===
                                            "LOSS"
                                          ? styles.resultLoss
                                          : styles.resultNeutral
                                    }
                                  >
                                    {resultName(
                                      pick.result
                                    )}
                                  </span>
                                </div>
                              )
                            )}
                          </div>
                        </article>
                      )
                    )}
                </div>
              </div>
            </section>


            {/* VERIFIED_LEGACY_STATS_V1 */}
            <section
              className={
                styles.sectionCard
              }
            >
              <div
                className={
                  styles.sectionHead
                }
              >
                <div>
                  <span
                    className={
                      styles.sectionBadge
                    }
                  >
                    VERIFIED PICKS
                  </span>

                  <h2>
                    검증된 당시 추천픽
                  </h2>

                  <p>
                    과거 재계산값이 아니라 당시 화면 또는 서버 LIVE 저장으로 확인된 추천만 별도로 표시합니다.
                  </p>
                </div>

                <div
                  className={
                    styles.aiLiveCounter
                  }
                >
                  <span>
                    검증 기록
                  </span>

                  <strong>
                    {
                      report
                        .verifiedLegacy
                        .summary
                        .wins
                    }
                    /
                    {
                      report
                        .verifiedLegacy
                        .summary
                        .decided
                    }
                  </strong>

                  <small>
                    적중률{" "}
                    {pct(
                      report
                        .verifiedLegacy
                        .summary
                        .hitRate
                    )}
                  </small>
                </div>
              </div>


              <div
                className={
                  styles.aiResultSection
                }
              >
                <div
                  className={
                    styles.aiResultList
                  }
                >
                  {[
                    ...new Set(
                      report
                        .verifiedLegacy
                        .records
                        .map(
                          (
                            row
                          ) =>
                            row.date
                        )
                    ),
                  ].map(
                    (
                      date
                    ) => {
                      const rows =
                        report
                          .verifiedLegacy
                          .records
                          .filter(
                            (
                              row
                            ) =>
                              row.date ===
                              date
                          );

                      const wins =
                        rows.filter(
                          (
                            row
                          ) =>
                            row.result ===
                            "WIN"
                        ).length;

                      const losses =
                        rows.filter(
                          (
                            row
                          ) =>
                            row.result ===
                            "LOSS"
                        ).length;

                      const decided =
                        wins +
                        losses;

                      return (
                        <article
                          className={
                            styles.aiResultCard
                          }
                          key={
                            date
                          }
                        >
                          <div
                            className={
                              styles.aiResultTop
                            }
                          >
                            <div>
                              <span>
                                검증 원본
                              </span>

                              <span>
                                {date}
                              </span>

                              <strong>
                                {rows.length}픽
                              </strong>
                            </div>

                            <span
                              className={
                                losses ===
                                0 &&
                                decided >
                                0
                                  ? styles.aiComboWin
                                  : losses >
                                      0
                                    ? styles.aiComboLoss
                                    : styles.aiComboPending
                              }
                            >
                              {decided >
                              0
                                ? `${wins}/${decided} 적중`
                                : "대기"}
                            </span>
                          </div>


                          <div
                            className={
                              styles.aiResultPicks
                            }
                          >
                            {rows.map(
                              (
                                pick,
                                pickIndex
                              ) => (
                                <div
                                  key={
                                    `${pick.gameId}:${pick.market}:${pick.label}:${pickIndex}`
                                  }
                                >
                                  <span
                                    className={
                                      styles.aiPickLabel
                                    }
                                  >
                                    {pick.label}

                                    {typeof pick.odds ===
                                      "number" &&
                                    Number.isFinite(
                                      pick.odds
                                    )
                                      ? ` · ${pick.odds.toFixed(
                                          3
                                        )}`
                                      : ""}
                                  </span>

                                  <span
                                    className={
                                      pick.result ===
                                      "WIN"
                                        ? styles.resultWin
                                        : pick.result ===
                                            "LOSS"
                                          ? styles.resultLoss
                                          : styles.resultNeutral
                                    }
                                  >
                                    {resultName(
                                      pick.result
                                    )}
                                  </span>
                                </div>
                              )
                            )}
                          </div>
                        </article>
                      );
                    }
                  )}
                </div>
              </div>
            </section>


            <div
              className={
                styles.twoColumn
              }
            >
              <section
                className={
                  styles.sectionCard
                }
              >
                <div
                  className={
                    styles.sectionHead
                  }
                >
                  <div>
                    <h2>
                      성적 흐름
                    </h2>

                    <p>
                      백테스트 구간 뒤에 LIVE 성적이 시간순으로 이어집니다.
                    </p>
                  </div>
                </div>

                <div
                  className={
                    styles.timelineList
                  }
                >
                  {report
                    .allPredictions
                    .timeline
                    .map(
                      (
                        row,
                        index
                      ) => (
                        <div
                          className={
                            styles.timelineRow
                          }
                          key={
                            `${row.month}:${row.source}:${index}`
                          }
                        >
                          <SourceBadge
                            source={
                              row.source
                            }
                          />

                          <strong>
                            {row.month}
                          </strong>

                          <span>
                            {row.count}픽
                          </span>

                          <b>
                            {pct(
                              row.hitRate
                            )}
                          </b>

                          <span
                            className={
                              (
                                row.returnRate ??
                                0
                              ) >= 0
                                ? styles.positive
                                : styles.negative
                            }
                          >
                            {signedPct(
                              row.returnRate
                            )}
                          </span>
                        </div>
                      )
                    )}
                </div>
              </section>


              <section
                className={
                  styles.sectionCard
                }
              >
                <div
                  className={
                    styles.sectionHead
                  }
                >
                  <div>
                    <h2>
                      경기별 전체 예측 적중률
                    </h2>

                    <p>
                      한 경기의 승패 · 핸디 · 오버언더 결과를 합산한 적중률입니다.
                    </p>
                  </div>
                </div>

                <div
                  className={
                    styles.gameList
                  }
                >
                  {report
                    .allPredictions
                    .recentGames
                    .map(
                      (
                        game
                      ) => (
                        <article
                          className={
                            styles.gameRow
                          }
                          key={
                            `${game.source}:${game.date}:${game.gameId}`
                          }
                        >
                          <div
                            className={
                              styles.gameMain
                            }
                          >
                            <div>
                              <SourceBadge
                                source={
                                  game.source
                                }
                              />

                              <span>
                                {game.date}
                              </span>
                            </div>

                            <strong>
                              {game.awayTeam} @ {game.homeTeam}
                            </strong>
                          </div>

                          <div
                            className={
                              styles.gameMarkets
                            }
                          >
                            {game.markets.map(
                              (
                                market
                              ) => (
                                <span
                                  key={
                                    `${market.market}:${market.label}`
                                  }
                                  className={
                                    market.result ===
                                    "WIN"
                                      ? styles.resultWin
                                      : market.result ===
                                          "LOSS"
                                        ? styles.resultLoss
                                        : styles.resultNeutral
                                  }
                                >
                                  {marketName(
                                    market.market
                                  )}
                                  {" "}
                                  {resultName(
                                    market.result
                                  )}
                                </span>
                              )
                            )}
                          </div>

                          <div
                            className={
                              styles.gameRate
                            }
                          >
                            <strong>
                              {pct(
                                game.hitRate
                              )}
                            </strong>

                            <small>
                              {game.wins}/{game.decided}
                            </small>
                          </div>
                        </article>
                      )
                    )}
                </div>
              </section>
            </div>


            <div
              className={
                styles.ruleNotice
              }
            >
              <strong>
                집계 기준
              </strong>

              <span>
                적중률 = WIN ÷ (WIN + LOSS), 적특·무효는 적중률 분모에서 제외합니다.
                수익률은 각 단일 예측 또는 각 AI 조합에 10,000원씩 동일하게 베팅한 기준입니다.
                LIVE 대기 건은 수익률에 포함하지 않습니다.
              </span>
            </div>
          </>
        ) : null}
      </main>
    </main>
  );
}

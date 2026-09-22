import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

async function readJson(name: string, fallback: any) {
  try { return JSON.parse(await fs.readFile(path.join(process.cwd(), "data", name), "utf8")); }
  catch { return fallback; }
}

function text(v: any) { return String(v ?? "").trim(); }
function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function team(v: any) {
  const raw = text(v).replace(/\s+/g, "");
  const aliases: Record<string, string> = {
    LG:"LG", LG트윈스:"LG",
    삼성:"삼성", 삼성라이온즈:"삼성", SS:"삼성",
    두산:"두산", 두산베어스:"두산", OB:"두산",
    롯데:"롯데", 롯데자이언츠:"롯데", LT:"롯데",
    한화:"한화", 한화이글스:"한화", HH:"한화",
    KIA:"KIA", 기아:"KIA", KIA타이거즈:"KIA", HT:"KIA",
    KT:"KT", KT위즈:"KT",
    NC:"NC", NC다이노스:"NC",
    SSG:"SSG", SSG랜더스:"SSG", SK:"SSG",
    키움:"키움", 키움히어로즈:"키움", WO:"키움",
  };
  return aliases[raw] || raw.replace(/트윈스|라이온즈|베어스|자이언츠|이글스|타이거즈|위즈|다이노스|랜더스|히어로즈/g, "");
}

function gameKey(date: any, gameId: any) { return text(date) + "|" + text(gameId); }
function matchKey(date: any, away: any, home: any) { return text(date) + "|" + team(away) + "|" + team(home); }
function awayOf(x: any) { return x?.awayTeam ?? x?.awayTeamName ?? x?.away ?? null; }
function homeOf(x: any) { return x?.homeTeam ?? x?.homeTeamName ?? x?.home ?? null; }

function addArray(map: Map<string, any[]>, key: string, row: any) {
  if (!key || key.endsWith("||")) return;
  const rows = map.get(key) || [];
  rows.push(row);
  map.set(key, rows);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const year = text(url.searchParams.get("year") || "2026");
  const month = text(url.searchParams.get("month"));
  const requestedGameId = text(url.searchParams.get("gameId"));

  const [betman, predictions, recoveredAi, oddsHistory, lineups] = await Promise.all([
    readJson("betman-kbo-history-2026.json", { games: [] }),
    readJson("kbo-live-predictions.json", { predictions: [] }),
    readJson("kbo-recovered-ai-history-2026.json", { predictions: [] }),
    readJson("kbo-odds-history.json", { snapshots: [] }),
    readJson("kbo-historical-lineup-stats-2026.json", { snapshots: [] }),
  ]);

  const betmanGames = Array.isArray(betman?.games) ? betman.games : [];
  const predictionRows = Array.isArray(predictions?.predictions) ? predictions.predictions : [];
  const recoveredRows = Array.isArray(recoveredAi?.predictions) ? recoveredAi.predictions : [];
  const oddsRows = Array.isArray(oddsHistory?.snapshots) ? oddsHistory.snapshots : [];
  const lineupRows = Array.isArray(lineups?.snapshots) ? lineups.snapshots : [];

  const predById = new Map<string, any[]>();
  const predByMatch = new Map<string, any[]>();
  for (const row of predictionRows) {
    addArray(predById, gameKey(row?.date, row?.gameId), row);
    if (awayOf(row) && homeOf(row)) addArray(predByMatch, matchKey(row?.date, awayOf(row), homeOf(row)), row);
  }

  /*
   * HISTORY_RECOVERED_AI_V6
   *
   * 실제 경기 전에 저장된 AI(predictionRows)가 항상 우선이다.
   * recoveredRows는 원본이 없는 과거 경기의 표시용 복구본이다.
   * 복구본은 원본 성과 통계와 섞지 않는다.
   */
  const recoveredById = new Map<string, any[]>();
  const recoveredByMatch = new Map<string, any[]>();

  for (const row of recoveredRows) {
    addArray(
      recoveredById,
      gameKey(row?.date, row?.gameId),
      row
    );

    if (awayOf(row) && homeOf(row)) {
      addArray(
        recoveredByMatch,
        matchKey(
          row?.date,
          awayOf(row),
          homeOf(row)
        ),
        row
      );
    }
  }

  const oddsById = new Map<string, any[]>();
  const oddsByMatch = new Map<string, any[]>();
  for (const row of oddsRows) {
    addArray(oddsById, gameKey(row?.date, row?.gameId), row);
    if (awayOf(row) && homeOf(row)) addArray(oddsByMatch, matchKey(row?.date, awayOf(row), homeOf(row)), row);
  }

  const lineupById = new Map<string, any>();
  const lineupByMatch = new Map<string, any>();
  for (const row of lineupRows) {
    const idKey = gameKey(row?.date, row?.gameId);
    const prevId = lineupById.get(idKey);
    if (!prevId || (!prevId?.confirmed && row?.confirmed)) lineupById.set(idKey, row);
    if (awayOf(row) && homeOf(row)) {
      const mk = matchKey(row?.date, awayOf(row), homeOf(row));
      const prevMatch = lineupByMatch.get(mk);
      const prevCount = (prevMatch?.away?.lineup?.length ?? prevMatch?.away?.players?.length ?? 0) + (prevMatch?.home?.lineup?.length ?? prevMatch?.home?.players?.length ?? 0); const rowCount = (row?.away?.lineup?.length ?? row?.away?.players?.length ?? 0) + (row?.home?.lineup?.length ?? row?.home?.players?.length ?? 0); if (!prevMatch || rowCount > prevCount || (rowCount === prevCount && !prevMatch?.confirmed && row?.confirmed)) lineupByMatch.set(mk, row);
    }
  }

  const seen = new Set<string>();
  const games = betmanGames
    .filter((g: any) => {
      const date = text(g?.date);
      if (!date.startsWith(year + "-")) return false;
      if (month && !date.startsWith(year + "-" + month.padStart(2, "0") + "-")) return false;
      if (g?.actualScore == null || g?.canceled) return false;
      const mk = matchKey(date, g?.awayTeam, g?.homeTeam);
      if (seen.has(mk)) return false;
      seen.add(mk);
      return true;
    })
    .map((g: any) => {
      const date = text(g?.date);
      const betmanId = text(g?.id);
      const mk = matchKey(date, g?.awayTeam, g?.homeTeam);

      const matchOdds = (oddsByMatch.get(mk) || []).slice().sort((a: any,b: any) => text(a?.capturedAt).localeCompare(text(b?.capturedAt)));
      const lastOdds = matchOdds.length ? matchOdds[matchOdds.length - 1] : null;
      const resolvedGameId = text(lastOdds?.gameId) || text((lineupByMatch.get(mk) || {})?.gameId) || betmanId;
      const idKey = gameKey(date, resolvedGameId);

      const originalFrozen = (
        predById.get(idKey) ||
        predByMatch.get(mk) ||
        []
      )
        .filter((p: any) =>
          ["ML","HANDICAP","TOTAL"].includes(
            text(p?.market)
          )
        )
        .slice()
        .sort((a: any,b: any) =>
          text(a?.capturedAt).localeCompare(
            text(b?.capturedAt)
          )
        );

      const recoveredFrozen = (
        recoveredById.get(idKey) ||
        recoveredByMatch.get(mk) ||
        []
      )
        .filter((p: any) =>
          ["ML","HANDICAP","TOTAL"].includes(
            text(p?.market)
          )
        )
        .slice();

      /*
       * ORIGINAL_PREGAME always wins.
       * RECOVERED is used only when no genuine
       * pregame snapshot exists for this game.
       */
      const usingRecoveredAi =
        originalFrozen.length === 0 &&
        recoveredFrozen.length > 0;

      const frozen =
        originalFrozen.length > 0
          ? originalFrozen
          : recoveredFrozen;

      const latestByMarket = new Map<string, any>();

      for (const p of frozen) {
        latestByMarket.set(
          text(p?.market),
          p
        );
      }

      const idOdds = (oddsById.get(idKey) || []).slice().sort((a: any,b: any) => text(a?.capturedAt).localeCompare(text(b?.capturedAt)));
      const finalOdds = idOdds.length ? idOdds[idOdds.length - 1] : lastOdds;
      const lineup = lineupById.get(idKey) || lineupByMatch.get(mk) || null;

      let awayScore: number | null = null;
      let homeScore: number | null = null;
      const score = g?.actualScore;
      if (Array.isArray(score) && score.length >= 2) { awayScore = num(score[0]); homeScore = num(score[1]); }
      else if (score && typeof score === "object") { awayScore = num(score.away ?? score.awayScore); homeScore = num(score.home ?? score.homeScore); }
      else if (typeof score === "string") { const m = score.match(/(\d+)\D+(\d+)/); if (m) { awayScore = num(m[1]); homeScore = num(m[2]); } }

      const picks = Array.from(
        latestByMarket.values()
      ).map((p: any) => ({
        market: text(p?.market),
        label: text(p?.label),
        grade: text(p?.grade),

        confidence: num(p?.confidence),
        ev: num(p?.ev),
        odds: num(p?.odds),

        starterEdge: num(p?.starterEdge),
        formEdge: num(p?.formEdge),
        bullpenEdge: num(p?.bullpenEdge),
        lineupEdge: num(p?.lineupEdge),
        projectedTotal: num(p?.projectedTotal),
        totalLine: num(p?.totalLine),
        totalEdge: num(p?.totalEdge),

        /*
         * 결과는 genuine stored prediction에만 존재한다.
         * recovered snapshot 자체에는 결과를 저장하지 않는다.
         */
        result: usingRecoveredAi
          ? null
          : text(p?.result) || null,

        capturedAt: usingRecoveredAi
          ? text(p?.recovery?.recoveredAt) || null
          : text(p?.capturedAt) || null,

        settledAt: usingRecoveredAi
          ? null
          : text(p?.settledAt) || null,

        recovered: usingRecoveredAi,

        recoverySource: usingRecoveredAi
          ? text(p?.recovery?.source) || null
          : null,

        recoveryNotice: usingRecoveredAi
          ? text(p?.recovery?.notice) ||
            "당시 저장본 유실로 인해 과거 경기 전 데이터로 복원된 AI 분석입니다."
          : null,

        originalPregameSnapshot:
          !usingRecoveredAi,
      }));

      /*
       * HISTORY_FEEDBACK_V1
       * 저장된 경기 전 AI 픽의 정산 결과만 사용한다.
       * 과거 경기를 현재 모델로 재계산하지 않는다.
       */
      /*
       * HISTORY_RECOVERED_SETTLEMENT_V7
       *
       * recovered JSON에는 경기 결과를 저장하지 않는다.
       * History 응답을 만드는 시점에만 최종 스코어와
       * 당시 저장된 베트맨 기준점으로 사후 판정한다.
       *
       * 이 값은 UI/피드백 전용이며 AI 입력으로 사용하지 않는다.
       */
      /* HISTORY_TEAM_NAME_NORMALIZE_V8 */
      const historyTeamKey = (value: any) => {
        const v = text(value).replace(/\s+/g, "");
        const aliases: Array<[string,string]> = [["KIA","KIA"],["기아","KIA"],["타이거즈","KIA"],["삼성","삼성"],["라이온즈","삼성"],["LG","LG"],["엘지","LG"],["트윈스","LG"],["두산","두산"],["베어스","두산"],["KT","KT"],["케이티","KT"],["위즈","KT"],["SSG","SSG"],["랜더스","SSG"],["롯데","롯데"],["자이언츠","롯데"],["한화","한화"],["이글스","한화"],["NC","NC"],["엔씨","NC"],["다이노스","NC"],["키움","키움"],["히어로즈","키움"]];
        for (const [alias,key] of aliases) if (v.toUpperCase().includes(alias.toUpperCase())) return key;
        return v;
      };

      const historyLabelTeamKey = (label: any) => historyTeamKey(text(label).split(/\s+/)[0]);

      const settleRecoveredHistoryPick = (
        pick: any
      ): "WIN" | "LOSS" | "PUSH" | null => {
        if (
          !usingRecoveredAi ||
          awayScore == null ||
          homeScore == null
        ) {
          return null;
        }

        const market = text(pick?.market);
        const label = text(pick?.label);

        if (market === "ML") {
          if (awayScore === homeScore) {
            return "PUSH";
          }

          const awayWon =
            awayScore > homeScore;

          const pickedTeam = historyLabelTeamKey(label);
          const pickedAway = pickedTeam === historyTeamKey(g?.awayTeam);
          const pickedHome = pickedTeam === historyTeamKey(g?.homeTeam);

          if (!pickedAway && !pickedHome) {
            return null;
          }

          return (
            (pickedAway && awayWon) ||
            (pickedHome && !awayWon)
          )
            ? "WIN"
            : "LOSS";
        }

        if (market === "HANDICAP") {
          const nums =
            label.match(/[+-]?\d+(?:\.\d+)?/g);

          const line =
            nums?.length
              ? Number(nums[nums.length - 1])
              : null;

          if (
            line == null ||
            !Number.isFinite(line)
          ) {
            return null;
          }

          const pickedTeam = historyLabelTeamKey(label);
          const pickedAway = pickedTeam === historyTeamKey(g?.awayTeam);
          const pickedHome = pickedTeam === historyTeamKey(g?.homeTeam);

          if (!pickedAway && !pickedHome) {
            return null;
          }

          const adjusted =
            pickedAway
              ? awayScore + line - homeScore
              : homeScore + line - awayScore;

          if (adjusted === 0) {
            return "PUSH";
          }

          return adjusted > 0
            ? "WIN"
            : "LOSS";
        }

        if (market === "TOTAL") {
          const nums =
            label.match(/\d+(?:\.\d+)?/g);

          const labelLine =
            nums?.length
              ? Number(nums[nums.length - 1])
              : null;

          const line =
            labelLine != null &&
            Number.isFinite(labelLine)
              ? labelLine
              : num(
                  pick?.totalLine ??
                  finalOdds?.totalLine
                );

          if (
            line == null ||
            !Number.isFinite(line)
          ) {
            return null;
          }

          const total =
            awayScore + homeScore;

          if (total === line) {
            return "PUSH";
          }

          if (label.startsWith("오버")) {
            return total > line
              ? "WIN"
              : "LOSS";
          }

          if (label.startsWith("언더")) {
            return total < line
              ? "WIN"
              : "LOSS";
          }

          return null;
        }

        return null;
      };

      const feedbackPicks = picks.map(
        (pick: any) => {
          if (!usingRecoveredAi) {
            return pick;
          }

          return {
            ...pick,
            result:
              settleRecoveredHistoryPick(
                pick
              ),
          };
        }
      );

      const settledPicks =
        feedbackPicks.filter((p: any) =>
          ["WIN","LOSS","PUSH"].includes(
            text(p?.result).toUpperCase()
          )
        );

      const winCount = settledPicks.filter(
        (p: any) => text(p?.result).toUpperCase() === "WIN"
      ).length;

      const lossCount = settledPicks.filter(
        (p: any) => text(p?.result).toUpperCase() === "LOSS"
      ).length;

      const pushCount = settledPicks.filter(
        (p: any) => text(p?.result).toUpperCase() === "PUSH"
      ).length;

      const hitRate =
        winCount + lossCount > 0
          ? Math.round((winCount / (winCount + lossCount)) * 1000) / 10
          : null;

      const marketName = (market: string) => {
        if (market === "ML") return "승패";
        if (market === "HANDICAP") return "핸디캡";
        if (market === "TOTAL") return "언더오버";
        return market || "AI 픽";
      };

      const feedbackItems = feedbackPicks.map((pick: any) => {
        const result = text(pick?.result).toUpperCase();

        let verdict = "대기";
        if (result === "WIN") verdict = "적중";
        else if (result === "LOSS") verdict = "미적중";
        else if (result === "PUSH") verdict = "적특";

        const confidence =
          typeof pick?.confidence === "number"
            ? pick.confidence
            : null;

        let message = "";

        if (result === "WIN") {
          message =
            `${marketName(text(pick?.market))} 예측 '${text(pick?.label)}'이 실제 경기 결과와 일치했습니다.`;
        } else if (result === "LOSS") {
          message =
            `${marketName(text(pick?.market))} 예측 '${text(pick?.label)}'이 실제 경기 결과와 일치하지 않았습니다.`;
        } else if (result === "PUSH") {
          message =
            `${marketName(text(pick?.market))} 예측 '${text(pick?.label)}'은 기준점과 실제 결과가 같아 적특 처리됐습니다.`;
        } else {
          message =
            `${marketName(text(pick?.market))} 예측 '${text(pick?.label)}'의 정산 결과가 저장되지 않았습니다.`;
        }

        return {
          market: text(pick?.market),
          marketName: marketName(text(pick?.market)),
          label: text(pick?.label),
          verdict,
          result: result || null,
          confidence,
          confidencePct:
            confidence == null
              ? null
              : Math.round(
                  (confidence <= 1 ? confidence * 100 : confidence) * 10
                ) / 10,
          odds: pick?.odds ?? null,
          grade: text(pick?.grade) || null,
          ev: pick?.ev ?? null,
          message,
        };
      });

      let overallVerdict = "NO_AI";
      let overallMessage =
        "당시 저장된 AI 분석이 없어 현재 모델로 과거 예측을 재계산하지 않습니다.";

      if (
        usingRecoveredAi &&
        settledPicks.length > 0
      ) {
        if (
          lossCount === 0 &&
          winCount > 0
        ) {
          overallVerdict =
            "RECOVERED_ALL_HIT";
        } else if (
          winCount === 0 &&
          lossCount > 0
        ) {
          overallVerdict =
            "RECOVERED_ALL_MISS";
        } else {
          overallVerdict =
            "RECOVERED_MIXED";
        }

        overallMessage =
          `복구 AI ${settledPicks.length}개 픽 사후 판정: ` +
          `${winCount}개 적중, ${lossCount}개 미적중` +
          `${pushCount ? `, ${pushCount}개 적특` : ""}. ` +
          `이 결과는 복구 AI 성과 통계에는 반영하지 않습니다.`;
      } else if (
        usingRecoveredAi &&
        picks.length > 0
      ) {
        overallVerdict =
          "RECOVERED_AI";

        overallMessage =
          "당시 저장본 유실로 인해 과거 경기 전 데이터로 복원된 AI 분석입니다. 복구본은 원본 AI 성과 통계에 포함하지 않습니다.";
      } else if (
        picks.length > 0 &&
        settledPicks.length === 0
      ) {
        overallVerdict = "UNSETTLED";
        overallMessage =
          "당시 AI 예측은 저장되어 있지만 정산 결과가 아직 없습니다.";
      } else if (settledPicks.length > 0) {
        if (lossCount === 0 && winCount > 0) {
          overallVerdict = "ALL_HIT";
          overallMessage =
            `저장된 AI 픽 ${settledPicks.length}개 중 ${winCount}개가 적중했습니다.`;
        } else if (winCount === 0 && lossCount > 0) {
          overallVerdict = "ALL_MISS";
          overallMessage =
            `저장된 AI 픽 ${settledPicks.length}개 중 ${lossCount}개가 미적중했습니다.`;
        } else {
          overallVerdict = "MIXED";
          overallMessage =
            `저장된 AI 픽 ${settledPicks.length}개 중 ${winCount}개 적중, ${lossCount}개 미적중${pushCount ? `, ${pushCount}개 적특` : ""}입니다.`;
        }
      }

      const feedback = {
        available: picks.length > 0,
        settled: settledPicks.length > 0,
        overallVerdict,
        overallMessage,
        totalPicks: picks.length,
        settledPicks: settledPicks.length,
        wins: winCount,
        losses: lossCount,
        pushes: pushCount,
        hitRate,
        finalScore: {
          away: awayScore,
          home: homeScore,
          total:
            awayScore != null && homeScore != null
              ? awayScore + homeScore
              : null,
        },
        items: feedbackItems,
        generatedFrom: usingRecoveredAi
          ? "RECOVERED_HISTORICAL_PREGAME_FEATURES"
          : "STORED_PREGAME_AI_AND_SETTLED_RESULT",

        recalculated: false,

        recovered: usingRecoveredAi,

        originalPregameSnapshot:
          !usingRecoveredAi,

        postgameSettlementOnly:
          usingRecoveredAi,

        excludedFromOriginalPerformanceStats:
          usingRecoveredAi,
      };

      return {
        gameId: resolvedGameId, betmanId, date,
        commenceTime:g?.commenceTime ?? null, stadium:g?.stadium ?? null,
        awayTeamName:text(g?.awayTeam), homeTeamName:text(g?.homeTeam),
        awayScore, homeScore, finalScoreRaw:g?.actualScore ?? null,
        ai:{
          frozen: picks.length > 0,
          picks,

          recovered: usingRecoveredAi,

          originalPregameSnapshot:
            picks.length > 0
              ? !usingRecoveredAi
              : false,

          source: picks.length
            ? usingRecoveredAi
              ? "kbo-recovered-ai-history-2026"
              : "kbo-live-predictions"
            : null,

          label: picks.length
            ? usingRecoveredAi
              ? "복구 AI 분석"
              : "당시 AI 분석"
            : null,

          notice: usingRecoveredAi
            ? "당시 저장본 유실로 인해 과거 경기 전 데이터로 복원된 AI 분석입니다."
            : null,
        },

        feedback,
        betman: finalOdds ? {
          capturedAt:finalOdds.capturedAt ?? null,
          awayMl:finalOdds.awayMl ?? null, homeMl:finalOdds.homeMl ?? null,
          awayHandicapLine:finalOdds.awayHandicapLine ?? null, homeHandicapLine:finalOdds.homeHandicapLine ?? null,
          awayHandicap:finalOdds.awayHandicap ?? null, homeHandicap:finalOdds.homeHandicap ?? null,
          totalLine:finalOdds.totalLine ?? null, overOdds:finalOdds.overOdds ?? null, underOdds:finalOdds.underOdds ?? null,
          source:finalOdds.source ?? null,
        } : null,
        lineup: lineup ? { confirmed:!!lineup.confirmed, away:lineup.away ?? null, home:lineup.home ?? null, lineupEdge:lineup.lineupEdge ?? null } : null,
        snapshotOnly:true,
        join:{
          matchupKey: mk,

          aiSource: picks.length
            ? usingRecoveredAi
              ? "kbo-recovered-ai-history-2026"
              : "kbo-live-predictions"
            : null,

          aiUnavailableReason:
            picks.length
              ? null
              : "NO_STORED_OR_RECOVERED_AI_SNAPSHOT",

          aiRecovered:
            usingRecoveredAi,

          oddsSource:
            finalOdds
              ? "kbo-odds-history"
              : null,

          lineupSource:
            lineup
              ? "kbo-historical-lineup-stats-2026"
              : null,
        },
      };
    })
    .filter((g: any) => !requestedGameId || g.gameId === requestedGameId || g.betmanId === requestedGameId)
    .sort((a: any,b: any) => b.date.localeCompare(a.date) || b.gameId.localeCompare(a.gameId));

  return NextResponse.json(
    {
      ok: true,

      source:
        "ORIGINAL_PREGAME_WITH_RECOVERED_FALLBACK",

      recalculated: false,

      recoveryPolicy:
        "ORIGINAL_PREGAME_FIRST_RECOVERED_ONLY_WHEN_MISSING",

      year,
      month: month || null,
      count: games.length,
      games,
    },
    {
      headers: {
        "Cache-Control":
          "no-store, no-cache, must-revalidate",
      },
    }
  );
}

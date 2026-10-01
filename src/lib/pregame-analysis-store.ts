import { promises as fs } from "fs";
import path from "path";
import { fetchKboGames } from "@/lib/kbo";

/* PREGAME_ANALYSIS_STORE_V1 */
export async function savePregameAnalysis(date: string, incoming: any[]) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (date !== today || !incoming.some(x => x?.pregameSnapshot)) return;
  const official = await fetchKboGames(date.replaceAll("-", ""));
  const file = path.join(process.cwd(), "data", "kbo-pregame-analysis-snapshots.json");
  let store: { version: number; snapshots: any[] } = { version: 1, snapshots: [] };
  try { store = JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!Array.isArray(store.snapshots)) throw new Error("INVALID_ANALYSIS_STORE");
  const rows = new Map<string, any>(store.snapshots.map(x => [x.date + "|" + x.gameId, x]));
  let saved = 0;
  for (const input of incoming) {
    const payload = input?.pregameSnapshot;
    const game: any = official.find(g => g.gameId === input?.gameId);
    if (!payload || !game || String(game.status?.stateCode) !== "1") continue;
    const cancel = String(game.status?.cancelName || "").trim();
    if (cancel && cancel !== "정상경기") continue;
    const time = String(game.time || "").match(/^(\d{2}):(\d{2})$/);
    if (!time) continue;
    const begins = Date.parse(date + "T" + time[1] + ":" + time[2] + ":00+09:00");
    if (!Number.isFinite(begins) || Date.now() >= begins) continue;
    const key = date + "|" + game.gameId;
    const previous = rows.get(key);
    if (previous?.commenceTime && Date.now() >= Date.parse(previous.commenceTime)) continue;
    const next: any = { ...previous, date, gameId: game.gameId, game, startingPitchers: game.startingPitchers, commenceTime: new Date(begins).toISOString(), capturedAt: new Date().toISOString(), capturePhase: "PREGAME", source: "LIVE_ANALYSIS" };
    for (const field of ["starterStats", "teamForms", "bullpens"]) {
      const value = payload[field];
      if (!value || typeof value !== "object") continue;
      next[field] = { ...previous?.[field] };
      for (const side of ["away", "home"]) if (value[side] != null) next[field][side] = value[side];
    }
    const lineup = payload.lineup;
    if (lineup?.ready === true && lineup.gameId === game.gameId && lineup.date === date && lineup.away?.confirmed === true && lineup.home?.confirmed === true) next.lineup = lineup;

    /* PREGAME_PREMIUM_MARKETS_SNAPSHOT_V2 */
    const premiumPredictions =
      Array.isArray((input as any)?.allPredictions)
        ? (input as any).allPredictions
            .filter((x: any) =>
              ["ML", "HANDICAP", "TOTAL"].includes(String(x?.market || ""))
            )
            .map((x: any) => ({
              market: x.market,
              label: x.label,
              grade: x.grade ?? null,
              confidence: x.confidence ?? null,
              ev: x.ev ?? null,
              odds: x.odds ?? null,
              starterEdge: x.starterEdge ?? null,
              formEdge: x.formEdge ?? null,
              bullpenEdge: x.bullpenEdge ?? null,
              lineupEdge: x.lineupEdge ?? null,
              projectedTotal: x.projectedTotal ?? null,
              projectedScore: x.projectedScore ?? null,
              totalLine: x.totalLine ?? null,
              totalEdge: x.totalEdge ?? null,
            }))
        : [];

    if (premiumPredictions.length) {
      next.predictions = premiumPredictions;
    }

    /* PREGAME_PROJECTED_SCORE_SNAPSHOT_V1 */
    if (previous?.projectedScore === undefined) {
      const predictions = Array.isArray((input as any)?.allPredictions) ? (input as any).allPredictions : [];
      const score = predictions.find((x: any) =>
        x?.projectedScore &&
        Number.isFinite(Number(x.projectedScore.awayRuns)) &&
        Number.isFinite(Number(x.projectedScore.homeRuns)) &&
        Number.isFinite(Number(x.projectedScore.total))
      )?.projectedScore;
      if (score) next.projectedScore = {
        awayRuns: Number(score.awayRuns),
        homeRuns: Number(score.homeRuns),
        total: Number(score.total),
      };
    }
    rows.set(key, next);
    saved++;
  }
  if (!saved) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + ".tmp-" + process.pid + "-" + Date.now();
  await fs.writeFile(temp, JSON.stringify({ version: 1, snapshots: [...rows.values()] }, null, 2), "utf8");
  await fs.rename(temp, file);
}
export async function mergePregameResult(   prediction: any,   game: any ) {   const file = path.join(     process.cwd(),     "data",     "kbo-pregame-analysis-snapshots.json"   );    let store: {     version: number;     snapshots: any[];   } = {     version: 1,     snapshots: [],   };    try {     store = JSON.parse(       await fs.readFile(file, "utf8")     );   } catch {     return;   }    const row = store.snapshots.find(     (x: any) =>       x.date === prediction.date &&       x.gameId === prediction.gameId   );    if (!row) return;    row.result = {     awayScore: game?.score?.away ?? null,     homeScore: game?.score?.home ?? null,     winner:       game?.score?.away > game?.score?.home         ? "AWAY"         : game?.score?.away < game?.score?.home         ? "HOME"         : "DRAW",     totalRuns:       (game?.score?.away ?? 0) +       (game?.score?.home ?? 0),     settledAt: new Date().toISOString(),   };    row.prediction = {     market: prediction.market,     label: prediction.label,     result: prediction.result,     odds: prediction.odds,     confidence: prediction.confidence,     grade: prediction.grade,   };    const temp =     file +     ".tmp-" +     process.pid +     "-" +     Date.now();    await fs.writeFile(     temp,     JSON.stringify(store, null, 2),     "utf8"   );    await fs.rename(temp, file); }

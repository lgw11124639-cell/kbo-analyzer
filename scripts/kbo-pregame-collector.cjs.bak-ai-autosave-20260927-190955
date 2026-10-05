const fs = require("node:fs/promises");
const path = require("node:path");
process.chdir(path.resolve(__dirname, ".."));
const root = "http://127.0.0.1:3200";
async function api(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(root + url, { signal: controller.signal, ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok || data?.ok === false || data?.error) throw new Error("HTTP " + response.status + " " + String(data?.error || url));
    return data;
  } finally { clearTimeout(timer); }
}
async function optional(url) {
  try { return await api(url); } catch (error) { console.error("[PREGAME_FIELD_FAILED]", url, error.message); return null; }
}
function eligible(game, date) {
  const cancel = String(game.status?.cancelName || "").trim();
  const start = Date.parse(date + "T" + game.time + ":00+09:00");
  return String(game.status?.stateCode) === "1" && (!cancel || cancel === "정상경기") && Number.isFinite(start) && Date.now() < start;
}
async function run() {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const today = await api("/api/kbo/today?date=" + date);
  if (!Array.isArray(today.games)) throw new Error("INVALID_TODAY_RESPONSE");
  const games = today.games.filter(game => eligible(game, date));
  for (const game of games) {
    try {
      const payload = { starterStats: {}, teamForms: {}, bullpens: {} };
      const save = async () => {
        if (!eligible(game, date)) return;
        await api("/api/predictions/live", { date, engineVersion: "v0.1", allPredictions: [], aiPredictions: [], games: [{ ...game, pregameSnapshot: payload }] });
      };
      await save();
      for (const side of ["away", "home"]) {
        if (!eligible(game, date)) break;
        const id = game.startingPitchers?.[side]?.id;
        if (id) { const data = await optional("/api/kbo/pitcher/" + encodeURIComponent(id) + "?date=" + date); if (data?.stats) payload.starterStats[side] = data.stats; }
      }
      await save();
      const sameMatch = today.games.filter(g => g.awayTeamName === game.awayTeamName && g.homeTeamName === game.homeTeamName);
      if (eligible(game, date) && sameMatch.length === 1) {
        const lineup = await optional("/api/kbo/lineup-matchup?away=" + encodeURIComponent(game.awayTeamName) + "&home=" + encodeURIComponent(game.homeTeamName) + "&date=" + date);
        if (lineup?.ready === true && lineup.gameId === game.gameId && lineup.date === date) payload.lineup = lineup;
        await save();
      }
      for (const side of ["away", "home"]) {
        if (!eligible(game, date)) break;
        const query = "?team=" + encodeURIComponent(game[side + "TeamName"]) + "&date=" + date;
        const form = await optional("/api/kbo/team-form" + query);
        if (form) payload.teamForms[side] = form;
        const bullpen = await optional("/api/kbo/bullpen" + query);
        if (bullpen) payload.bullpens[side] = bullpen;
        await save();
      }
      const stored = JSON.parse(await fs.readFile("data/kbo-pregame-analysis-snapshots.json", "utf8"));
      const row = stored.snapshots.find(x => x.date === date && x.gameId === game.gameId);
      console.log("[PREGAME_STORED]", JSON.stringify({ date, gameId: game.gameId, capturedAt: row?.capturedAt || null, starters: !!row?.startingPitchers, starterStats: [!!row?.starterStats?.away, !!row?.starterStats?.home], lineup: !!row?.lineup?.ready, teamForms: [!!row?.teamForms?.away, !!row?.teamForms?.home], bullpens: [!!row?.bullpens?.away, !!row?.bullpens?.home] }));
    } catch (error) { console.error("[PREGAME_GAME_FAILED]", game.gameId, error.message); }
  }
  console.log("[PREGAME_CYCLE]", new Date().toISOString(), "eligibleGames=" + games.length);
}
async function loop() { try { await run(); } catch (error) { console.error("[PREGAME_FAILED]", error.message); } finally { setTimeout(loop, 120000); } }
void loop();

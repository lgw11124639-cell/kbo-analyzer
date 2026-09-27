const fs = require("node:fs/promises");
const path = require("node:path");
process.chdir(path.resolve(__dirname, ".."));
const file = "data/kbo-recovered-game-details.json";
async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch("http://127.0.0.1:3200" + url, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok || data?.error || data?.ok === false) throw new Error("HTTP " + response.status + " " + String(data?.error || url));
    return data;
  } finally { clearTimeout(timer); }
}
async function main() {
  let store = { version: 1, snapshots: [] };
  try { store = JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!Array.isArray(store.snapshots)) throw new Error("INVALID_RECOVERY_STORE");
  const rows = new Map(store.snapshots.map(r => [r.date + "|" + r.gameId, r]));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const base = Date.parse(today + "T00:00:00Z");
  let saved = 0, failures = 0;
  for (let offset = 1; offset <= 14; offset++) {
    const date = new Date(base - offset * 86400000).toISOString().slice(0, 10);
    let games;
    try { const data = await get("/api/kbo/today?date=" + date); if (!Array.isArray(data.games)) throw new Error("INVALID_GAMES"); games = data.games; }
    catch (error) { failures++; console.error("[RECOVERY_DATE_FAILED]", date, error.message); continue; }
    for (const game of games) {
      const cancel = String(game.status?.cancelName || "").trim();
      if (String(game.status?.stateCode) !== "3" || (cancel && cancel !== "정상경기")) continue;
      const key = date + "|" + game.gameId;
      const previous = rows.get(key);
      const row = { ...previous, date, gameId: game.gameId, game, startingPitchers: game.startingPitchers, recoveredAt: new Date().toISOString(), capturePhase: "RECOVERED", source: "KBO_HISTORICAL_RECOVERY", starterStats: { ...previous?.starterStats } };
      const matches = games.filter(g => g.awayTeamName === game.awayTeamName && g.homeTeamName === game.homeTeamName);
      if (matches.length === 1) {
        try {
          const lineup = await get("/api/kbo/lineup?away=" + encodeURIComponent(game.awayTeamName) + "&home=" + encodeURIComponent(game.homeTeamName) + "&date=" + date);
          const valid = side => Array.isArray(lineup[side]?.lineup) && lineup[side].lineup.length === 9 && lineup[side].lineup.every((p, i) => p.order === i + 1 && typeof p.name === "string" && p.name.trim());
          if (lineup.gameId !== game.gameId || lineup.date !== date || !valid("away") || !valid("home")) throw new Error("LINEUP_ID_DATE_OR_ORDER_MISMATCH");
          row.lineup = { confirmed: true, source: "KBO_HISTORICAL_RECOVERY", recoveredAt: row.recoveredAt, away: { lineup: lineup.away.lineup.map(p => ({ order: p.order, name: p.name, position: p.position })), summary: null }, home: { lineup: lineup.home.lineup.map(p => ({ order: p.order, name: p.name, position: p.position })), summary: null } };
        } catch (error) { failures++; console.error("[RECOVERY_LINEUP_FAILED]", date, game.gameId, error.message); }
      } else { console.log("[RECOVERY_DOUBLEHEADER_SKIPPED]", date, game.gameId); }
      for (const side of ["away", "home"]) {
        const id = game.startingPitchers?.[side]?.id;
        if (!id) continue;
        try {
          const data = await get("/api/kbo/pitcher/" + encodeURIComponent(id) + "?date=" + date);
          if (data.historical === true && data.targetDate === date && data.stats) row.starterStats[side] = data.stats;
        } catch (error) { failures++; console.error("[RECOVERY_PITCHER_FAILED]", date, game.gameId, side, error.message); }
      }
      rows.set(key, row);
      const temp = file + ".tmp-" + process.pid;
      await fs.writeFile(temp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), snapshots: [...rows.values()] }, null, 2));
      await fs.rename(temp, file);
      saved++;
      console.log("[RECOVERED]", JSON.stringify({ date, gameId: game.gameId, starters: row.startingPitchers, lineup: !!row.lineup, historicalPitcherStats: [!!row.starterStats.away, !!row.starterStats.home] }));
    }
  }
  console.log("[RECOVERY_DONE]", JSON.stringify({ saved, failures, total: rows.size }));
}
main().catch(error => { console.error("[RECOVERY_FAILED]", error); process.exitCode = 1; });

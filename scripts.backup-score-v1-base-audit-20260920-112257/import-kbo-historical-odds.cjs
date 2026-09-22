const fs = require("fs");
const path = require("path");

const sourceFile = path.join(process.cwd(), "data", "kbo-backtest-2026-all-candidates-lineup-base.json");
const targetFile = path.join(process.cwd(), "data", "kbo-odds-history.json");

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sideFromLabel(label, away, home) {
  const s = String(label || "").trim();
  if (s.startsWith(String(away))) return "AWAY";
  if (s.startsWith(String(home))) return "HOME";
  return null;
}

function handicapLine(label, team) {
  const s = String(label || "").trim();
  const t = String(team || "").trim();
  const rest = s.startsWith(t) ? s.slice(t.length).trim() : s;
  const m = rest.match(/([+-]?\d+(?:\.\d+)?)/);
  return m ? finite(m[1]) : null;
}

if (!fs.existsSync(sourceFile)) {
  console.error("SOURCE FILE NOT FOUND:", sourceFile);
  process.exitCode = 1;
} else {
  const root = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
  const rows = Array.isArray(root) ? root : (Array.isArray(root.results) ? root.results : []);

  const byGame = new Map();
  for (const row of rows) {
    const gameId = String(row.gameId || "").trim();
    if (!gameId) continue;
    if (!byGame.has(gameId)) byGame.set(gameId, []);
    byGame.get(gameId).push(row);
  }

  const built = [];
  const incomplete = [];

  for (const [gameId, gameRows] of [...byGame.entries()].sort((a,b) => a[0].localeCompare(b[0]))) {
    const first = gameRows[0] || {};
    const date = String(first.date || "").trim();
    const away = String(first.awayTeam || "").trim();
    const home = String(first.homeTeam || "").trim();

    const snap = {
      id: `historical-${gameId}`,
      gameId,
      date,
      awayTeamName: away,
      homeTeamName: home,
      capturedAt: date ? `${date}T00:00:00.000Z` : new Date(0).toISOString(),
      awayMl: null,
      homeMl: null,
      awayHandicapLine: null,
      homeHandicapLine: null,
      awayHandicap: null,
      homeHandicap: null,
      totalLine: null,
      overOdds: null,
      underOdds: null,
      source: "AUTO"
    };

    for (const row of gameRows) {
      const market = String(row.market || "").toUpperCase();
      const label = String(row.label || "").trim();
      const odds = finite(row.odds);

      if (market === "ML") {
        const side = sideFromLabel(label, away, home);
        if (side === "AWAY") snap.awayMl = odds;
        if (side === "HOME") snap.homeMl = odds;
      }

      if (market === "HANDICAP") {
        const side = sideFromLabel(label, away, home);
        if (side === "AWAY") {
          snap.awayHandicap = odds;
          snap.awayHandicapLine = handicapLine(label, away);
        }
        if (side === "HOME") {
          snap.homeHandicap = odds;
          snap.homeHandicapLine = handicapLine(label, home);
        }
      }

      if (market === "TOTAL") {
        const line = finite(row.totalLine);
        if (line !== null) snap.totalLine = line;
        if (/오버|OVER/i.test(label)) snap.overOdds = odds;
        if (/언더|UNDER/i.test(label)) snap.underOdds = odds;
      }
    }

    if (snap.awayHandicapLine === null && snap.homeHandicapLine !== null) {
      snap.awayHandicapLine = -snap.homeHandicapLine;
    }
    if (snap.homeHandicapLine === null && snap.awayHandicapLine !== null) {
      snap.homeHandicapLine = -snap.awayHandicapLine;
    }

    const required = [
      "awayMl","homeMl",
      "awayHandicapLine","homeHandicapLine",
      "awayHandicap","homeHandicap",
      "totalLine","overOdds","underOdds"
    ];

    const missing = required.filter(k => !Number.isFinite(snap[k]));
    if (missing.length) {
      incomplete.push({ gameId, date, away, home, missing, labels: gameRows.map(x => `${x.market}:${x.label}:${x.odds}`) });
    }

    built.push(snap);
  }

  let history = { version: 1, snapshots: [] };
  if (fs.existsSync(targetFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(targetFile, "utf8"));
      history = {
        version: Number(parsed.version) || 1,
        snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : []
      };
    } catch (e) {
      console.error("TARGET JSON READ ERROR:", e.message);
      process.exitCode = 1;
    }
  }

  if (!process.exitCode) {
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });

    let backupFile = null;
    if (fs.existsSync(targetFile)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      backupFile = `${targetFile}.bak-historical-${stamp}`;
      fs.copyFileSync(targetFile, backupFile);
    }

    const previous = history.snapshots.length;
    const oldHistorical = history.snapshots.filter(x => String(x?.id || "").startsWith("historical-"));
    const keep = history.snapshots.filter(x => !String(x?.id || "").startsWith("historical-"));

    const merged = [...keep, ...built].sort((a,b) => {
      const ca = String(a?.capturedAt || "");
      const cb = String(b?.capturedAt || "");
      if (ca !== cb) return ca.localeCompare(cb);
      const ga = String(a?.gameId || "");
      const gb = String(b?.gameId || "");
      if (ga !== gb) return ga.localeCompare(gb);
      return String(a?.id || "").localeCompare(String(b?.id || ""));
    });

    const out = { version: Math.max(1, Number(history.version) || 1), snapshots: merged };
    const tmp = `${targetFile}.tmp-historical`;
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2), "utf8");
    fs.renameSync(tmp, targetFile);

    console.log("==================================================");
    console.log("KBO HISTORICAL ODDS IMPORT");
    console.log("==================================================");
    console.log("SOURCE ROWS:", rows.length);
    console.log("SOURCE GAMES:", byGame.size);
    console.log("BUILT SNAPSHOTS:", built.length);
    console.log("COMPLETE SNAPSHOTS:", built.length - incomplete.length);
    console.log("INCOMPLETE SNAPSHOTS:", incomplete.length);
    console.log("PREVIOUS HISTORY:", previous);
    console.log("REMOVED OLD HISTORICAL:", oldHistorical.length);
    console.log("ADDED/REPLACED HISTORICAL:", built.length);
    console.log("NEW TOTAL SNAPSHOTS:", merged.length);
    console.log("BACKUP:", backupFile || "NONE");
    if (incomplete.length) {
      console.log();
      console.log("===== INCOMPLETE SAMPLE =====");
      for (const x of incomplete.slice(0, 10)) {
        console.log(JSON.stringify(x));
      }
    }
  }
}

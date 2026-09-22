const fs = require("fs");

const DATA = "data/kbo-backtest-2026-all-candidates-lineup-base.json";

const root = JSON.parse(fs.readFileSync(DATA, "utf8"));
const rows = Array.isArray(root) ? root : (root.results ?? []);

function validNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function resultType(row) {
  const x = String(row.result ?? "").trim().toUpperCase();
  if (["WIN","WON","HIT","W"].includes(x)) return "WIN";
  if (["LOSS","LOSE","LOST","L"].includes(x)) return "LOSS";
  if (["PUSH","VOID","RETURN","CANCEL","CANCELED","CANCELLED"].includes(x)) return "PUSH";
  return "UNKNOWN";
}

function splitOf(date) {
  const month = String(date).slice(0, 7);
  if (month === "2026-03" || month === "2026-04") return "DISCOVERY";
  if (month === "2026-05" || month === "2026-06") return "INTERNAL";
  return "FINAL";
}

function validPick(row) {
  return (
    validNumber(row.confidence) &&
    validNumber(row.odds) &&
    row.odds > 1 &&
    resultType(row) !== "UNKNOWN"
  );
}

function pct(x) {
  return (x * 100).toFixed(1) + "%";
}

function signedPct(x) {
  const v = (x * 100).toFixed(1);
  return (x >= 0 ? "+" : "") + v + "%";
}

function sortConfidence(a, b) {
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  const aEv = validNumber(a.ev) ? a.ev : -999;
  const bEv = validNumber(b.ev) ? b.ev : -999;
  if (bEv !== aEv) return bEv - aEv;
  return b.odds - a.odds;
}

const validRows = rows.filter(validPick);

const byDate = new Map();
for (const row of validRows) {
  const date = String(row.date);
  if (!byDate.has(date)) byDate.set(date, []);
  byDate.get(date).push(row);
}

const dates = [...byDate.keys()].sort();

function rowKey(row) {
  return [
    row.gameId ?? "",
    row.market ?? "",
    row.label ?? "",
    row.odds ?? ""
  ].join("|");
}

function dailyTopN(n) {
  const out = [];
  for (const date of dates) {
    const xs = [...byDate.get(date)].sort(sortConfidence);
    const seen = new Set();
    let rank = 0;
    for (const row of xs) {
      const key = rowKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      rank++;
      out.push({ ...row, _date: date, _rank: rank, _policy: `TOP${n}` });
      if (rank >= n) break;
    }
  }
  return out;
}

function perGameTop1() {
  const out = [];
  for (const date of dates) {
    const xs = byDate.get(date);
    const games = new Map();
    for (const row of xs) {
      const gid = String(row.gameId ?? "");
      if (!games.has(gid)) games.set(gid, []);
      games.get(gid).push(row);
    }
    for (const [gid, rs] of games) {
      const row = [...rs].sort(sortConfidence)[0];
      if (row) out.push({ ...row, _date: date, _rank: 1, _policy: "GAME_TOP1" });
    }
  }
  return out;
}

function summary(arr) {
  const wins = arr.filter(x => resultType(x) === "WIN").length;
  const losses = arr.filter(x => resultType(x) === "LOSS").length;
  const pushes = arr.filter(x => resultType(x) === "PUSH").length;
  const decided = wins + losses;

  const avgConf = arr.length
    ? arr.reduce((s,x) => s + x.confidence, 0) / arr.length
    : 0;

  const avgOdds = arr.length
    ? arr.reduce((s,x) => s + x.odds, 0) / arr.length
    : 0;

  const avgBE = arr.length
    ? arr.reduce((s,x) => s + 1 / x.odds, 0) / arr.length
    : 0;

  const hit = decided ? wins / decided : 0;

  return {
    n: arr.length,
    wins,
    losses,
    pushes,
    hit,
    avgConf,
    avgOdds,
    avgBE,
    gap: hit - avgBE
  };
}

function printSummary(label, arr) {
  const s = summary(arr);
  console.log(
    label,
    `N=${s.n}`,
    `W=${s.wins}`,
    `L=${s.losses}`,
    `P=${s.pushes}`,
    `HIT=${pct(s.hit)}`,
    `AVG_CONF=${pct(s.avgConf)}`,
    `AVG_ODDS=${s.avgOdds.toFixed(3)}`,
    `AVG_BE=${pct(s.avgBE)}`,
    `HIT_MINUS_BE=${signedPct(s.gap)}`
  );
}

const policies = {
  DAILY_TOP1: dailyTopN(1),
  DAILY_TOP2: dailyTopN(2),
  DAILY_TOP3: dailyTopN(3),
  GAME_TOP1: perGameTop1()
};

console.log("==================================================");
console.log("KBO HIT-RATE ENGINE V1");
console.log("SOURCE PICK ACCURACY FIRST");
console.log("NO COMBO / NO MONEY WEIGHTING / NO SCORE MODEL");
console.log("==================================================");
console.log();
console.log("===== DATA =====");
console.log("ROWS:", rows.length);
console.log("VALID:", validRows.length);
console.log("DAYS:", dates.length);

console.log();
console.log("===== POLICY OVERALL =====");
for (const [name, arr] of Object.entries(policies)) {
  printSummary(name, arr);
}

console.log();
console.log("===== POLICY TEMPORAL STABILITY =====");
for (const split of ["DISCOVERY","INTERNAL","FINAL"]) {
  console.log();
  console.log(`### ${split}`);
  for (const [name, arr] of Object.entries(policies)) {
    printSummary(
      name,
      arr.filter(x => splitOf(x.date) === split)
    );
  }
}

console.log();
console.log("===== DAILY TOP1 — MARKET =====");
for (const market of ["ML","HANDICAP","TOTAL"]) {
  printSummary(
    market,
    policies.DAILY_TOP1.filter(x => String(x.market) === market)
  );
}

console.log();
console.log("===== GAME TOP1 — MARKET =====");
for (const market of ["ML","HANDICAP","TOTAL"]) {
  printSummary(
    market,
    policies.GAME_TOP1.filter(x => String(x.market) === market)
  );
}

const confBuckets = [
  { name: "<55%", lo: -Infinity, hi: 0.55 },
  { name: "55-60%", lo: 0.55, hi: 0.60 },
  { name: "60-65%", lo: 0.60, hi: 0.65 },
  { name: "65-70%", lo: 0.65, hi: 0.70 },
  { name: "70-75%", lo: 0.70, hi: 0.75 },
  { name: "75-80%", lo: 0.75, hi: 0.80 },
  { name: "80%+", lo: 0.80, hi: Infinity },
];

function inBucket(x, b) {
  return x.confidence >= b.lo && x.confidence < b.hi;
}

console.log();
console.log("===== ALL VALID — CONFIDENCE CALIBRATION =====");
for (const b of confBuckets) {
  printSummary(
    b.name,
    validRows.filter(x => inBucket(x, b))
  );
}

console.log();
console.log("===== DAILY TOP1 — CONFIDENCE CALIBRATION =====");
for (const b of confBuckets) {
  printSummary(
    b.name,
    policies.DAILY_TOP1.filter(x => inBucket(x, b))
  );
}

console.log();
console.log("===== CONFIDENCE THRESHOLDS — ALL VALID =====");
for (const t of [0.60,0.65,0.70,0.75,0.80]) {
  printSummary(
    `CONF>=${Math.round(t*100)}%`,
    validRows.filter(x => x.confidence >= t)
  );
}

console.log();
console.log("===== CONFIDENCE THRESHOLDS — BY SPLIT =====");
for (const t of [0.60,0.65,0.70,0.75,0.80]) {
  console.log();
  console.log(`### CONF>=${Math.round(t*100)}%`);
  for (const split of ["DISCOVERY","INTERNAL","FINAL"]) {
    printSummary(
      split,
      validRows.filter(
        x => x.confidence >= t && splitOf(x.date) === split
      )
    );
  }
}

console.log();
console.log("===== HIGH-HIT SEARCH — DAILY TOP1 BY MIN CONF =====");
for (const t of [0.55,0.575,0.60,0.625,0.65,0.675,0.70,0.725,0.75,0.775,0.80]) {
  const xs = policies.DAILY_TOP1.filter(x => x.confidence >= t);
  printSummary(`TOP1_CONF>=${(t*100).toFixed(1)}%`, xs);
}

console.log();
console.log("===== RULE =====");
console.log("DAILY_TOP1/2/3 = HIGHEST CONFIDENCE PICKS PER DATE");
console.log("GAME_TOP1 = HIGHEST CONFIDENCE PICK PER GAME");
console.log("TIEBREAK = EV THEN ODDS");
console.log("HIT EXCLUDES PUSH FROM DENOMINATOR");
console.log("AVG_BE = AVERAGE OF 1/ODDS");
console.log("HIT_MINUS_BE = ACTUAL HIT RATE - AVG BREAK-EVEN RATE");
console.log("NO COMBO");
console.log("NO BET SIZE OPTIMIZATION");
console.log("NO SCORE MODEL RETUNING");

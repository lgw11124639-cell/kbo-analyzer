import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

type BullpenRow = {
  date: string;
  team: string;
  outs?: number;
  hits?: number;
  walks?: number;
  strikeouts?: number;
  homeRuns?: number;
  earnedRuns?: number;
  runs?: number;
  appearances?: number;
  pitches?: number;
};

const FILE = path.join(
  process.cwd(),
  "data",
  "kbo-h15-shadow-bullpen-2026.json"
);

function cutoff(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function summarize(
  rows: BullpenRow[],
  targetDate: string,
  days?: number
) {
  let filtered = rows.filter((row) => row.date < targetDate);

  if (typeof days === "number") {
    const from = cutoff(targetDate, days);
    filtered = filtered.filter((row) => row.date >= from);
  }

  if (filtered.length === 0) return null;

  const sum = (key: keyof BullpenRow) =>
    filtered.reduce((acc, row) => acc + (Number(row[key]) || 0), 0);

  const outs = sum("outs");
  const hits = sum("hits");
  const walks = sum("walks");
  const strikeouts = sum("strikeouts");
  const homeRuns = sum("homeRuns");
  const earnedRuns = sum("earnedRuns");

  return {
    games: filtered.length,
    appearances: sum("appearances"),
    outs,
    innings: Number((outs / 3).toFixed(3)),
    pitches: sum("pitches"),
    hits,
    walks,
    strikeouts,
    homeRuns,
    earnedRuns,
    runs: sum("runs"),
    era: outs ? Number(((earnedRuns * 27) / outs).toFixed(3)) : null,
    whip: outs ? Number((((hits + walks) * 3) / outs).toFixed(3)) : null,
    k9: outs ? Number(((strikeouts * 27) / outs).toFixed(3)) : null,
    bb9: outs ? Number(((walks * 27) / outs).toFixed(3)) : null,
    hr9: outs ? Number(((homeRuns * 27) / outs).toFixed(3)) : null,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = String(url.searchParams.get("date") || "");
  const team = String(url.searchParams.get("team") || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !team) {
    return NextResponse.json(
      { ok: false, error: "INVALID_DATE_OR_TEAM" },
      { status: 400 }
    );
  }

  if (!fs.existsSync(FILE)) {
    return NextResponse.json({
      ok: true,
      ready: false,
      team,
      date,
      season: null,
      recent14: null,
      reason: "SHADOW_DATA_NOT_CREATED",
    });
  }

  const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const rows: BullpenRow[] = Array.isArray(raw?.gameBullpens)
    ? raw.gameBullpens.filter((row: BullpenRow) => row?.team === team)
    : [];

  const season = summarize(rows, date);
  const recent14 = summarize(rows, date, 14);

  return NextResponse.json({
    ok: true,
    ready: Boolean(
      season?.era !== null &&
      season?.era !== undefined &&
      recent14?.era !== null &&
      recent14?.era !== undefined
    ),
    team,
    date,
    season,
    recent14,
  });
}

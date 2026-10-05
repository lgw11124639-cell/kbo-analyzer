import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const secret = process.env.SUPABASE_SECRET_KEY || "";

function adminClient() {
  if (!url || !secret) throw new Error("SUPABASE_SERVER_ENV_MISSING");
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowsOf(value: any) {
  if (Array.isArray(value)) return value;
  return value?.snapshots || value?.items || value?.history || [];
}

function byTeam(raw: any, away: string, home: string) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  if (raw[away] || raw[home]) return raw;
  const out: Record<string, unknown> = {};
  if (raw.away) out[away] = raw.away;
  if (raw.home) out[home] = raw.home;
  return Object.keys(out).length ? out : raw;
}

function byStarter(raw: any, starters: any) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  if (Object.keys(raw).some((key) => /^\d+$/.test(key))) return raw;

  const out: Record<string, unknown> = {};
  const awayId = starters?.away?.id;
  const homeId = starters?.home?.id;

  if (awayId && raw.away) out[String(awayId)] = raw.away;
  if (homeId && raw.home) out[String(homeId)] = raw.home;

  return Object.keys(out).length ? out : raw;
}

/* PURCHASED_PREMIUM_REPLAY_V1 */
export async function GET(request: NextRequest) {
  try {
    const gameId = request.nextUrl.searchParams.get("gameId") || "";

    if (!/^[A-Za-z0-9_-]{1,100}$/.test(gameId)) {
      return reply({ ok: false, error: "경기 정보가 올바르지 않습니다." }, 400);
    }

    const auth = request.headers.get("authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      return reply({ ok: false, error: "로그인이 필요합니다." }, 401);
    }

    const admin = adminClient();
    const { data: userData, error: userError } = await admin.auth.getUser(token);

    if (userError || !userData.user) {
      return reply({ ok: false, error: "로그인이 필요합니다." }, 401);
    }

    const { data: unlock, error: unlockError } = await admin
      .from("kbo_analysis_unlocks")
      .select("game_id")
      .eq("user_id", userData.user.id)
      .eq("game_id", gameId)
      .maybeSingle();

    if (unlockError) throw unlockError;

    if (!unlock) {
      return reply({ ok: false, error: "구매한 경기분석이 아닙니다." }, 403);
    }

    const snapshotPath = path.join(
      process.cwd(),
      "data",
      "kbo-pregame-analysis-snapshots.json"
    );

    const snapshotRaw = JSON.parse(
      await fs.readFile(snapshotPath, "utf8")
    );

    const snapshots = rowsOf(snapshotRaw)
      .filter((row: any) => row?.gameId === gameId)
      .sort((a: any, b: any) =>
        String(b?.capturedAt || "").localeCompare(
          String(a?.capturedAt || "")
        )
      );

    const snapshot = snapshots[0];

    if (!snapshot?.game) {
      return reply(
        { ok: false, error: "저장된 경기분석 스냅샷을 찾을 수 없습니다." },
        404
      );
    }

    const game = {
      ...snapshot.game,
      startingPitchers:
        snapshot.game.startingPitchers ||
        snapshot.startingPitchers ||
        { away: null, home: null },
    };

    const awayTeam = String(game.awayTeamName || "");
    const homeTeam = String(game.homeTeamName || "");
    const starters = game.startingPitchers || snapshot.startingPitchers || {};

    let oddsRow: any = null;

    try {
      const oddsPath = path.join(
        process.cwd(),
        "data",
        "kbo-odds-history.json"
      );

      const oddsRaw = JSON.parse(
        await fs.readFile(oddsPath, "utf8")
      );

      const oddsRows = rowsOf(oddsRaw)
        .filter(
          (row: any) =>
            row?.gameId === gameId &&
            (
              row?.source === "AUTO" ||
              String(row?.id || "").startsWith("historical-")
            )
        )
        .sort((a: any, b: any) =>
          String(
            b?.capturedAt ||
            b?.savedAt ||
            ""
          ).localeCompare(
            String(
              a?.capturedAt ||
              a?.savedAt ||
              ""
            )
          )
        );

      oddsRow = oddsRows[0] || null;
    } catch {
      oddsRow = null;
    }

    const odds = {
      awayMl: num(oddsRow?.awayMl),
      homeMl: num(oddsRow?.homeMl),
      awayHandicapLine: num(oddsRow?.awayHandicapLine),
      homeHandicapLine: num(oddsRow?.homeHandicapLine),
      awayHandicap: num(oddsRow?.awayHandicap),
      homeHandicap: num(oddsRow?.homeHandicap),
      totalLine: num(oddsRow?.totalLine),
      overOdds: num(oddsRow?.overOdds),
      underOdds: num(oddsRow?.underOdds),
    };

    return reply({
      ok: true,
      gameId,
      capturedAt: snapshot.capturedAt || "",
      game,
      odds,
      pitcherStats: byStarter(snapshot.starterStats, starters),
      teamForms: byTeam(snapshot.teamForms, awayTeam, homeTeam),
      bullpens: byTeam(snapshot.bullpens, awayTeam, homeTeam),
      lineup: snapshot.lineup || null,
    });
  } catch (error) {
    console.error("premium replay failed", error);
    return reply(
      { ok: false, error: "저장된 경기분석을 불러오지 못했습니다." },
      500
    );
  }
}

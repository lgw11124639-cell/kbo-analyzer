import { NextRequest, NextResponse } from "next/server";
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

async function requireUser(request: NextRequest) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: "UNAUTHORIZED" as const, user: null };
  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { error: "UNAUTHORIZED" as const, user: null };
  return { error: null, user: data.user };
}



const ADMIN_BASEBALL_BALANCE =
  2_000_000_000;

function hasUnlimitedBaseballs(
  user: any
) {
  return (
    user?.app_metadata?.role ===
      "admin" &&
    user?.app_metadata
      ?.unlimited_baseballs === true
  );
}

async function ensureUnlimitedBaseballs(
  admin: any,
  userId: string
) {
  const {
    error,
  } =
    await admin
      .from("kbo_baseball_wallets")
      .update({
        balance:
          ADMIN_BASEBALL_BALANCE,

        updated_at:
          new Date().toISOString(),
      })
      .eq(
        "user_id",
        userId
      );

  if (error) {
    throw error;
  }
}

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

async function handleUnlock(request: NextRequest, purchase: boolean) {
  try {
    const auth = await requireUser(request);
    if (auth.error || !auth.user) return reply({ ok: false, error: "로그인이 필요합니다." }, 401);
    const body = purchase ? await request.json().catch(() => null) : null;
    const gameId = purchase ? body?.gameId : request.nextUrl.searchParams.get("gameId");
    if (typeof gameId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(gameId)) return reply({ ok: false, error: "경기 정보가 올바르지 않습니다." }, 400);
    const admin = adminClient();
    if (!purchase) {
      const { data, error } = await admin.from("kbo_analysis_unlocks").select("game_id,price,created_at").eq("user_id", auth.user.id).eq("game_id", gameId).maybeSingle();
      if (error) throw error;
      return reply({ ok: true, gameId, unlocked: !!data, price: 3000 });
    }
    const unlimited =
      hasUnlimitedBaseballs(
        auth.user
      );

    if (unlimited) {
      await ensureUnlimitedBaseballs(
        admin,
        auth.user.id
      );
    }

    const { data, error } =
      await admin.rpc(
        "kbo_unlock_analysis",
        {
          p_user_id:
            auth.user.id,

          p_game_id:
            gameId,
        }
      );
    if (error) {
      if (error.message.includes("INSUFFICIENT_BASEBALLS")) return reply({ ok: false, error: "보유 야구공이 부족합니다." }, 400);
      if (error.message.includes("WALLET_NOT_FOUND")) return reply({ ok: false, error: "야구공 상자를 찾을 수 없습니다." }, 400);
      throw error;
    }
    if (
      !data?.ok ||
      !data?.unlocked
    ) {
      throw new Error(
        "UNEXPECTED_UNLOCK_RESPONSE"
      );
    }

    if (unlimited) {
      await ensureUnlimitedBaseballs(
        admin,
        auth.user.id
      );

      return reply({
        ...data,
        balance:
          ADMIN_BASEBALL_BALANCE,
        unlimited: true,
      });
    }

    return reply(data);
  } catch (error) {
    console.error("baseball analysis unlock failed", error);
    return reply({ ok: false, error: "처리 결과를 확인하지 못했습니다. 다시 시도하면 구매 여부를 확인하며 중복 차감하지 않습니다." }, 500);
  }
}

export async function GET(request: NextRequest) { return handleUnlock(request, false); }
export async function POST(request: NextRequest) { return handleUnlock(request, true); }

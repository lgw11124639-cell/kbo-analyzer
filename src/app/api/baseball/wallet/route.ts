import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const secret = process.env.SUPABASE_SECRET_KEY || "";

function authClient() {
  if (!url || !publishableKey) {
    throw new Error(
      "SUPABASE_PUBLIC_ENV_MISSING"
    );
  }

  return createClient(
    url,
    publishableKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

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
  const { data, error } =
    await authClient().auth.getUser(token);
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

export async function GET(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (auth.error || !auth.user) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const admin = adminClient();

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
    const [{ data: wallet, error: walletError }, { data: bets, error: betsError }] =
      await Promise.all([
        admin
          .from("kbo_baseball_wallets")
          .select("balance,lifetime_earned,lifetime_spent,updated_at")
          .eq("user_id", auth.user.id)
          .maybeSingle(),
        admin
          .from("kbo_baseball_bets")
          .select("id,stake,total_odds,expected_return,status,returned_amount,selections,created_at,settled_at")
          .eq("user_id", auth.user.id)
          .order("created_at", { ascending: false })
          .limit(30),
      ]);

    if (walletError) throw walletError;
    if (betsError) throw betsError;

    return NextResponse.json(
      {
        ok: true,
        wallet:
          wallet || {
            balance: 0,
            lifetime_earned: 0,
            lifetime_spent: 0,
          },
        bets: bets || [],
      },
      {
        headers: {
          "Cache-Control":
            "private, no-store, max-age=0",
        },
      }
    );
  } catch (error) {
    console.error("baseball wallet GET failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "WALLET_LOAD_FAILED" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (auth.error || !auth.user) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const stake = Math.trunc(Number(body?.stake));
    const totalOdds = Number(body?.totalOdds);
    const selections = Array.isArray(body?.selections) ? body.selections : [];
    const oddsSnapshot =
      body?.oddsSnapshot && typeof body.oddsSnapshot === "object" ? body.oddsSnapshot : {};
    const referenceKey =
      typeof body?.referenceKey === "string" && body.referenceKey.trim()
        ? body.referenceKey.trim()
        : "";

    if (!Number.isFinite(stake) || stake < 1) {
      return NextResponse.json({ ok: false, error: "INVALID_STAKE" }, { status: 400 });
    }
    if (!Number.isFinite(totalOdds) || totalOdds <= 0) {
      return NextResponse.json({ ok: false, error: "INVALID_ODDS" }, { status: 400 });
    }
    if (selections.length < 1) {
      return NextResponse.json({ ok: false, error: "NO_SELECTIONS" }, { status: 400 });
    }
    if (!referenceKey) {
      return NextResponse.json({ ok: false, error: "REFERENCE_KEY_REQUIRED" }, { status: 400 });
    }

    const admin = adminClient();

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

    const { data, error } = await admin.rpc("kbo_place_baseball_bet", {
      p_user_id: auth.user.id,
      p_stake: stake,
      p_total_odds: totalOdds,
      p_selections: selections,
      p_odds_snapshot: oddsSnapshot,
      p_reference_key: referenceKey,
    });

    if (error) {
      const msg = String(error.message || "");
      const known =
        msg.includes("INSUFFICIENT_BASEBALLS") ? "INSUFFICIENT_BASEBALLS" :
        msg.includes("DUPLICATE_BET") ? "DUPLICATE_BET" :
        msg.includes("WALLET_NOT_FOUND") ? "WALLET_NOT_FOUND" :
        msg.includes("INVALID_STAKE") ? "INVALID_STAKE" :
        "BET_FAILED";
      return NextResponse.json({ ok: false, error: known }, { status: 400 });
    }

    if (unlimited) {
      await ensureUnlimitedBaseballs(
        admin,
        auth.user.id
      );

      const responseData =
        data &&
        typeof data === "object" &&
        !Array.isArray(data)
          ? data
          : { ok: true };

      return NextResponse.json({
        ...responseData,
        balance:
          ADMIN_BASEBALL_BALANCE,
        unlimited: true,
      });
    }

    return NextResponse.json(
      data || { ok: true }
    );
  } catch (error) {
    console.error("baseball wallet POST failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "BET_FAILED" },
      { status: 500 }
    );
  }
}

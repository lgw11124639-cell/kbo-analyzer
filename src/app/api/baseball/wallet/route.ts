import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchKboGames } from "@/lib/kbo";

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


/*
  BASEBALL_BET_GAME_STATUS_GUARD_V1

  배팅 가능:
  - 공식 경기 상태가 아직 시작 전
  - 취소되지 않은 경기

  배팅 불가:
  - LIVE
  - FINAL
  - 이닝이 이미 시작됨
  - 우천취소 등 취소 경기

  프론트 상태는 조작 가능하므로
  실제 야구공 차감 직전에 서버에서 KBO를 다시 확인한다.
*/
function getSelectionGameId(
  selection: any
) {
  const value =
    typeof selection?.gameId ===
    "string"
      ? selection.gameId.trim()
      : "";

  return value;
}

function isKboGameBettingClosed(
  game: any
) {
  const stateCode =
    String(
      game?.status?.stateCode ||
      ""
    );

  const cancelCode =
    String(
      game?.status?.cancelCode ||
      "0"
    );

  const inning =
    Number(
      game?.status?.inning || 0
    );

  const topBottom =
    String(
      game?.status?.topBottom ||
      ""
    ).trim();

  const cancelled =
    !!cancelCode &&
    cancelCode !== "0";

  const started =
    stateCode === "2" ||
    stateCode === "3" ||
    inning > 0 ||
    !!topBottom;

  return (
    cancelled ||
    started
  );
}

async function checkSelectionsBettable(
  selections: any[]
) {
  const rawGameIds =
    selections.map(
      getSelectionGameId
    );

  if (
    rawGameIds.some(
      (gameId) => !gameId
    )
  ) {
    return {
      ok: false,
      error:
        "INVALID_SELECTION_GAME",
      closedGameIds: [],
    };
  }

  const gameIds =
    Array.from(
      new Set(rawGameIds)
    );

  const dateKeys =
    Array.from(
      new Set(
        gameIds.map(
          (gameId) =>
            gameId.slice(0, 8)
        )
      )
    );

  if (
    dateKeys.some(
      (dateKey) =>
        !/^\d{8}$/.test(
          dateKey
        )
    )
  ) {
    return {
      ok: false,
      error:
        "INVALID_SELECTION_GAME",
      closedGameIds: [],
    };
  }

  const gameLists =
    await Promise.all(
      dateKeys.map(
        async (dateKey) => ({
          dateKey,
          games:
            await fetchKboGames(
              dateKey
            ),
        })
      )
    );

  const gameMap =
    new Map<string, any>();

  for (
    const result of
    gameLists
  ) {
    for (
      const game of
      result.games
    ) {
      gameMap.set(
        game.gameId,
        game
      );
    }
  }

  const missingGameIds =
    gameIds.filter(
      (gameId) =>
        !gameMap.has(gameId)
    );

  if (
    missingGameIds.length
  ) {
    return {
      ok: false,
      error:
        "GAME_NOT_FOUND",
      closedGameIds:
        missingGameIds,
    };
  }

  const closedGameIds =
    gameIds.filter(
      (gameId) =>
        isKboGameBettingClosed(
          gameMap.get(gameId)
        )
    );

  if (
    closedGameIds.length
  ) {
    return {
      ok: false,
      error:
        "GAME_BETTING_CLOSED",
      closedGameIds,
    };
  }

  return {
    ok: true,
    error: null,
    closedGameIds: [],
  };
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

    /*
      실제 차감 직전 공식 KBO 상태 재검증.
      사용자가 선택한 뒤 경기 시작된 경우도 여기서 차단한다.
    */
    let gameStatusCheck;

    try {
      gameStatusCheck =
        await checkSelectionsBettable(
          selections
        );
    } catch (statusError) {
      console.error(
        "baseball bet game status check failed",
        statusError
      );

      return NextResponse.json(
        {
          ok: false,
          error:
            "GAME_STATUS_UNAVAILABLE",
        },
        {
          status: 503,
        }
      );
    }

    if (
      !gameStatusCheck.ok
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            gameStatusCheck.error,

          closedGameIds:
            gameStatusCheck.closedGameIds,
        },
        {
          status: 409,
        }
      );
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

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const secret = process.env.SUPABASE_SECRET_KEY || "";

function publicClient() {
  if (!url || !publishableKey) throw new Error("SUPABASE_PUBLIC_ENV_MISSING");
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function adminClient() {
  if (!url || !secret) throw new Error("SUPABASE_SERVER_ENV_MISSING");
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function optionalUser(request: NextRequest) {
  const token = (request.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  if (!token) return null;

  const { data } = await publicClient().auth.getUser(token);
  return data.user || null;
}

async function requireUser(request: NextRequest) {
  const user = await optionalUser(request);
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

function authorName(user: any) {
  const meta =
    String(
      user?.user_metadata?.nickname ||
      user?.user_metadata?.name ||
      ""
    ).trim();

  if (meta) return meta.slice(0, 30);

  const email = String(user?.email || "");
  return email.includes("@")
    ? email.split("@")[0].slice(0, 30)
    : "KBO 팬";
}

export async function GET(request: NextRequest) {
  try {
    const admin = adminClient();
    const user = await optionalUser(request);

    const params = request.nextUrl.searchParams;
    const category = String(params.get("category") || "all");
    const gameId = String(params.get("gameId") || "").trim();
    const sort = String(params.get("sort") || "latest");

    let query = admin
      .from("kbo_community_posts")
      .select("*");

    if (category !== "all") {
      query = query.eq("category", category);
    }

    if (gameId) {
      query = query.eq("game_id", gameId);
    }

    if (sort === "popular") {
      query = query
        .order("like_count", { ascending: false })
        .order("comment_count", { ascending: false })
        .order("created_at", { ascending: false });
    } else {
      query = query.order("created_at", { ascending: false });
    }

    const { data: posts, error } = await query.limit(100);
    if (error) throw error;

    let likedIds: string[] = [];

    if (user && posts?.length) {
      const ids = posts.map((post: any) => post.id);

      const { data: likes, error: likeError } = await admin
        .from("kbo_community_likes")
        .select("post_id")
        .eq("user_id", user.id)
        .in("post_id", ids);

      if (likeError) throw likeError;

      likedIds = (likes || []).map((row: any) => row.post_id);
    }

    return NextResponse.json(
      {
        ok: true,
        posts: (posts || []).map((post: any) => ({
          ...post,
          likedByMe: likedIds.includes(post.id),
          mine: user ? post.user_id === user.id : false,
        })),
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    console.error("community posts GET failed", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "COMMUNITY_LOAD_FAILED",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = await request.json().catch(() => ({}));

    const title = String(body?.title || "").trim();
    const content = String(body?.content || "").trim();
    const category = String(body?.category || "talk").trim();
    const gameId = String(body?.gameId || "").trim() || null;

    const allowed = new Set([
      "talk",
      "game",
      "analysis",
      "combo",
    ]);

    if (!title || title.length > 100) {
      return NextResponse.json(
        { ok: false, error: "INVALID_TITLE" },
        { status: 400 }
      );
    }

    if (!content || content.length > 5000) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CONTENT" },
        { status: 400 }
      );
    }

    if (!allowed.has(category)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CATEGORY" },
        { status: 400 }
      );
    }

    const admin = adminClient();

    const { data, error } = await admin
      .from("kbo_community_posts")
      .insert({
        user_id: user.id,
        author_name: authorName(user),
        category,
        game_id: gameId,
        title,
        content,
      })
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      post: {
        ...data,
        likedByMe: false,
        mine: true,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "COMMUNITY_POST_FAILED";

    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "UNAUTHORIZED" ? 401 : 500 }
    );
  }
}

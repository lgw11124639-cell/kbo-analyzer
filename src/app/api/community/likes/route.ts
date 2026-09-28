import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const secret = process.env.SUPABASE_SECRET_KEY || "";

function authClient() {
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

async function requireUser(request: NextRequest) {
  const token = (request.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  if (!token) throw new Error("UNAUTHORIZED");

  const { data, error } = await authClient().auth.getUser(token);

  if (error || !data.user) throw new Error("UNAUTHORIZED");

  return data.user;
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = await request.json().catch(() => ({}));
    const postId = String(body?.postId || "").trim();

    if (!postId) {
      return NextResponse.json(
        { ok: false, error: "POST_ID_REQUIRED" },
        { status: 400 }
      );
    }

    const admin = adminClient();

    const { data: existing, error: findError } = await admin
      .from("kbo_community_likes")
      .select("post_id")
      .eq("post_id", postId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (findError) throw findError;

    let liked = false;

    if (existing) {
      const { error } = await admin
        .from("kbo_community_likes")
        .delete()
        .eq("post_id", postId)
        .eq("user_id", user.id);

      if (error) throw error;
    } else {
      const { error } = await admin
        .from("kbo_community_likes")
        .insert({
          post_id: postId,
          user_id: user.id,
        });

      if (error) throw error;
      liked = true;
    }

    const { count, error: countError } = await admin
      .from("kbo_community_likes")
      .select("*", { count: "exact", head: true })
      .eq("post_id", postId);

    if (countError) throw countError;

    await admin
      .from("kbo_community_posts")
      .update({
        like_count: count || 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId);

    return NextResponse.json({
      ok: true,
      liked,
      likeCount: count || 0,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "LIKE_FAILED";

    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "UNAUTHORIZED" ? 401 : 500 }
    );
  }
}

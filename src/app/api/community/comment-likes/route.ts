import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const secret = process.env.SUPABASE_SECRET_KEY || "";

function publicClient() {
  if (!url || !publishableKey) {
    throw new Error("SUPABASE_PUBLIC_ENV_MISSING");
  }

  return createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function adminClient() {
  if (!url || !secret) {
    throw new Error("SUPABASE_SERVER_ENV_MISSING");
  }

  return createClient(url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function requireUser(request: NextRequest) {
  const token = (request.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  if (!token) return null;

  const { data, error } =
    await publicClient().auth.getUser(token);

  if (error || !data.user) return null;

  return data.user;
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "LOGIN_REQUIRED" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const commentId = String(body?.commentId || "").trim();

    if (!commentId) {
      return NextResponse.json(
        { ok: false, error: "COMMENT_ID_REQUIRED" },
        { status: 400 }
      );
    }

    const admin = adminClient();

    const { data: comment, error: commentError } =
      await admin
        .from("kbo_community_comments")
        .select("id,user_id,is_deleted")
        .eq("id", commentId)
        .maybeSingle();

    if (commentError) throw commentError;

    if (!comment || comment.is_deleted) {
      return NextResponse.json(
        { ok: false, error: "COMMENT_NOT_FOUND" },
        { status: 404 }
      );
    }

    if (comment.user_id === user.id) {
      return NextResponse.json(
        { ok: false, error: "SELF_LIKE_NOT_ALLOWED" },
        { status: 400 }
      );
    }

    const { data: existing, error: existingError } =
      await admin
        .from("kbo_community_comment_likes")
        .select("comment_id")
        .eq("comment_id", commentId)
        .eq("user_id", user.id)
        .maybeSingle();

    if (existingError) throw existingError;

    let liked = false;

    if (existing) {
      const { error } = await admin
        .from("kbo_community_comment_likes")
        .delete()
        .eq("comment_id", commentId)
        .eq("user_id", user.id);

      if (error) throw error;
    } else {
      const { error } = await admin
        .from("kbo_community_comment_likes")
        .insert({
          comment_id: commentId,
          user_id: user.id,
        });

      if (error) throw error;
      liked = true;
    }

    const { count, error: countError } =
      await admin
        .from("kbo_community_comment_likes")
        .select("*", {
          count: "exact",
          head: true,
        })
        .eq("comment_id", commentId);

    if (countError) throw countError;

    const likeCount = count || 0;

    const { error: updateError } = await admin
      .from("kbo_community_comments")
      .update({
        like_count: likeCount,
      })
      .eq("id", commentId);

    if (updateError) throw updateError;

    return NextResponse.json({
      ok: true,
      liked,
      likeCount,
    });
  } catch (error) {
    console.error(
      "community comment-like POST failed",
      error
    );

    return NextResponse.json(
      { ok: false, error: "COMMENT_LIKE_FAILED" },
      { status: 500 }
    );
  }
}

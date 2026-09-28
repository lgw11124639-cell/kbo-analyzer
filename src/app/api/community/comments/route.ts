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

async function optionalUser(request: NextRequest) {
  const token = (request.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  if (!token) return null;

  const { data } =
    await publicClient().auth.getUser(token);

  return data.user || null;
}

async function requireUser(request: NextRequest) {
  return optionalUser(request);
}

function authorName(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}) {
  const metadata = user.user_metadata || {};

  const candidate =
    metadata.nickname ||
    metadata.name ||
    metadata.display_name;

  if (
    typeof candidate === "string" &&
    candidate.trim()
  ) {
    return candidate.trim().slice(0, 30);
  }

  return (
    user.email?.split("@")[0]?.slice(0, 30) ||
    "KBO 팬"
  );
}

export async function GET(request: NextRequest) {
  try {
    const postId =
      request.nextUrl.searchParams.get("postId")?.trim();

    if (!postId) {
      return NextResponse.json(
        { ok: false, error: "POST_ID_REQUIRED" },
        { status: 400 }
      );
    }

    const user = await optionalUser(request);
    const admin = adminClient();

    const { data, error } = await admin
      .from("kbo_community_comments")
      .select("*")
      .eq("post_id", postId)
      .order("created_at", {
        ascending: true,
      });

    if (error) throw error;

    const rows = data || [];
    const ids = rows.map((row) => row.id);

    let likedIds = new Set<string>();

    if (user && ids.length) {
      const { data: likes, error: likeError } =
        await admin
          .from("kbo_community_comment_likes")
          .select("comment_id")
          .eq("user_id", user.id)
          .in("comment_id", ids);

      if (likeError) throw likeError;

      likedIds = new Set(
        (likes || []).map((row) => row.comment_id)
      );
    }

    const comments = rows.map((row) => ({
      ...row,
      likedByMe: likedIds.has(row.id),
      mine: user?.id === row.user_id,
      content: row.is_deleted
        ? "삭제된 댓글입니다."
        : row.content,
    }));

    return NextResponse.json({
      ok: true,
      comments,
    });
  } catch (error) {
    console.error("community comments GET failed", error);

    return NextResponse.json(
      { ok: false, error: "COMMENT_LOAD_FAILED" },
      { status: 500 }
    );
  }
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

    const postId = String(body?.postId || "").trim();
    const content = String(body?.content || "").trim();
    const requestedParentId =
      body?.parentId
        ? String(body.parentId).trim()
        : null;

    if (!postId || !content) {
      return NextResponse.json(
        { ok: false, error: "COMMENT_REQUIRED" },
        { status: 400 }
      );
    }

    if (content.length > 1000) {
      return NextResponse.json(
        { ok: false, error: "COMMENT_TOO_LONG" },
        { status: 400 }
      );
    }

    const admin = adminClient();

    let parentId: string | null = null;
    let replyToUserId: string | null = null;
    let replyToName: string | null = null;

    if (requestedParentId) {
      const { data: target, error } = await admin
        .from("kbo_community_comments")
        .select(
          "id,post_id,parent_id,user_id,author_name"
        )
        .eq("id", requestedParentId)
        .maybeSingle();

      if (error) throw error;

      if (!target || target.post_id !== postId) {
        return NextResponse.json(
          { ok: false, error: "REPLY_TARGET_NOT_FOUND" },
          { status: 404 }
        );
      }

      parentId = target.parent_id || target.id;
      replyToUserId = target.user_id;
      replyToName = target.author_name;
    }

    const { data: comment, error } = await admin
      .from("kbo_community_comments")
      .insert({
        post_id: postId,
        user_id: user.id,
        author_name: authorName(user),
        content,
        parent_id: parentId,
        reply_to_user_id: replyToUserId,
        reply_to_name: replyToName,
      })
      .select("*")
      .single();

    if (error) throw error;

    const { count, error: countError } =
      await admin
        .from("kbo_community_comments")
        .select("*", {
          count: "exact",
          head: true,
        })
        .eq("post_id", postId)
        .eq("is_deleted", false);

    if (countError) throw countError;

    const commentCount = count || 0;

    const { error: updateError } = await admin
      .from("kbo_community_posts")
      .update({
        comment_count: commentCount,
      })
      .eq("id", postId);

    if (updateError) throw updateError;

    return NextResponse.json({
      ok: true,
      comment: {
        ...comment,
        likedByMe: false,
        mine: true,
      },
      commentCount,
    });
  } catch (error) {
    console.error("community comments POST failed", error);

    return NextResponse.json(
      { ok: false, error: "COMMENT_CREATE_FAILED" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const secret = process.env.SUPABASE_SECRET_KEY || "";

function authClient() {
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
    await authClient().auth.getUser(token);

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

    const form = await request.formData();
    const files = form
      .getAll("images")
      .filter((item): item is File => item instanceof File);

    if (!files.length) {
      return NextResponse.json(
        { ok: false, error: "IMAGE_REQUIRED" },
        { status: 400 }
      );
    }

    if (files.length > 5) {
      return NextResponse.json(
        { ok: false, error: "MAX_5_IMAGES" },
        { status: 400 }
      );
    }

    const allowed = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
    ]);

    const admin = adminClient();
    const images: Array<{
      path: string;
      url: string;
      name: string;
    }> = [];

    for (const file of files) {
      if (!allowed.has(file.type)) {
        return NextResponse.json(
          { ok: false, error: "INVALID_IMAGE_TYPE" },
          { status: 400 }
        );
      }

      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json(
          { ok: false, error: "IMAGE_TOO_LARGE" },
          { status: 400 }
        );
      }

      const ext =
        file.name.split(".").pop()?.toLowerCase() ||
        (file.type === "image/png"
          ? "png"
          : file.type === "image/webp"
            ? "webp"
            : file.type === "image/gif"
              ? "gif"
              : "jpg");

      const safeExt =
        ["jpg", "jpeg", "png", "webp", "gif"].includes(ext)
          ? ext
          : "jpg";

      const path =
        `${user.id}/${Date.now()}-` +
        `${crypto.randomUUID()}.${safeExt}`;

      const buffer = Buffer.from(
        await file.arrayBuffer()
      );

      const { error } = await admin.storage
        .from("community-images")
        .upload(path, buffer, {
          contentType: file.type,
          upsert: false,
        });

      if (error) {
        console.error("community image upload failed", error);

        return NextResponse.json(
          { ok: false, error: "IMAGE_UPLOAD_FAILED" },
          { status: 500 }
        );
      }

      const { data } = admin.storage
        .from("community-images")
        .getPublicUrl(path);

      images.push({
        path,
        url: data.publicUrl,
        name: file.name,
      });
    }

    return NextResponse.json({
      ok: true,
      images,
    });
  } catch (error) {
    console.error("community upload POST failed", error);

    return NextResponse.json(
      { ok: false, error: "IMAGE_UPLOAD_FAILED" },
      { status: 500 }
    );
  }
}

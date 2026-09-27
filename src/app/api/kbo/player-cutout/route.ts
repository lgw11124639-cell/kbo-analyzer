import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const src = (req.nextUrl.searchParams.get("src") || "").trim();
  if (!src) return new NextResponse("missing src", { status: 400 });

  try {
    const res = await fetch(src, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://m.sports.naver.com/",
      },
      cache: "force-cache",
    });
    if (!res.ok) return new NextResponse("fetch failed", { status: 502 });

    const input = Buffer.from(await res.arrayBuffer());
    const sharp = (await import("sharp")).default;

    const { data, info } = await sharp(input)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const aIndex = i + 3;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const avg = (r + g + b) / 3;
      const diff = max - min;

      if (avg >= 245 && diff <= 18) {
        data[aIndex] = 0;
      } else if (avg >= 228 && diff <= 24) {
        const alpha = Math.round(((245 - avg) / 17) * 255);
        data[aIndex] = Math.max(0, Math.min(255, alpha));
      }
    }

    const out = await sharp(data, {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4,
      },
    })
      .png()
      .toBuffer();

    return new NextResponse(out, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new NextResponse("server error", { status: 500 });
  }
}

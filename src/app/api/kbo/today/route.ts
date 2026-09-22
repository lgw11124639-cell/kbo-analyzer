import { NextResponse } from "next/server";
import { fetchKboGames, kstDateKey } from "@/lib/kbo";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date")?.replaceAll("-", "") || kstDateKey();
  if (!/^\d{8}$/.test(date)) return NextResponse.json({ error: "invalid date" }, { status: 400 });
  try {
    const games = await fetchKboGames(date);
    return NextResponse.json({ date, games, fetchedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "KBO fetch failed" }, { status: 502 });
  }
}

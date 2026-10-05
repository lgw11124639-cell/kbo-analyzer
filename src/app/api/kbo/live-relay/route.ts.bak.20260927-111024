import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const KBO_URL = "https://www.koreabaseball.com/Game/LiveTextView2.aspx";
const SCOREBOARD_URL = "https://www.koreabaseball.com/Schedule/ScoreBoard.aspx";

function decodeHtml(value: string) {
  return value.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

function clean(value = "") {
  return decodeHtml(value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function one(html: string, re: RegExp) {
  return clean(html.match(re)?.[1] ?? "");
}

function count(html: string, re: RegExp) {
  return Array.from(html.matchAll(re)).length;
}

function hidden(html: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(`name=[\"\x27]${escaped}[\"\x27][^>]*value=[\"\x27]([^\"\x27]*)`, "i"))?.[1] ?? "";
}

export async function GET(req: NextRequest) {
  const gameId = (req.nextUrl.searchParams.get("gameId") ?? "").trim();
  const year = (req.nextUrl.searchParams.get("year") ?? gameId.slice(0, 4)).trim();

  if (!/^\d{8}[A-Z0-9]{4,}$/.test(gameId) || !/^\d{4}$/.test(year)) {
    return NextResponse.json({ ok: false, error: "invalid gameId/year" }, { status: 400 });
  }

  const body = new URLSearchParams({ leagueId: "1", seriesId: "0", gameId, gyear: year });

  try {
    const res = await fetch(KBO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "Mozilla/5.0 KBO-Analyzer/0.1",
        Referer: `https://www.koreabaseball.com/Game/LiveText.aspx?leagueId=1&seriesId=0&gameId=${encodeURIComponent(gameId)}&gyear=${encodeURIComponent(year)}`,
      },
      body: body.toString(),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `KBO HTTP ${res.status}` }, { status: 502 });
    }

    const html = await res.text();
    const scoreboardRes = await fetch(SCOREBOARD_URL, { headers: { "User-Agent": "Mozilla/5.0 KBO-Analyzer/0.1" }, cache: "no-store" });
    const scoreboardCookie = scoreboardRes.headers.get("set-cookie")?.split(";")[0] ?? "";
    let scoreboardHtml = scoreboardRes.ok ? await scoreboardRes.text() : "";
    const scoreboardDate = gameId.slice(0, 8);
    if (!scoreboardHtml.includes(`gameId=${gameId}`) && scoreboardHtml) {
      const form = new URLSearchParams({ __EVENTTARGET: "ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$btnCalendarSelect", __EVENTARGUMENT: "", __VIEWSTATE: hidden(scoreboardHtml, "__VIEWSTATE"), __VIEWSTATEGENERATOR: hidden(scoreboardHtml, "__VIEWSTATEGENERATOR"), __EVENTVALIDATION: hidden(scoreboardHtml, "__EVENTVALIDATION"), "ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$hfSearchDate": scoreboardDate });
      const datedRes = await fetch(SCOREBOARD_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 KBO-Analyzer/0.1", ...(scoreboardCookie ? { Cookie: scoreboardCookie } : {}) }, body: form.toString(), cache: "no-store" });
      if (datedRes.ok) scoreboardHtml = await datedRes.text();
    }
    const markerIndex = scoreboardHtml.indexOf(`gameId=${gameId}`);
    const scoreboardStart = markerIndex >= 0 ? scoreboardHtml.lastIndexOf(`<div class="smsScore">`, markerIndex) : -1;
    const scoreboardEnd = scoreboardStart >= 0 ? scoreboardHtml.indexOf(`<div class="smsScore">`, markerIndex + 1) : -1;
    const scoreboardBlock = scoreboardStart >= 0 ? scoreboardHtml.slice(scoreboardStart, scoreboardEnd >= 0 ? scoreboardEnd : undefined) : "";
    const scoreboardRows = Array.from(scoreboardBlock.matchAll(/<tr>\s*<th[^>]*>([\s\S]*?)<\/th>([\s\S]*?)<\/tr>/gi)).map((m) => { const team = clean(m[1]); const cells = Array.from(m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((c) => clean(c[1])); if (cells.length < 16) return null; return { team, innings: cells.slice(0, 12).map((v) => v === "-" ? null : Number(v)), runs: Number(cells[12] ?? 0), hits: Number(cells[13] ?? 0), errors: Number(cells[14] ?? 0), walks: Number(cells[15] ?? 0) }; }).filter((row): row is NonNullable<typeof row> => row !== null);
    const economy = html.match(/<div class="economy">([\s\S]*?)<div class="broadcast">/i)?.[1] ?? "";
    const baseBlock = economy.match(/<span class="base">([\s\S]*?)<\/span>/i)?.[1] ?? "";
    const inningText = one(baseBlock, /<strong>([\s\S]*?)<\/strong>/i);
    const strongs = Array.from(baseBlock.matchAll(/<strong>([\s\S]*?)<\/strong>/gi)).map((m) => clean(m[1]));
    const countText = strongs[1] ?? "";
    const countMatch = countText.match(/(\d+)\s*-\s*(\d+)\s+(\d+)\s*out/i);
    const inningNo = Number(inningText.match(/(\d+)\s*회/)?.[1] ?? 0);
    const ballsBlock = economy.match(/<div class="b">([\s\S]*?)<\/div>/i)?.[1] ?? "";
    const strikesBlock = economy.match(/<div class="s">([\s\S]*?)<\/div>/i)?.[1] ?? "";
    const outsBlock = economy.match(/<div class="o">([\s\S]*?)<\/div>/i)?.[1] ?? "";
    const runner1 = one(economy, /<li class=['"]typing1['"]>([\s\S]*?)<\/li>/i) || null;
    const runner2 = one(economy, /<li class=['"]typing2['"]>([\s\S]*?)<\/li>/i) || null;
    const runner3 = one(economy, /<li class=['"]typing3['"]>([\s\S]*?)<\/li>/i) || null;
    const baseCode = Number(economy.match(/ground_base(\d+)\.png/i)?.[1] ?? 0);
    const pitcherName = one(economy, /<li class=["\x27]pitcher["\x27]>([\s\S]*?)<\/li>/i) || null;
    const batterName = one(economy, /<li class=["\x27]supervision\d*["\x27]>([\s\S]*?)<\/li>/i) || null;
    let pitcherId: string | null = null;
    let batterId: string | null = null;

    let pitches: { pitchNum: number; text: string; pitchResult: string; stuff: string; speed: number | null; pitchId: string | null; x: number | null; z: number | null }[] = [];
    try { const nr = await fetch(`https://api-gw.sports.naver.com/schedule/games/${gameId}${year}/relay?inning=${inningNo || 1}`, { headers: { "User-Agent": "Mozilla/5.0", Origin: "https://m.sports.naver.com", Referer: "https://m.sports.naver.com/" }, cache: "no-store" }); if (nr.ok) { const nj = await nr.json(); const all: any[] = []; const walk = (v: any) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") { all.push(v); Object.values(v).forEach(walk); } }; walk(nj); const findPlayerId = (name: string | null) => { if (!name) return null; for (const o of all) { const vals = Object.values(o).filter((v): v is string => typeof v === "string"); if (!vals.some((v) => v === name || v.includes(name))) continue; for (const k of ["playerId","playerCode","pcode","playerNo","personId","id","code"]) { const v = o[k]; if (v != null && /^\d+$/.test(String(v))) return String(v); } } return null; }; pitcherId = findPlayerId(pitcherName); batterId = findPlayerId(batterName); const track = new Map<string, any>(); all.forEach((o) => { if (o.pitchId && o.y0 != null && o.vy0 != null && o.ay != null) track.set(String(o.pitchId), o); }); const events = all.filter((o) => Number(o.pitchNum) > 0 && o.ptsPitchId && o.stuff); const current: any[] = []; for (const o of events) { if (current.length && Number(o.pitchNum) === 1) break; current.push(o); } pitches = current.map((o) => { const t = track.get(String(o.ptsPitchId)); let x: number | null = null; let z: number | null = null; if (t) { x = Number.isFinite(Number(t.crossPlateX)) ? Number(t.crossPlateX) : null; const y0=Number(t.y0),vy0=Number(t.vy0),ay=Number(t.ay),z0=Number(t.z0),vz0=Number(t.vz0),az=Number(t.az),ty=Number(t.crossPlateY ?? 0.7083); const d=vy0*vy0-2*ay*(y0-ty); if ([y0,vy0,ay,z0,vz0,az].every(Number.isFinite) && d>=0 && ay!==0) { const sec=(-vy0-Math.sqrt(d))/ay; if (Number.isFinite(sec) && sec>0) z=z0+vz0*sec+0.5*az*sec*sec; } } return { pitchNum:Number(o.pitchNum), text:String(o.text ?? ""), pitchResult:String(o.pitchResult ?? ""), stuff:String(o.stuff ?? ""), speed:Number.isFinite(Number(o.speed)) ? Number(o.speed) : null, pitchId:String(o.ptsPitchId ?? "") || null, x, z }; }); } } catch {}

    const liveTexts: string[] = [];
    if (inningNo > 0) {
      const re = new RegExp(`<span id=["']rptLiveText${inningNo}_spanLiveText_\\d+["'][^>]*>([\\s\\S]*?)<\\/span>`, "gi");
      for (const m of html.matchAll(re)) {
        const t = clean(m[1]);
        if (t && t !== "-") liveTexts.push(t);
      }
    }

    return NextResponse.json({
      ok: true,
      gameId,
      inning: inningText || null,
      countText: countText || null,
      balls: countMatch ? Number(countMatch[1]) : count(ballsBlock, /<li[^>]*class=["']on["'][^>]*>\s*ball\s*<\/li>/gi),
      strikes: countMatch ? Number(countMatch[2]) : count(strikesBlock, /<li[^>]*class=["']on["'][^>]*>\s*strike\s*<\/li>/gi),
      outs: countMatch ? Number(countMatch[3]) : count(outsBlock, /<li[^>]*class=["']on["'][^>]*>\s*out\s*<\/li>/gi),
      pitcher: one(economy, /<li class=["']pitcher["']>([\s\S]*?)<\/li>/i) || null,
      batter: one(economy, /<li class=["']supervision\d*["']>([\s\S]*?)<\/li>/i) || null,
      runners: { first: runner1, second: runner2, third: runner3 },
      baseCode,
      recentPlays: liveTexts.slice(0, 8),
      pitches,
      scoreboard: scoreboardRows,
      source: "KBO_LIVE_TEXT",
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "live relay fetch failed" }, { status: 502 });
  }
}

import type { KboGame } from "@/types/kbo";

const GAME_LIST_URL = "https://www.koreabaseball.com/ws/Main.asmx/GetKboGameList";

type RawGame = Record<string, unknown>;

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function s(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function person(id: unknown, name: unknown) {
  const pid = n(id);
  const nm = s(name);
  return pid && nm ? { id: pid, name: nm } : null;
}

function parseGame(g: RawGame): KboGame {
  return {
    gameId: s(g.G_ID),
    date: s(g.G_DT),
    time: s(g.G_TM),
    season: n(g.SEASON_ID) ?? new Date().getFullYear(),
    stadium: s(g.S_NM),
    homeTeamCode: s(g.HOME_ID),
    awayTeamCode: s(g.AWAY_ID),
    homeTeamName: s(g.HOME_NM),
    awayTeamName: s(g.AWAY_NM),
    homeRank: n(g.B_RANK_NO),
    awayRank: n(g.T_RANK_NO),
    broadcast: s(g.TV_IF),
    status: {
      stateCode: s(g.GAME_STATE_SC),
      cancelCode: s(g.CANCEL_SC_ID),
      cancelName: s(g.CANCEL_SC_NM),
      inning: n(g.GAME_INN_NO),
      topBottom: s(g.GAME_TB_SC_NM) || null,
    },
    score: { home: n(g.B_SCORE_CN), away: n(g.T_SCORE_CN) },
    startingPitchers: {
      away: person(g.T_PIT_P_ID, g.T_PIT_P_NM),
      home: person(g.B_PIT_P_ID, g.B_PIT_P_NM),
    },
    flags: {
      lineupAvailable: n(g.LINEUP_CK) === 1,
      scoreAvailable: s(g.SCORE_CK) === "1",
      starterAnnounced: n(g.START_PIT_CK) === 1,
    },
  };
}

function kstDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replaceAll("-", "");
}

export async function fetchKboGames(dateKey = kstDateKey()): Promise<KboGame[]> {
  const res = await fetch(GAME_LIST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "User-Agent": "Mozilla/5.0 KBO-Analyzer/0.1",
      Referer: "https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx",
    },
    body: JSON.stringify({ leId: "1", srId: "0,9,6", date: dateKey }),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`KBO HTTP ${res.status}`);
  const raw = await res.text();
  const htmlAt = raw.search(/<!DOCTYPE|<html/i);
  const jsonText = htmlAt >= 0 ? raw.slice(0, htmlAt) : raw;
  const parsed = JSON.parse(jsonText) as { game?: RawGame[] };
  return Array.isArray(parsed.game) ? parsed.game.map(parseGame) : [];
}

export { kstDateKey };

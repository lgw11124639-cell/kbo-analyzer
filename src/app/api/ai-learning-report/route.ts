import { NextResponse } from "next/server";
import champion from "../../../../data/kbo-engine-v1-champion.json";
import { promises as fs } from "fs";
import path from "path";
export const dynamic = "force-dynamic";
export async function GET() {
  const model = champion as { publicVersion?: string; version: string; trainedThrough: string; trainingGames: number; mode?: string };
  const version = model.publicVersion || "1.0";
  let snapshots: any[] = [];
  try { const raw = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "kbo-pregame-analysis-snapshots.json"), "utf8")); snapshots = Array.isArray(raw?.snapshots) ? raw.snapshots : []; } catch {}
  const reports = snapshots.filter((x:any) => x?.result && Number.isFinite(Number(x?.result?.awayScore)) && Number.isFinite(Number(x?.result?.homeScore)) && x?.projectedScore && Number.isFinite(Number(x?.projectedScore?.awayRuns)) && Number.isFinite(Number(x?.projectedScore?.homeRuns))).map((x:any) => { const pa=Number(x.projectedScore.awayRuns), ph=Number(x.projectedScore.homeRuns), aa=Number(x.result.awayScore), ah=Number(x.result.homeScore); return { date:x.date, gameId:x.gameId, game:x.game, projectedScore:{awayRuns:pa,homeRuns:ph}, result:{awayScore:aa,homeScore:ah,settledAt:x.result?.settledAt}, errors:{away:Math.abs(pa-aa),home:Math.abs(ph-ah),total:Math.abs((pa+ph)-(aa+ah))} }; }).sort((a:any,b:any)=>String(b.result?.settledAt||b.date).localeCompare(String(a.result?.settledAt||a.date)));
  const kstToday = new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const todayReports = reports.filter((x:any)=>x.date===kstToday);
  const avgTotalError = todayReports.length ? todayReports.reduce((n:number,x:any)=>n+x.errors.total,0)/todayReports.length : null;
  return NextResponse.json({ version, trainingGames:model.trainingGames, trainedThrough:model.trainedThrough, reports, todayCount:todayReports.length, avgTotalError });
}

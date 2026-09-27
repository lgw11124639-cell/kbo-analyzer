
const fs=require("node:fs/promises");
const path=require("node:path");
const {buildAutoPredictions}=require("./kbo-pregame-ai.cjs");
const data=path.resolve(__dirname,"..","data");
async function read(n,f){try{return JSON.parse(await fs.readFile(path.join(data,n),"utf8"));}catch{return f;}}
(async()=>{
  const live=await read("kbo-live-predictions.json",{predictions:[]});
  const snap=await read("kbo-pregame-analysis-snapshots.json",{snapshots:[]});
  const rec=await read("kbo-recovered-ai-history-2026.json",{version:1,predictions:[]});
  if(!Array.isArray(rec.predictions)) rec.predictions=[];
  const has=new Set([...(live.predictions||[]),...rec.predictions].filter(x=>["ML","HANDICAP","TOTAL"].includes(String(x?.market))).map(x=>`${x.date}|${x.gameId}`));
  let games=0,rows=0,skipped=0;
  for(const s of (snap.snapshots||[])){
    const key=`${s?.date}|${s?.gameId}`;
    if(has.has(key)||s?.capturePhase!=="PREGAME"||!s?.game||!s?.result||!Number.isInteger(s?.result?.awayScore)||!Number.isInteger(s?.result?.homeScore)){continue;}
    const picks=await buildAutoPredictions(s.date,s.game,{starterStats:s.starterStats,teamForms:s.teamForms,bullpens:s.bullpens,lineup:s.lineup},s.commenceTime);
    if(!picks.length){skipped++;continue;}
    const recoveredAt=new Date().toISOString();
    for(const p of picks) rec.predictions.push({...p,date:s.date,gameId:s.gameId,awayTeamName:s.game.awayTeamName,homeTeamName:s.game.homeTeamName,recovery:{source:"PREGAME_ANALYSIS_SNAPSHOT_V1",recoveredAt,notice:"당시 저장본 유실로 인해 실제 경기 전 자동저장 데이터로 복원된 AI 분석입니다."}});
    has.add(key);games++;rows+=picks.length;
  }
  const tmp=path.join(data,`kbo-recovered-ai-history-2026.json.tmp-${process.pid}-${Date.now()}`);
  await fs.writeFile(tmp,JSON.stringify(rec,null,2),"utf8");await fs.rename(tmp,path.join(data,"kbo-recovered-ai-history-2026.json"));
  console.log("[HISTORY_AI_RECOVERY]",JSON.stringify({games,rows,skipped,totalRecoveredRows:rec.predictions.length}));
})().catch(e=>{console.error(e);process.exitCode=1;});

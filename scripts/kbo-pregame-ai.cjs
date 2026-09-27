
const fs = require("node:fs/promises");
const path = require("node:path");

const DATA = path.resolve(__dirname, "..", "data");
const num = (v) => v === null || v === undefined || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
const clamp = (v, lo=0.2, hi=0.8) => Math.max(lo, Math.min(hi, v));

function starterScore(s) {
  if (!s) return null;
  const era = num(s.era) ?? 5, whip = num(s.whip) ?? 1.6;
  const games = num(s.games) ?? 0, qs = num(s.qs);
  const qsRate = games > 0 && qs !== null ? qs / games : 0.4;
  const bb = num(s.walks), so = num(s.strikeouts);
  const kbb = bb && bb > 0 && so !== null ? so / bb : 2;
  const season = clamp(100-(era-2)*22,0,100)*0.4167 + clamp(100-(whip-0.9)*100,0,100)*0.3333 + clamp(qsRate*125,0,100)*0.1667 + clamp(kbb*22,0,100)*0.0833;
  const r = s.recent5;
  let recent = season;
  if (r && Number(r.games) >= 3) {
    const re = num(r.era) ?? era, rw = num(r.whip) ?? whip, rk = num(r.kbb) ?? kbb;
    recent = clamp(100-(re-2)*22,0,100)*0.50 + clamp(100-(rw-0.9)*100,0,100)*0.30 + clamp(rk*22,0,100)*0.20;
  }
  return clamp(season*0.60 + recent*0.40,0,100);
}

function formScore(f) {
  if (!f || Number(f.sampleSize) < 5) return null;
  const wp = num(f.winPct) ?? 0.5, ar = num(f.avgRuns) ?? 4.5, aa = num(f.avgRunsAllowed) ?? 4.5;
  return clamp(clamp(wp*100,0,100)*0.35 + clamp(50+(ar-4.5)*12,0,100)*0.35 + clamp(50+(4.5-aa)*12,0,100)*0.30,0,100);
}

function bullpenScore(b) {
  const fatigue = num(b?.summary?.fatigueIndex);
  return fatigue === null ? null : clamp(100-fatigue,0,100);
}

function projectedTotal(row) {
  const af=row?.teamForms?.away, hf=row?.teamForms?.home, as=row?.starterStats?.away, hs=row?.starterStats?.home, ab=row?.bullpens?.away, hb=row?.bullpens?.home, lu=row?.lineup;
  const ar=num(af?.avgRuns), ara=num(af?.avgRunsAllowed), hr=num(hf?.avgRuns), hra=num(hf?.avgRunsAllowed);
  const al=num(af?.leagueRunsPerTeamD1), hl=num(hf?.leagueRunsPerTeamD1), league=al ?? hl;
  if ([ar,ara,hr,hra,league].some(v=>v===null)) return null;
  let away=league*0.60+((ar+hra)/2)*0.40, home=league*0.60+((hr+ara)/2)*0.40;
  const blend=(s)=>{ if(!s)return null; const se=num(s.era), rr=num(s?.recent5?.era); if(se===null&&rr===null)return null; return se!==null&&rr!==null?se*0.60+rr*0.40:(se??rr); };
  const he=blend(hs), ae=blend(as);
  if(he!==null) away += clamp((he-league)*0.09,-0.40,0.40);
  if(ae!==null) home += clamp((ae-league)*0.09,-0.40,0.40);
  away=clamp(away,2.25,7.25); home=clamp(home,2.25,7.25);
  let da=0, dh=0;
  const pair=(av,hv,coef)=>{ av=num(av); hv=num(hv); if(av===null||hv===null)return; da+=clamp(av-league,-4,4)*coef; dh+=clamp(hv-league,-4,4)*coef; };
  pair(af?.recent5?.avgRunsAllowed,hf?.recent5?.avgRunsAllowed,0.20);
  pair(af?.awayAvgRuns,hf?.homeAvgRuns,-0.20);
  pair(af?.awayAvgRunsAllowed,hf?.homeAvgRunsAllowed,-0.10);
  away=clamp(away+da,1.5,8); home=clamp(home+dh,1.5,8);
  const aFat=num(ab?.summary?.fatigueIndex), hFat=num(hb?.summary?.fatigueIndex);
  if(aFat!==null&&hFat!==null){ home+=clamp((aFat-50)*0.02,-3,3)*-0.30; away+=clamp((hFat-50)*0.02,-3,3)*-0.30; away=clamp(away,1.5,8); home=clamp(home,1.5,8); }
  const aOps=num(lu?.away?.baseSummary?.avgOps), hOps=num(lu?.home?.baseSummary?.avgOps);
  if(aOps!==null&&hOps!==null){ away+=clamp((aOps-0.700)*5,-3,3)*-0.30; home+=clamp((hOps-0.700)*5,-3,3)*-0.30; away=clamp(away,1.5,8); home=clamp(home,1.5,8); }
  let r7a=away, r7h=home;
  const r7=(av,hv,c,s,coef)=>{av=num(av);hv=num(hv);if(av===null||hv===null)return;r7a+=clamp((av-c)*s,-3,3)*coef;r7h+=clamp((hv-c)*s,-3,3)*coef;};
  r7(af?.recent5?.winRate,hf?.recent5?.winRate,0.4915079365079364,1,0.30);
  r7(af?.restDays,hf?.restDays,0.5714285714285714,0.20,0.30);
  r7(af?.recent10?.winRate,hf?.recent10?.winRate,0.49081443688586546,1,0.30);
  away=clamp(r7a,1.5,8); home=clamp(r7h,1.5,8);
  const LM=4.948761292129035, LB=-3.284247801595127, SM=5.5353028724473905, SB=0.17970426271874573;
  const lc=(x)=>x===null?0:LB*(x-LM), sc=(x)=>x===null?0:SB*(x-SM);
  const common=(sc(num(af?.seasonAvgRuns))+sc(num(hf?.seasonAvgRuns)))/2;
  away+=lc(al)+common; home+=lc(hl)+common;
  return Number((away+home).toFixed(2));
}

const implied=o=>o&&o>1?1/o:null;
function fair(a,b){a=implied(a);b=implied(b);if(a===null||b===null||a+b<=0)return [null,null];return [a/(a+b),b/(a+b)];}
function cp(p,m){const f=m==="ML"?0.85:m==="HANDICAP"?0.80:0.70;return 0.5+(p-0.5)*f;}
function cev(p,o,m){return !o||o<=1?null:cp(p,m)*o-1;}
function grade(p){return p>=0.62?"A":p>=0.57?"B":"C";}
function line(v){return v===null?"":(v>0?`+${v}`:String(v));}

function analyze(game,odds,se=0,fe=0,be=0,le=0,pt=null){
  const out=[];
  const rankEdge=game?.awayRank&&game?.homeRank?clamp((game.homeRank-game.awayRank)*0.008,-0.08,0.08):0;
  const [maf]=fair(odds.awayMl,odds.homeMl); const base=clamp((0.48+rankEdge)*0.45+(maf??0.5)*0.55);
  const ap=clamp(base+clamp(se*0.0018,-0.05,0.05)+clamp(fe*0.0013,-0.04,0.04)+clamp(be*0.0008,-0.025,0.025)+clamp(le*0.003,-0.02,0.02));
  const hp=1-ap;
  for(const [label,o,p] of [[`${game.awayTeamName} 승`,odds.awayMl,ap],[`${game.homeTeamName} 승`,odds.homeMl,hp]]) if(o&&o>1) out.push({gameId:game.gameId,label,market:"ML",odds:o,confidence:p,ev:cev(p,o,"ML"),grade:grade(cp(p,"ML"))});
  const [ahf,hhf]=fair(odds.awayHandicap,odds.homeHandicap);
  if(ahf!==null&&hhf!==null){
    const sd=17.6689172380097,b=0.03816985690553097, ap2=clamp(ahf+b*(fe/sd),0.05,0.95), hp2=clamp(hhf+b*(-fe/sd),0.05,0.95);
    if(odds.awayHandicap>1) out.push({gameId:game.gameId,label:`${game.awayTeamName} ${line(odds.awayHandicapLine)}`,market:"HANDICAP",odds:odds.awayHandicap,confidence:ap2,ev:ap2*odds.awayHandicap-1,grade:grade(ap2)});
    if(odds.homeHandicap>1) out.push({gameId:game.gameId,label:`${game.homeTeamName} ${line(odds.homeHandicapLine)}`,market:"HANDICAP",odds:odds.homeHandicap,confidence:hp2,ev:hp2*odds.homeHandicap-1,grade:grade(hp2)});
  }
  if(odds.totalLine!==null&&odds.overOdds!==null&&odds.underOdds!==null&&odds.overOdds>1&&odds.underOdds>1){
    let op=null,up=null; if(pt!==null&&Number.isFinite(pt)){op=clamp(1/(1+Math.exp(-(pt-odds.totalLine)/4.5)),0.35,0.65);up=1-op;} else { [op,up]=fair(odds.overOdds,odds.underOdds); }
    if(op!==null&&up!==null){out.push({gameId:game.gameId,label:`오버 ${odds.totalLine}`,market:"TOTAL",odds:odds.overOdds,confidence:op,ev:cev(op,odds.overOdds,"TOTAL"),grade:grade(cp(op,"TOTAL"))});out.push({gameId:game.gameId,label:`언더 ${odds.totalLine}`,market:"TOTAL",odds:odds.underOdds,confidence:up,ev:cev(up,odds.underOdds,"TOTAL"),grade:grade(cp(up,"TOTAL"))});}
  }
  return out;
}

function normalizeOdds(x){
  return {
    awayMl:num(x?.awayMl ?? x?.moneyline?.awayOdds), homeMl:num(x?.homeMl ?? x?.moneyline?.homeOdds),
    awayHandicapLine:num(x?.awayHandicapLine ?? x?.spread?.awayLine), homeHandicapLine:num(x?.homeHandicapLine ?? x?.spread?.homeLine),
    awayHandicap:num(x?.awayHandicap ?? x?.spread?.awayOdds), homeHandicap:num(x?.homeHandicap ?? x?.spread?.homeOdds),
    totalLine:num(x?.totalLine ?? x?.total?.line), overOdds:num(x?.overOdds ?? x?.total?.overOdds), underOdds:num(x?.underOdds ?? x?.total?.underOdds),
  };
}
function team(v){return String(v??"").replace(/\s+/g,"").replace(/트윈스|라이온즈|베어스|자이언츠|이글스|타이거즈|위즈|다이노스|랜더스|히어로즈/g,"").replace(/^기아$/,"KIA").replace(/^엘지$/,"LG").toUpperCase();}
async function read(name,fallback){try{return JSON.parse(await fs.readFile(path.join(DATA,name),"utf8"));}catch{return fallback;}}
async function oddsFor(date,game,commenceTime){
  const oh=await read("kbo-odds-history.json",{snapshots:[]});
  const rows=(Array.isArray(oh?.snapshots)?oh.snapshots:[]).filter(x=>String(x?.date)==date && (String(x?.gameId||"")==String(game.gameId)|| (team(x?.awayTeam??x?.awayTeamName)==team(game.awayTeamName)&&team(x?.homeTeam??x?.homeTeamName)==team(game.homeTeamName)))).filter(x=>{const c=Date.parse(x?.capturedAt);const s=Date.parse(commenceTime);return !Number.isFinite(c)||!Number.isFinite(s)||c<s;}).sort((a,b)=>String(a?.capturedAt??"").localeCompare(String(b?.capturedAt??"")));
  if(rows.length) return normalizeOdds(rows[rows.length-1]);
  const bm=await read("kbo-betman-pregame-snapshots.json",{snapshots:[]});
  const br=(Array.isArray(bm?.snapshots)?bm.snapshots:[]).filter(x=>String(x?.date)==date && team(x?.awayTeamRaw??x?.awayTeam)==team(game.awayTeamName)&&team(x?.homeTeamRaw??x?.homeTeam)==team(game.homeTeamName)).filter(x=>{const c=Date.parse(x?.capturedAt);const s=Date.parse(commenceTime);return !Number.isFinite(c)||!Number.isFinite(s)||c<s;}).sort((a,b)=>String(a?.capturedAt??"").localeCompare(String(b?.capturedAt??"")));
  return br.length?normalizeOdds(br[br.length-1]):normalizeOdds({});
}

async function buildAutoPredictions(date,game,payload,commenceTime){
  const row={date,gameId:game.gameId,game,starterStats:payload?.starterStats||{},teamForms:payload?.teamForms||{},bullpens:payload?.bullpens||{},lineup:payload?.lineup||null};
  const odds=await oddsFor(date,game,commenceTime);
  const as=starterScore(row.starterStats.away), hs=starterScore(row.starterStats.home), af=formScore(row.teamForms.away), hf=formScore(row.teamForms.home), ab=bullpenScore(row.bullpens.away), hb=bullpenScore(row.bullpens.home);
  const se=as!==null&&hs!==null?as-hs:0, fe=af!==null&&hf!==null?af-hf:0, be=ab!==null&&hb!==null?ab-hb:0, le=row.lineup?.ready&&num(row.lineup?.edge)!==null?Number(row.lineup.edge):0, pt=projectedTotal(row);
  const picks=analyze(game,odds,se,fe,be,le,pt);
  const selected=new Map();
  for(const p of picks){const q=selected.get(p.market);if(!q||p.confidence>q.confidence)selected.set(p.market,p);}
  const hc=picks.filter(p=>p.market==="HANDICAP"), minus=hc.find(p=>p.label.includes("-1.5")), plus=hc.find(p=>p.label.includes("+1.5"));
  if(minus&&plus){const mt=minus.label.startsWith(game.awayTeamName)?game.awayTeamName:(minus.label.startsWith(game.homeTeamName)?game.homeTeamName:null);const ml=picks.find(p=>p.market==="ML"&&p.label===`${mt} 승`);if(ml)selected.set("HANDICAP",ml.confidence>=0.675?minus:plus);}
  return [...selected.values()].map(p=>({...p,starterEdge:se,formEdge:fe,bullpenEdge:be,lineupEdge:le,projectedTotal:pt,totalLine:odds.totalLine}));
}

module.exports={buildAutoPredictions};

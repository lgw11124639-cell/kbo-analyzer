const fs=require("fs"),http=require("http"),crypto=require("crypto");
const kstDate=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const DATE=process.env.CAPTURE_DATE||kstDate();
const BASE="http://127.0.0.1:3200";
const STARTER_FILE="data/kbo-h15-shadow-starter-2026.json";
const BP_FILE="data/kbo-h15-shadow-bullpen-2026.json";
const OUT=process.env.CAPTURE_OUT||require("path").join(process.cwd(),"data","ref2843543-shadow","captures",`${DATE}.json`);
const WHIP_MEAN=1.455191,WHIP_SD=.351002,U_INTERCEPT=2.585862,U_SLOPE=.246771,U_HIGH=2.717549;
function n(v){if(v===null||v===undefined||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function mean(a){const z=a.filter(Number.isFinite);return z.length?z.reduce((s,v)=>s+v,0)/z.length:null}
function get(u){return new Promise((res,rej)=>http.get(u,r=>{let s="";r.on("data",d=>s+=d);r.on("end",()=>{try{res(JSON.parse(s))}catch(e){rej(new Error("JSON "+u+" "+s.slice(0,200)))}})}).on("error",rej))}
function shaFile(p){return fs.existsSync(p)?crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"):null}
function starterInfo(st){if(!st)return{era:null,ip:5};const se=n(st.era),re=n(st.recent5?.era);let era=null;if(se!==null&&re!==null)era=.5*se+.5*re;else era=se??re;const si=n(st.innings),sg=n(st.games),ri=n(st.recent5?.innings),rg=n(st.recent5?.games);let ip=null;if(ri!==null&&rg!==null&&rg>0)ip=ri/rg;else if(si!==null&&sg!==null&&sg>0)ip=si/sg;return{era,ip:clamp(ip??5,3.5,7)}}
function bpEra(bp){const s=n(bp?.season?.era),r=n(bp?.recent14?.era);if(s!==null&&r!==null)return .4*s+.6*r;return s??r}
function score(T,O,defStarter,defBp){const league=n(T?.leagueRunsPerTeamD1)??n(O?.leagueRunsPerTeamD1)??4.5,off=n(T?.seasonAvgRuns),oa=n(O?.seasonAvgRunsAllowed),base=mean([off,oa])??league,si=starterInfo(defStarter),anchor=oa??base,starterAdj=si.era===null?0:(si.era-anchor)*(si.ip/9)*.5,bpe=bpEra(defBp),bpIP=clamp(9-si.ip,2,5.5),bpAdj=bpe===null?0:(bpe-anchor)*(bpIP/9)*.75;return{mu:clamp(base+starterAdj+bpAdj,.5,12),base,anchor,starterEra:si.era,starterIp:si.ip,bpEra:bpe,bpIp:bpIP,starterAdj,bullpenAdj:bpAdj}}
function uncertainty(st){const w=n(st?.recent5?.whip);if(w===null)return{usable:false,defendingStarterRecent5Whip:null,z:null,predictedAbsError:null,high:false};const z=(w-WHIP_MEAN)/WHIP_SD,u=Math.max(.05,U_INTERCEPT+U_SLOPE*z);return{usable:true,defendingStarterRecent5Whip:w,z,predictedAbsError:u,high:u>=U_HIGH}}
(async()=>{
const EXISTING=fs.existsSync(OUT)?JSON.parse(fs.readFileSync(OUT,"utf8")):null;
const EXISTING_ROWS=Array.isArray(EXISTING?.rows)?EXISTING.rows:[];
const EXISTING_IDS=new Set(EXISTING_ROWS.map(r=>String(r.gameId||"")));
if(!fs.existsSync(STARTER_FILE))throw new Error("STARTER_SHADOW_MISSING");
if(!fs.existsSync(BP_FILE))throw new Error("BULLPEN_SHADOW_MISSING");
const ST=JSON.parse(fs.readFileSync(STARTER_FILE,"utf8"));
const BP=JSON.parse(fs.readFileSync(BP_FILE,"utf8"));
const sm=new Map((ST.snapshots||[]).filter(x=>x.date===DATE).map(x=>[String(x.gameId),x]));
const bm=new Map((BP.snapshots||[]).filter(x=>x.date===DATE).map(x=>[String(x.gameId),x]));
const today=await get(`${BASE}/api/kbo/today?date=${DATE}`);
const games=Array.isArray(today?.games)?today.games:[];
const capturedAt=new Date().toISOString();
const rows=[];
for(const g of games){
 const gid=String(g.gameId||"");
 if(EXISTING_IDS.has(gid)){console.log("KEEP_EXISTING_CAPTURE",gid);continue}
 const state=String(g.status?.stateCode??"");
 const cancelCode=String(g.status?.cancelCode??"");
 const fixtureStatus=state==="1"?"Pre-Game":state==="2"?"In-Progress":state==="3"?"Final":"Unknown";
 if(fixtureStatus!=="Pre-Game"||cancelCode!=="0"){console.log("SKIP_NOT_PREGAME",gid,fixtureStatus,"state",state,"cancel",cancelCode);continue}
 const s=sm.get(gid),b=bm.get(gid);
 if(!s){console.log("SKIP_NO_STARTER_SHADOW",gid);continue}
 if(!b){console.log("SKIP_NO_BULLPEN_SHADOW",gid);continue}
 const awayTeam=g.awayTeamName,homeTeam=g.homeTeamName;
 const af=await get(`${BASE}/api/kbo/team-form?team=${encodeURIComponent(awayTeam)}&date=${DATE}`);
 const hf=await get(`${BASE}/api/kbo/team-form?team=${encodeURIComponent(homeTeam)}&date=${DATE}`);
 const awayForm={seasonGames:n(af.seasonGames),seasonAvgRuns:n(af.seasonAvgRuns),seasonAvgRunsAllowed:n(af.seasonAvgRunsAllowed),leagueRunsPerTeamD1:n(af.leagueRunsPerTeamD1)};
 const homeForm={seasonGames:n(hf.seasonGames),seasonAvgRuns:n(hf.seasonAvgRuns),seasonAvgRunsAllowed:n(hf.seasonAvgRunsAllowed),leagueRunsPerTeamD1:n(hf.leagueRunsPerTeamD1)};
 const away=score(awayForm,homeForm,s.homeStarter?.stats,b.home);
 const home=score(homeForm,awayForm,s.awayStarter?.stats,b.away);
 const awayU=uncertainty(s.homeStarter?.stats),homeU=uncertainty(s.awayStarter?.stats);
 rows.push({gameId:gid,date:DATE,capturedAt,fixtureStatus,scheduledStart:g.scheduledStart??g.startTime??g.time??null,awayTeam,homeTeam,refAwayScore:away.mu,refHomeScore:home.mu,refWinner:away.mu>home.mu?"AWAY":home.mu>away.mu?"HOME":"TIE",refMargin:Math.abs(away.mu-home.mu),v3:{away:awayU,home:homeU},sourceHashes:{starterFileSha256:shaFile(STARTER_FILE),bullpenFileSha256:shaFile(BP_FILE)},inputs:{teamForm:{away:awayForm,home:homeForm},starter:{away:s.awayStarter,home:s.homeStarter},bullpen:{away:b.away,home:b.home}},components:{away,home}});
 console.log("CAPTURE",gid,awayTeam,"@",homeTeam,"REF",away.mu.toFixed(6),home.mu.toFixed(6),"V3",awayU.high?"AWAY_HIGH":"AWAY_LOW",homeU.high?"HOME_HIGH":"HOME_LOW");
}
const mergedRows=[...EXISTING_ROWS,...rows];
const out={generatedAt:EXISTING?.generatedAt??new Date().toISOString(),lastAppendAt:new Date().toISOString(),captureDate:DATE,status:"PRE_GAME_SHADOW_CAPTURE_ONLY",referenceModel:"REF-2843543",uncertaintySpec:"WHIP_UNCERTAINTY_V3_SHADOW",provenance:EXISTING?.provenance??{todayApi:`${BASE}/api/kbo/today?date=${DATE}`,teamFormApi:`${BASE}/api/kbo/team-form`,starterFile:STARTER_FILE,bullpenFile:BP_FILE},frozenParameters:{starterEraBlend:[.5,.5],starterWeight:.5,bullpenEraBlend:[.4,.6],bullpenWeight:.75,whipMean:WHIP_MEAN,whipSd:WHIP_SD,uncertaintyIntercept:U_INTERCEPT,uncertaintySlope:U_SLOPE,uncertaintyHighCutoff:U_HIGH},rules:["PRE_GAME_ONLY","PER_GAME_FIRST_FREEZE","APPEND_ONLY","NO_RESULT_FIELDS","NO_RETUNE","NO_REF_MEAN_CHANGE","NO_PRODUCTION_CONFIDENCE_CHANGE","PRODUCTION_.675_UNCHANGED"],rows:mergedRows};
if(rows.length===0&&fs.existsSync(OUT)){console.log("NO_NEW_GAMES_KEEP_FILE",JSON.stringify({file:OUT,existingRows:EXISTING_ROWS.length,sha256:shaFile(OUT)}));return}
fs.writeFileSync(OUT,JSON.stringify(out,null,2));
const hash=shaFile(OUT);
console.log("CAPTURE_DONE",JSON.stringify({date:DATE,todayGames:games.length,newRows:rows.length,totalRows:mergedRows.length,file:OUT,sha256:hash}));
})().catch(e=>{console.error("CAPTURE_FAILED",e.message);process.exitCode=0});

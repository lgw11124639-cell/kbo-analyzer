const fs=require("fs"),http=require("http"),crypto=require("crypto");
const DATE=process.env.SETTLE_DATE||new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const CAPTURE=process.env.CAPTURE_FILE||require("path").join(process.cwd(),"data","ref2843543-shadow","captures",`${DATE}.json`);
const TRACKER=process.env.TRACKER_FILE||require("path").join(process.cwd(),"data","ref2843543-shadow","unseen-tracker.json");
const TEST_MODE=process.env.TEST_MODE==="1";
const COMMIT=process.env.COMMIT==="1";
const EXPECTED_MODEL="REF-2843543";
const EXPECTED_SPEC="23fd3e5fa9344dee162bcb71532a494aa7fef2695b9e781b1db1b9dc9c5539e8";
const EXPECTED_START_DATE="2026-09-21";
const BASE="http://127.0.0.1:3200";
function n(v){if(v===null||v===undefined||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null}
function sha(p){return fs.existsSync(p)?crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"):null}
function shaObj(v){return crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex")}
function get(u){return new Promise((res,rej)=>http.get(u,r=>{let s="";r.on("data",d=>s+=d);r.on("end",()=>{try{res(JSON.parse(s))}catch(e){rej(new Error("JSON "+u+" "+s.slice(0,200)))}})}).on("error",rej))}
(async()=>{
if(!fs.existsSync(CAPTURE))throw new Error("CAPTURE_MISSING "+CAPTURE);
if(!fs.existsSync(TRACKER))throw new Error("TRACKER_MISSING "+TRACKER);
const cap=JSON.parse(fs.readFileSync(CAPTURE,"utf8"));
const tracker=JSON.parse(fs.readFileSync(TRACKER,"utf8"));
if(!Array.isArray(cap.rows))throw new Error("CAPTURE_ROWS_INVALID");
if(!Array.isArray(tracker.rows))throw new Error("TRACKER_ROWS_INVALID");
if(cap.referenceModel!==EXPECTED_MODEL)throw new Error("CAPTURE_MODEL_MISMATCH "+String(cap.referenceModel));
if(cap.status!=="PRE_GAME_SHADOW_CAPTURE_ONLY")throw new Error("CAPTURE_STATUS_MISMATCH "+String(cap.status));
if(tracker.referenceModel!==EXPECTED_MODEL)throw new Error("TRACKER_MODEL_MISMATCH "+String(tracker.referenceModel));
if(tracker.specSha256!==EXPECTED_SPEC)throw new Error("TRACKER_SPEC_MISMATCH "+String(tracker.specSha256));
if(tracker.startDate!==EXPECTED_START_DATE)throw new Error("TRACKER_START_DATE_MISMATCH "+String(tracker.startDate));
if(!TEST_MODE&&DATE<tracker.startDate)throw new Error("PRE_UNSEEN_DATE_BLOCKED "+DATE);
const existing=new Set(tracker.rows.map(r=>String(r.gameId||"")));
const today=await get(`${BASE}/api/kbo/today?date=${DATE}`);
const gm=new Map((today.games||[]).map(g=>[String(g.gameId||""),g]));
let added=0,wouldAdd=0,notFinal=0,missingGame=0,badScore=0,badCapture=0;
for(const pre of cap.rows){
 const gid=String(pre.gameId||"");
 if(!gid||existing.has(gid)){if(existing.has(gid))console.log("KEEP_SETTLED",gid);continue}
 if(pre.fixtureStatus!=="Pre-Game"){console.log("SKIP_BAD_CAPTURE_STATUS",gid,pre.fixtureStatus);continue}
 if(!pre.capturedAt){badCapture++;console.log("SKIP_NO_CAPTURE_TIME",gid);continue}
 if(String(pre.date||"")!==DATE){badCapture++;console.log("SKIP_CAPTURE_DATE_MISMATCH",gid,pre.date,DATE);continue}
 if(!TEST_MODE&&String(pre.date||"")<tracker.startDate){badCapture++;console.log("SKIP_PRE_UNSEEN_CAPTURE",gid);continue}
 const refA=n(pre.refAwayScore),refH=n(pre.refHomeScore);
 if(refA===null||refH===null){badCapture++;console.log("SKIP_BAD_FROZEN_REF",gid,pre.refAwayScore,pre.refHomeScore);continue}
 if(!pre.v3||!pre.v3.away||!pre.v3.home){badCapture++;console.log("SKIP_MISSING_V3",gid);continue}
 const g=gm.get(gid);
 if(!g){missingGame++;console.log("MISSING_GAME",gid);continue}
 if(String(g.status?.stateCode)!=="3"){notFinal++;console.log("NOT_FINAL",gid);continue}
 const a=n(g.awayScore??g.score?.away??g.status?.awayScore);
 const h=n(g.homeScore??g.score?.home??g.status?.homeScore);
 if(a===null||h===null){badScore++;console.log("FINAL_SCORE_MISSING",gid,JSON.stringify(g.status));continue}
 const aeA=Math.abs(a-refA),aeH=Math.abs(h-refH);
 const sqA=(a-refA)**2,sqH=(h-refH)**2;
 const row={gameId:gid,date:pre.date,capturedAt:pre.capturedAt,settledAt:new Date().toISOString(),captureSha256:sha(CAPTURE),pregameRowSha256:shaObj(pre),awayTeam:pre.awayTeam,homeTeam:pre.homeTeam,refAwayScore:pre.refAwayScore,refHomeScore:pre.refHomeScore,actualAwayScore:a,actualHomeScore:h,awayResidual:a-refA,homeResidual:h-refH,awayAbsError:aeA,homeAbsError:aeH,awaySqError:sqA,homeSqError:sqH,v3:pre.v3,sourceHashes:pre.sourceHashes??null,referenceModel:cap.referenceModel,uncertaintySpec:cap.uncertaintySpec};
 wouldAdd++;
 if(!COMMIT){console.log("DRY_RUN_SETTLED",gid,pre.awayTeam,"@",pre.homeTeam,"ACT",a,h,"AE",aeA.toFixed(3),aeH.toFixed(3));continue}
 tracker.rows.push(row);existing.add(gid);added++;console.log("SETTLED",gid,pre.awayTeam,"@",pre.homeTeam,"ACT",a,h,"AE",aeA.toFixed(3),aeH.toFixed(3));
}
if(!COMMIT){console.log("DRY_RUN_DONE_NO_WRITE",JSON.stringify({date:DATE,wouldAdd,notFinal,missingGame,badScore,badCapture,totalRows:tracker.rows.length,tracker:TRACKER,sha256:sha(TRACKER)}));return}
if(added===0){console.log("NO_NEW_SETTLEMENT_KEEP_TRACKER",JSON.stringify({date:DATE,wouldAdd,notFinal,missingGame,badScore,badCapture,totalRows:tracker.rows.length,tracker:TRACKER,sha256:sha(TRACKER)}));return}
tracker.rows.sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.gameId).localeCompare(String(b.gameId)));
tracker.updatedAt=new Date().toISOString();
tracker.lastSettlement={date:DATE,added,wouldAdd,notFinal,missingGame,badScore,badCapture,testMode:TEST_MODE,commit:COMMIT,captureFile:CAPTURE,captureSha256:sha(CAPTURE)};
fs.writeFileSync(TRACKER,JSON.stringify(tracker,null,2));
console.log("SETTLE_DONE",JSON.stringify({date:DATE,added,notFinal,missingGame,badScore,totalRows:tracker.rows.length,tracker:TRACKER,sha256:sha(TRACKER)}));
})().catch(e=>{console.error("SETTLE_FAILED",e.message);process.exitCode=0});

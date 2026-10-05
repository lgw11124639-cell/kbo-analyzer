import modelJson from "../../data/kbo-engine-v1-champion.json";

export const KBO_PICK_ENGINE_VERSION = "1.0";
export const KBO_PICK_ENGINE_NAME = "KBO PICK 엔진";

type ChampionModel = { version:string; trainedThrough:string; trainingGames:number; ridge:number; dispersion:{away:number;home:number}; mu:number[]; sd:number[]; awayWeights:number[]; homeWeights:number[]; };

export type KboPickInputs = { awayAvgRuns:number; awayAvgRunsAllowed:number; homeAvgRuns:number; homeAvgRunsAllowed:number; starterEdge?:number|null; formEdge?:number|null; awayLineupOps?:number|null; homeLineupOps?:number|null; };

export type ScoreCell = { away:number; home:number; probability:number; };

const M=modelJson as ChampionModel;
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const num=(v:number|null|undefined)=>Number.isFinite(Number(v))?Number(v):0;
const dot=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*(b[i]??0),0);

function features(x:KboPickInputs){const awayOps=Number.isFinite(Number(x.awayLineupOps))?Number(x.awayLineupOps):M.mu[7];const homeOps=Number.isFinite(Number(x.homeLineupOps))?Number(x.homeLineupOps):M.mu[8];return [1,(num(x.awayAvgRuns)+num(x.homeAvgRunsAllowed))/2,(num(x.homeAvgRuns)+num(x.awayAvgRunsAllowed))/2,num(x.starterEdge),num(x.formEdge),0,0,awayOps,homeOps];}

function nbin(k:number,mu:number,size:number){let logp=0;for(let i=1;i<=k;i++)logp+=Math.log(size+i-1)-Math.log(i);logp+=size*Math.log(size/(size+mu))+k*Math.log(mu/(size+mu));return Math.exp(logp);}

export function expectedScores(x:KboPickInputs){const f=features(x);const z=f.map((v,i)=>i===0?1:(v-(M.mu[i]??0))/(M.sd[i]||1));return {away:clamp(dot(M.awayWeights,z),1.5,9),home:clamp(dot(M.homeWeights,z),1.5,9)};}

export function scoreDistribution(x:KboPickInputs){const e=expectedScores(x),cells:ScoreCell[]=[];let mass=0;for(let a=0;a<=30;a++)for(let h=0;h<=30;h++){const p=nbin(a,e.away,M.dispersion.away)*nbin(h,e.home,M.dispersion.home);cells.push({away:a,home:h,probability:p});mass+=p;}for(const c of cells)c.probability/=mass;return {expected:e,cells};}

export function moneylineProbability(x:KboPickInputs){const d=scoreDistribution(x);let away=0,home=0,tie=0;for(const c of d.cells){if(c.away>c.home)away+=c.probability;else if(c.home>c.away)home+=c.probability;else tie+=c.probability;}const settled=away+home;return {away:settled?away/settled:.5,home:settled?home/settled:.5,tie,expected:d.expected};}

export function handicapProbability(x:KboPickInputs,side:"away"|"home",line:number){const d=scoreDistribution(x);let win=0,push=0;for(const c of d.cells){const margin=(side==="away"?c.away-c.home:c.home-c.away)+line;if(margin>0)win+=c.probability;else if(Math.abs(margin)<1e-12)push+=c.probability;}return {win:win/(1-push||1),push,expected:d.expected};}

export function totalProbability(x:KboPickInputs,line:number){const d=scoreDistribution(x);let over=0,under=0,push=0;for(const c of d.cells){const z=c.away+c.home-line;if(z>0)over+=c.probability;else if(z<0)under+=c.probability;else push+=c.probability;}const settled=1-push;return {over:over/(settled||1),under:under/(settled||1),push,expected:d.expected};}

export function kboPickEngineInfo(){return {name:KBO_PICK_ENGINE_NAME,version:KBO_PICK_ENGINE_VERSION,modelVersion:M.version,trainedThrough:M.trainedThrough,trainingGames:M.trainingGames,mode:"SHADOW" as const};}

export type KboPickMarketResult = { engine:string; version:string; expected:{away:number;home:number}; moneyline:{away:number;home:number;tie:number}; handicap:(side:"away"|"home",line:number)=>{win:number;push:number}; total:(line:number)=>{over:number;under:number;push:number}; };

export function analyzeKboPickGame(x:KboPickInputs):KboPickMarketResult{const d=scoreDistribution(x);let aw=0,hw=0,tie=0;for(const c of d.cells){if(c.away>c.home)aw+=c.probability;else if(c.home>c.away)hw+=c.probability;else tie+=c.probability;}const settled=aw+hw;return{engine:KBO_PICK_ENGINE_NAME,version:KBO_PICK_ENGINE_VERSION,expected:d.expected,moneyline:{away:settled?aw/settled:.5,home:settled?hw/settled:.5,tie},handicap:(side,line)=>{let win=0,push=0;for(const c of d.cells){const z=(side==="away"?c.away-c.home:c.home-c.away)+line;if(z>0)win+=c.probability;else if(Math.abs(z)<1e-12)push+=c.probability;}return{win:win/(1-push||1),push};},total:(line)=>{let over=0,under=0,push=0;for(const c of d.cells){const z=c.away+c.home-line;if(z>0)over+=c.probability;else if(z<0)under+=c.probability;else push+=c.probability;}const settledTotal=1-push;return{over:over/(settledTotal||1),under:under/(settledTotal||1),push};}};}

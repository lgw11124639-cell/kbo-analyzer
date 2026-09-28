import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const pub=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
const secret=process.env.SUPABASE_SECRET_KEY||"";
const pc=()=>createClient(url,pub,{auth:{persistSession:false,autoRefreshToken:false}});
const ac=()=>createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

async function userOf(r:NextRequest){
 const t=(r.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
 if(!t)return null; const {data}=await pc().auth.getUser(t); return data.user||null;
}
function nameOf(u:any){return String(u?.user_metadata?.nickname||u?.user_metadata?.name||u?.email?.split("@")[0]||"KBO 팬").trim().slice(0,30)}
function adminOf(u:any){return u?.app_metadata?.role==="admin"||u?.user_metadata?.role==="admin"||String(process.env.COMMUNITY_ADMIN_USER_IDS||"").split(",").map(x=>x.trim()).includes(u?.id)}
function cleanImages(v:any){return Array.isArray(v)?v.slice(0,5).filter((x:any)=>x&&typeof x.url==="string").map((x:any)=>({path:String(x.path||""),url:String(x.url),name:String(x.name||"")})):[]}

export async function GET(r:NextRequest){
 try{
  const a=ac(),u=await userOf(r),p=r.nextUrl.searchParams;
  const category=String(p.get("category")||"all"),gameId=String(p.get("gameId")||"").trim(),sort=String(p.get("sort")||"latest");
  let q=a.from("kbo_community_posts").select("*");
  if(category!=="all")q=q.eq("category",category); if(gameId)q=q.eq("game_id",gameId);
  q=sort==="popular"?q.order("is_notice",{ascending:false}).order("like_count",{ascending:false}).order("comment_count",{ascending:false}).order("created_at",{ascending:false}):q.order("is_notice",{ascending:false}).order("created_at",{ascending:false});
  const {data,error}=await q.limit(100); if(error)throw error;
  let liked=new Set<string>(); if(u&&data?.length){const {data:l,error:e}=await a.from("kbo_community_likes").select("post_id").eq("user_id",u.id).in("post_id",data.map((x:any)=>x.id));if(e)throw e;liked=new Set((l||[]).map((x:any)=>x.post_id))}
  return NextResponse.json({ok:true,isAdmin:!!u&&adminOf(u),posts:(data||[]).map((x:any)=>({...x,likedByMe:liked.has(x.id),mine:u?.id===x.user_id}))},{headers:{"Cache-Control":"no-store"}});
 }catch(e){console.error(e);return NextResponse.json({ok:false,error:"COMMUNITY_LOAD_FAILED"},{status:500})}
}
export async function POST(r:NextRequest){
 try{
  const u=await userOf(r);if(!u)return NextResponse.json({ok:false,error:"LOGIN_REQUIRED"},{status:401});
  const b=await r.json(),title=String(b.title||"").trim(),content=String(b.content||"").trim(),category=String(b.category||"talk"),gameId=String(b.gameId||"").trim()||null;
  if(!title||title.length>100||!content||content.length>10000)return NextResponse.json({ok:false,error:"INVALID_POST"},{status:400});
  if(!["talk","game","analysis","combo"].includes(category))return NextResponse.json({ok:false,error:"INVALID_CATEGORY"},{status:400});
  const isNotice=!!b.isNotice&&adminOf(u);
  const {data,error}=await ac().from("kbo_community_posts").insert({user_id:u.id,author_name:nameOf(u),category,game_id:gameId,title,content,images:cleanImages(b.images),is_notice:isNotice}).select("*").single();
  if(error)throw error;return NextResponse.json({ok:true,post:{...data,mine:true,likedByMe:false}});
 }catch(e){console.error(e);return NextResponse.json({ok:false,error:"COMMUNITY_POST_FAILED"},{status:500})}
}
export async function PATCH(r:NextRequest){
 try{
  const u=await userOf(r);if(!u)return NextResponse.json({ok:false,error:"LOGIN_REQUIRED"},{status:401});
  const b=await r.json(),id=String(b.id||"").trim(); if(!id)return NextResponse.json({ok:false,error:"POST_ID_REQUIRED"},{status:400});
  const a=ac(),{data:old,error:oe}=await a.from("kbo_community_posts").select("*").eq("id",id).maybeSingle();if(oe)throw oe;if(!old)return NextResponse.json({ok:false,error:"POST_NOT_FOUND"},{status:404});
  const isAdmin=adminOf(u);if(old.user_id!==u.id&&!isAdmin)return NextResponse.json({ok:false,error:"FORBIDDEN"},{status:403});
  const title=String(b.title||"").trim(),content=String(b.content||"").trim(),category=String(b.category||old.category);
  if(!title||title.length>100||!content||content.length>10000)return NextResponse.json({ok:false,error:"INVALID_POST"},{status:400});
  const patch:any={title,content,category,game_id:category==="game"?(String(b.gameId||"").trim()||null):null,images:cleanImages(b.images),updated_at:new Date().toISOString()};
  if(isAdmin)patch.is_notice=!!b.isNotice;
  const {data,error}=await a.from("kbo_community_posts").update(patch).eq("id",id).select("*").single();if(error)throw error;
  const keep=new Set(patch.images.map((x:any)=>x.path).filter(Boolean));const remove=(Array.isArray(old.images)?old.images:[]).map((x:any)=>x?.path).filter((x:any)=>x&&!keep.has(x));if(remove.length)await a.storage.from("community-images").remove(remove);
  return NextResponse.json({ok:true,post:{...data,mine:data.user_id===u.id}});
 }catch(e){console.error(e);return NextResponse.json({ok:false,error:"POST_UPDATE_FAILED"},{status:500})}
}
export async function DELETE(r:NextRequest){
 try{
  const u=await userOf(r);if(!u)return NextResponse.json({ok:false,error:"LOGIN_REQUIRED"},{status:401});
  const id=String(r.nextUrl.searchParams.get("id")||"").trim(),a=ac();const {data:old,error:oe}=await a.from("kbo_community_posts").select("user_id,images").eq("id",id).maybeSingle();if(oe)throw oe;if(!old)return NextResponse.json({ok:false,error:"POST_NOT_FOUND"},{status:404});
  if(old.user_id!==u.id&&!adminOf(u))return NextResponse.json({ok:false,error:"FORBIDDEN"},{status:403});
  const {error}=await a.from("kbo_community_posts").delete().eq("id",id);if(error)throw error;
  const paths=(Array.isArray(old.images)?old.images:[]).map((x:any)=>x?.path).filter(Boolean);if(paths.length)await a.storage.from("community-images").remove(paths);
  return NextResponse.json({ok:true});
 }catch(e){console.error(e);return NextResponse.json({ok:false,error:"POST_DELETE_FAILED"},{status:500})}
}
import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";

export const dynamic="force-dynamic";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const pub=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
const secret=process.env.SUPABASE_SECRET_KEY||"";

const publicClient=()=>createClient(url,pub,{
  auth:{persistSession:false,autoRefreshToken:false}
});

const adminClient=()=>createClient(url,secret,{
  auth:{persistSession:false,autoRefreshToken:false}
});

async function authUser(req:NextRequest){
  const h=req.headers.get("authorization")||"";
  const token=h.startsWith("Bearer ")?h.slice(7):"";

  if(!token) return null;

  const {data,error}=await publicClient().auth.getUser(token);

  if(error||!data.user) return null;

  return data.user;
}

export async function GET(req:NextRequest){
  try{
    const user=await authUser(req);

    if(!user){
      return NextResponse.json(
        {error:"로그인이 필요합니다."},
        {status:401}
      );
    }

    const admin=adminClient();

    const [
      walletResult,
      titlesResult,
      ownedResult,
      profileResult
    ]=await Promise.all([
      admin
        .from("kbo_baseball_wallets")
        .select("balance")
        .eq("user_id",user.id)
        .maybeSingle(),

      admin
        .from("kbo_titles")
        .select("id,name,description,price,tier,badge,sort_order,is_active")
        .eq("is_active",true)
        .order("sort_order",{ascending:true})
        .order("price",{ascending:true}),

      admin
        .from("kbo_user_titles")
        .select("title_id,purchased_at")
        .eq("user_id",user.id),

      admin
        .from("kbo_user_profiles")
        .select("nickname,equipped_title_id")
        .eq("user_id",user.id)
        .maybeSingle()
    ]);

    if(walletResult.error){
      console.error("STORE_WALLET_ERROR",walletResult.error);
      return NextResponse.json(
        {error:"야구공 정보를 불러오지 못했습니다."},
        {status:500}
      );
    }

    if(titlesResult.error){
      console.error("STORE_TITLES_ERROR",titlesResult.error);
      return NextResponse.json(
        {error:"칭호 정보를 불러오지 못했습니다."},
        {status:500}
      );
    }

    if(ownedResult.error){
      console.error("STORE_OWNED_ERROR",ownedResult.error);
      return NextResponse.json(
        {error:"보유 칭호 정보를 불러오지 못했습니다."},
        {status:500}
      );
    }

    if(profileResult.error){
      console.error("STORE_PROFILE_ERROR",profileResult.error);
      return NextResponse.json(
        {error:"프로필 정보를 불러오지 못했습니다."},
        {status:500}
      );
    }

    const ownedIds=(ownedResult.data||[]).map(v=>v.title_id);

    const metaNickname=
      typeof user.user_metadata?.nickname==="string"
        ? user.user_metadata.nickname.trim()
        :"";

    const emailName=
      String(user.email||"").split("@")[0]||"KBO 팬";

    return NextResponse.json({
      balance:Number(walletResult.data?.balance||0),

      titles:(titlesResult.data||[]).map(title=>({
        ...title,
        owned:ownedIds.includes(title.id),
        equipped:profileResult.data?.equipped_title_id===title.id
      })),

      ownedTitleIds:ownedIds,

      profile:{
        nickname:
          profileResult.data?.nickname||
          metaNickname||
          emailName,

        equippedTitleId:
          profileResult.data?.equipped_title_id||null
      }
    });

  }catch(error){
    console.error("STORE_GET_ERROR",error);

    return NextResponse.json(
      {error:"상점 정보를 불러오는 중 오류가 발생했습니다."},
      {status:500}
    );
  }
}

export async function POST(req:NextRequest){
  try{
    const user=await authUser(req);

    if(!user){
      return NextResponse.json(
        {error:"로그인이 필요합니다."},
        {status:401}
      );
    }

    const body=await req.json().catch(()=>({}));
    const action=String(body?.action||"");
    const titleId=String(body?.titleId||"").trim();

    if(!titleId && action!=="unequip"){
      return NextResponse.json(
        {error:"칭호 정보가 없습니다."},
        {status:400}
      );
    }

    const admin=adminClient();

    if(action==="purchase"){
      const {data,error}=await admin.rpc(
        "kbo_purchase_title",
        {
          p_user_id:user.id,
          p_title_id:titleId
        }
      );

      if(error){
        console.error("TITLE_PURCHASE_RPC_ERROR",error);

        return NextResponse.json(
          {error:error.message||"칭호 구매에 실패했습니다."},
          {status:400}
        );
      }

      return NextResponse.json({
        ok:true,
        result:data
      });
    }

    if(action==="equip"){
      const {data,error}=await admin.rpc(
        "kbo_equip_title",
        {
          p_user_id:user.id,
          p_title_id:titleId
        }
      );

      if(error){
        console.error("TITLE_EQUIP_RPC_ERROR",error);

        return NextResponse.json(
          {error:error.message||"칭호 장착에 실패했습니다."},
          {status:400}
        );
      }

      return NextResponse.json({
        ok:true,
        result:data
      });
    }

    if(action==="unequip"){
      const {data,error}=await admin.rpc(
        "kbo_unequip_title",
        {
          p_user_id:user.id
        }
      );

      if(error){
        console.error("TITLE_UNEQUIP_RPC_ERROR",error);

        return NextResponse.json(
          {error:error.message||"칭호 해제에 실패했습니다."},
          {status:400}
        );
      }

      return NextResponse.json({
        ok:true,
        result:data
      });
    }

    return NextResponse.json(
      {error:"지원하지 않는 요청입니다."},
      {status:400}
    );

  }catch(error){
    console.error("STORE_POST_ERROR",error);

    return NextResponse.json(
      {error:"상점 처리 중 오류가 발생했습니다."},
      {status:500}
    );
  }
}

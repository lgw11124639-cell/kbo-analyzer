"use client";

import {useCallback,useEffect,useMemo,useState} from "react";
import {createClient, type User} from "@supabase/supabase-js";

type StoreTitle={
  id:string;
  name:string;
  description:string;
  price:number;
  tier:number;
  badge:string;
  sort_order?:number;
  is_active?:boolean;
  owned?:boolean;
  equipped?:boolean;
};

type StoreData={
  balance:number;
  titles:StoreTitle[];
  ownedTitleIds:string[];
  profile:{
    nickname:string;
    equippedTitleId:string|null;
  };
};

type Props={
  user:User|null;
  onBalanceChange?:(balance:number)=>void;
};

const CHARGE_PRODUCTS=[
  {
    price:"1,100원",
    balls:"3,000",
    detail:"분석 1회",
    tag:""
  },
  {
    price:"3,300원",
    balls:"10,000",
    detail:"기본 9,000 + 보너스 1,000",
    tag:""
  },
  {
    price:"5,500원",
    balls:"18,000",
    detail:"분석 6회",
    tag:"인기"
  },
  {
    price:"11,000원",
    balls:"38,000",
    detail:"대용량 충전",
    tag:""
  },
  {
    price:"22,000원",
    balls:"80,000",
    detail:"보너스 강화",
    tag:""
  },
  {
    price:"55,000원",
    balls:"210,000",
    detail:"최대 충전",
    tag:"BEST"
  }
];

function tierName(tier:number){
  if(tier>=5)return "LEGEND";
  if(tier===4)return "PREMIUM";
  if(tier===3)return "SPECIAL";
  if(tier===2)return "ADVANCED";
  return "BASIC";
}

export default function StorePage({
  user,
  onBalanceChange
}:Props){
  const [data,setData]=useState<StoreData|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [tab,setTab]=useState<"charge"|"titles">("charge");

  const supabase=useMemo(
    ()=>createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL||"",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"",
      {
        auth:{
          persistSession:true,
          autoRefreshToken:true
        }
      }
    ),
    []
  );

  const loadStore=useCallback(async()=>{
    if(!user){
      setLoading(false);
      setError("로그인이 필요합니다.");
      return;
    }

    setLoading(true);
    setError("");

    try{
      const {
        data:{session}
      }=await supabase.auth.getSession();

      const token=session?.access_token;

      if(!token){
        throw new Error("로그인 세션을 확인할 수 없습니다.");
      }

      const res=await fetch("/api/store/titles",{
        method:"GET",
        cache:"no-store",
        headers:{
          Authorization:`Bearer ${token}`
        }
      });

      const json=await res.json().catch(()=>({}));

      if(!res.ok){
        throw new Error(
          json?.error||
          `상점 정보를 불러오지 못했습니다. (${res.status})`
        );
      }

      const next:StoreData={
        balance:Number(json?.balance||0),
        titles:Array.isArray(json?.titles)
          ? json.titles.map((title:any)=>({
              ...title,
              price:Number(title?.price||0),
              tier:Number(title?.tier||1),
              owned:Boolean(title?.owned),
              equipped:Boolean(title?.equipped)
            }))
          :[],
        ownedTitleIds:Array.isArray(json?.ownedTitleIds)
          ? json.ownedTitleIds
          :[],
        profile:{
          nickname:String(json?.profile?.nickname||""),
          equippedTitleId:
            json?.profile?.equippedTitleId
              ? String(json.profile.equippedTitleId)
              : null
        }
      };

      setData(next);
      onBalanceChange?.(next.balance);

    }catch(e){
      console.error("STORE_CLIENT_LOAD_ERROR",e);
      setError(
        e instanceof Error
          ? e.message
          :"상점 정보를 불러오는 중 오류가 발생했습니다."
      );
    }finally{
      setLoading(false);
    }
  },[user,supabase,onBalanceChange]);

  useEffect(()=>{
    void loadStore();
  },[loadStore]);

  const balance=Number(data?.balance||0);
  const titles=data?.titles||[];
  const ownedCount=titles.filter(v=>v.owned).length;

  return(
    <main className="titleStorePageV1 storeWidePageV3 storePageFinalV5">

      <section className="storeHeroFinalV5">
        <div className="storeHeroCopyFinalV5">
          <small>KBO PICKS STORE</small>
          <h1>상점</h1>
          <p>
            야구공을 충전하고 다양한 아이템을 이용해보세요.
          </p>
        </div>

        <div className="storeHeroStatsFinalV5">
          <div>
            <span>보유 야구공</span>
            <strong>
              ⚾ {balance.toLocaleString()}
            </strong>
          </div>

          <div>
            <span>보유 칭호</span>
            <strong>
              {ownedCount} / {titles.length}
            </strong>
          </div>
        </div>
      </section>

      <div className="storeTabsFinalV5">
        <button
          type="button"
          className={tab==="charge"?"active":""}
          onClick={()=>setTab("charge")}
        >
          ⚾ 야구공 충전
        </button>

        <button
          type="button"
          className={tab==="titles"?"active":""}
          onClick={()=>setTab("titles")}
        >
          🏷️ 칭호
        </button>
      </div>

      {loading&&(
        <section className="storeStateFinalV5">
          상점 정보를 불러오는 중입니다.
        </section>
      )}

      {!loading&&error&&(
        <section className="storeStateFinalV5 error">
          <strong>상점 정보를 불러오지 못했습니다.</strong>
          <p>{error}</p>
          <button
            type="button"
            onClick={()=>void loadStore()}
          >
            다시 불러오기
          </button>
        </section>
      )}

      {!loading&&!error&&tab==="charge"&&(
        <section className="storeSectionFinalV5">
          <div className="storeSectionHeadFinalV5">
            <div>
              <small>BASEBALL CHARGE</small>
              <h2>야구공 충전</h2>
              <p>
                경기 분석 해금, 야구공 참여 및 상점 아이템에
                사용할 수 있습니다.
              </p>
            </div>

            <div className="storeCurrentBallFinalV5">
              <span>현재 보유</span>
              <strong>⚾ {balance.toLocaleString()}</strong>
            </div>
          </div>

          <div className="chargeGridFinalV5">
            {CHARGE_PRODUCTS.map(item=>(
              <article
                className={
                  "chargeCardFinalV5"+
                  (item.tag?" featured":"")
                }
                key={item.price}
              >
                {item.tag&&(
                  <span className="chargeTagFinalV5">
                    {item.tag}
                  </span>
                )}

                <div className="chargeBallFinalV5">⚾</div>

                <strong>
                  {item.balls}
                </strong>

                <span className="chargeUnitFinalV5">
                  야구공
                </span>

                <p>{item.detail}</p>

                <button
                  type="button"
                  disabled
                  title="결제 시스템 연결 후 이용 가능합니다."
                >
                  {item.price}
                </button>
              </article>
            ))}
          </div>

          <div className="storeGuideFinalV5">
            실제 결제 기능은 결제 서버 검증 연결 후 활성화됩니다.
            결제 완료가 확인된 경우에만 야구공이 지급됩니다.
          </div>
        </section>
      )}

      {!loading&&!error&&tab==="titles"&&(
        <section className="storeSectionFinalV5">
          <div className="storeSectionHeadFinalV5">
            <div>
              <small>TITLE COLLECTION</small>
              <h2>칭호</h2>
              <p>
                야구공으로 칭호를 획득하고 대표 칭호로
                설정할 수 있습니다.
              </p>
            </div>

            <div className="storeCurrentBallFinalV5">
              <span>보유 칭호</span>
              <strong>{ownedCount} / {titles.length}</strong>
            </div>
          </div>

          {titles.length===0?(
            <div className="storeEmptyFinalV5">
              판매 중인 칭호가 없습니다.
            </div>
          ):(
            <div className="titleGridFinalV5">
              {titles.map(title=>(
                <article
                  className={
                    "titleCardFinalV5"+
                    (title.equipped?" equipped":"")
                  }
                  key={title.id}
                >
                  <div className="titleCardTopFinalV5">
                    <span className="titleBadgeFinalV5">
                      {title.badge||"⚾"}
                    </span>

                    <span className="titleTierFinalV5">
                      {tierName(title.tier)}
                    </span>
                  </div>

                  <h3>{title.name}</h3>

                  <p>
                    {title.description||
                      "KBO PICKS에서 사용할 수 있는 칭호입니다."}
                  </p>

                  <div className="titlePriceFinalV5">
                    ⚾ {Number(title.price||0).toLocaleString()}
                  </div>

                  {title.equipped?(
                    <button
                      type="button"
                      className="owned"
                      disabled
                    >
                      대표 칭호 사용 중
                    </button>
                  ):title.owned?(
                    <button
                      type="button"
                      className="owned"
                      disabled
                    >
                      보유 중 · 장착 준비
                    </button>
                  ):(
                    <button
                      type="button"
                      disabled
                    >
                      구매 준비 중
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

    </main>
  );
}

"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import type {User} from "@supabase/supabase-js";
import type {KboGame} from "@/types/kbo";
import {supabase} from "@/lib/supabase/client";
import s from "./CommunityPage.module.css";

type Img={path:string;url:string;name?:string};
type Post={id:string;user_id:string;author_name:string;category:string;game_id:string|null;title:string;content:string;images?:Img[];is_notice?:boolean;like_count:number;comment_count:number;created_at:string;updated_at:string;likedByMe?:boolean;mine?:boolean};
type Comment={id:string;post_id:string;user_id:string;author_name:string;content:string;created_at:string;parent_id?:string|null;reply_to_name?:string|null;like_count?:number;is_deleted?:boolean;likedByMe?:boolean;mine?:boolean};
type Props={
 user:User|null;
 games:KboGame[];
 openPostId?:string|null;
 onPostOpened?:()=>void;
};
const labels:Record<string,string>={talk:"자유게시판",game:"경기토론",analysis:"AI 분석",combo:"내 조합"};
async function token(){return (await supabase.auth.getSession()).data.session?.access_token||""}
function dt(v:string){try{return new Intl.DateTimeFormat("ko-KR",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Seoul"}).format(new Date(v))}catch{return""}}

export default function CommunityPage({user,games,openPostId,onPostOpened}:Props){
 const [posts,setPosts]=useState<Post[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [category,setCategory]=useState("all"),[sort,setSort]=useState<"latest"|"popular">("latest"),[gameFilter,setGameFilter]=useState("");
 const [selected,setSelected]=useState<Post|null>(null),[comments,setComments]=useState<Comment[]>([]),[commentsLoading,setCommentsLoading]=useState(false),[commentText,setCommentText]=useState(""),[reply,setReply]=useState<Comment|null>(null);
 const [editingCommentId,setEditingCommentId]=useState<string|null>(null);
 const [editingCommentText,setEditingCommentText]=useState("");
 const [editor,setEditor]=useState(false),[editing,setEditing]=useState<Post|null>(null),[writeCategory,setWriteCategory]=useState("talk"),[writeGameId,setWriteGameId]=useState(""),[title,setTitle]=useState(""),[body,setBody]=useState(""),[images,setImages]=useState<Img[]>([]),[files,setFiles]=useState<File[]>([]),[previews,setPreviews]=useState<string[]>([]),[isNotice,setIsNotice]=useState(false),[isAdmin,setIsAdmin]=useState(false);
 const area=useRef<HTMLTextAreaElement>(null);
 const headers=useCallback(async():Promise<Record<string,string>>=>{const t=await token();return t?{Authorization:`Bearer ${t}`}:{}},[]);
 const gameName=(id:string|null)=>{const g=games.find(x=>x.gameId===id);return g?`${g.awayTeamName} vs ${g.homeTeamName}`:"경기토론"};
 const loadPosts=useCallback(async()=>{setLoading(true);try{const p=new URLSearchParams({sort});if(category!=="all")p.set("category",category);if(gameFilter)p.set("gameId",gameFilter);const r=await fetch("/api/community/posts?"+p,{headers:await headers(),cache:"no-store"}),j=await r.json();if(!r.ok||!j.ok)throw Error(j.error);setPosts(j.posts||[]);setIsAdmin(!!j.isAdmin)}catch(e){setMessage(e instanceof Error?e.message:"게시글을 불러오지 못했습니다.")}finally{setLoading(false)}},[category,sort,gameFilter,headers]);
 useEffect(()=>{void loadPosts()},[loadPosts,user?.id]);
 useEffect(()=>()=>previews.forEach(URL.revokeObjectURL),[previews]);

 /* COMMUNITY_DIRECT_OPEN_V1 */
 useEffect(()=>{
  if(!openPostId||loading)return;

  const post=posts.find(x=>x.id===openPostId);

  if(!post)return;

  void loadComments(post);
  onPostOpened?.();
 },[openPostId,loading,posts]);

 async function loadComments(post:Post){setSelected(post);setReply(null);setCommentText("");setCommentsLoading(true);try{const r=await fetch("/api/community/comments?postId="+encodeURIComponent(post.id),{headers:await headers(),cache:"no-store"}),j=await r.json();if(!r.ok||!j.ok)throw Error(j.error);setComments(j.comments||[])}catch(e){setMessage(e instanceof Error?e.message:"댓글을 불러오지 못했습니다.")}finally{setCommentsLoading(false)}}
 function resetEditor(){previews.forEach(URL.revokeObjectURL);setEditing(null);setWriteCategory("talk");setWriteGameId("");setTitle("");setBody("");setImages([]);setFiles([]);setPreviews([]);setIsNotice(false)}
 function openWrite(post?:Post){
  if(!user){
   setMessage("로그인 후 글을 작성할 수 있습니다.");
   return;
  }

  previews.forEach(URL.revokeObjectURL);
  setFiles([]);
  setPreviews([]);
  setMessage("");

  if(post){
   setEditing(post);
   setWriteCategory(post.category || "talk");
   setWriteGameId(post.game_id || "");
   setTitle(post.title || "");
   setBody(post.content || "");
   setImages(Array.isArray(post.images) ? post.images : []);
   setIsNotice(!!post.is_notice);
  }else{
   setEditing(null);
   setWriteCategory("talk");
   setWriteGameId("");
   setTitle("");
   setBody("");
   setImages([]);
   setIsNotice(false);
  }

  setEditor(true);
 }
 function format(prefix:string,suffix=prefix){const el=area.current;if(!el)return;const a=el.selectionStart,b=el.selectionEnd,next=body.slice(0,a)+prefix+body.slice(a,b)+suffix+body.slice(b);setBody(next);requestAnimationFrame(()=>{el.focus();el.setSelectionRange(a+prefix.length,b+prefix.length)})}
 function line(prefix:string){const el=area.current;if(!el)return;const a=el.selectionStart;const start=body.lastIndexOf("\n",a-1)+1;setBody(body.slice(0,start)+prefix+body.slice(start));requestAnimationFrame(()=>el.focus())}
 function choose(fs:FileList|null){if(!fs)return;const next=Array.from(fs).slice(0,Math.max(0,5-images.length));previews.forEach(URL.revokeObjectURL);setFiles(next);setPreviews(next.map(URL.createObjectURL))}
 async function upload(){if(!files.length)return[];const fd=new FormData();files.forEach(f=>fd.append("images",f));const r=await fetch("/api/community/upload",{method:"POST",headers:await headers(),body:fd}),j=await r.json();if(!r.ok||!j.ok)throw Error(j.error);return j.images||[]}
 async function savePost(){
  if(!title.trim()||!body.trim()){
   setMessage("제목과 내용을 입력해주세요.");
   return;
  }

  setBusy(true);

  const editTarget = editing;

  try{
   const added = await upload();

   const payload = {
    id: editTarget?.id,
    category: writeCategory,
    gameId: writeCategory==="game" ? writeGameId : null,
    title: title.trim(),
    content: body.trim(),
    images: [...images,...added].slice(0,5),
    isNotice
   };

   const r = await fetch("/api/community/posts",{
    method: editTarget ? "PATCH" : "POST",
    headers:{
     ...(await headers()),
     "Content-Type":"application/json"
    },
    body:JSON.stringify(payload)
   });

   const j = await r.json();

   if(!r.ok||!j.ok){
    throw Error(j.error || "게시글 저장에 실패했습니다.");
   }

   if(editTarget && j.post){
    const updated = {
     ...(selected || editTarget),
     ...j.post,
     mine:true,
     likedByMe:
      selected?.likedByMe ??
      editTarget.likedByMe
    };

    setSelected(current=>
     current?.id===editTarget.id
      ? {
         ...current,
         ...updated
        }
      : current
    );

    setPosts(current=>
     current.map(post=>
      post.id===editTarget.id
       ? {
          ...post,
          ...updated
         }
       : post
     )
    );

   }else if(j.post){
    setPosts(current=>[
     {
      ...j.post,
      mine:true,
      likedByMe:false
     },
     ...current
    ]);
   }

   setEditor(false);
   resetEditor();

  }catch(e){
   setMessage(
    e instanceof Error
     ? e.message
     : "게시글 저장에 실패했습니다."
   );
  }finally{
   setBusy(false);
  }
 }
 async function deletePost(p:Post){
  if(!confirm("게시글을 삭제할까요?"))return;

  try{
   const r=await fetch(
    "/api/community/posts?id="+
    encodeURIComponent(p.id),
    {
     method:"DELETE",
     headers:await headers()
    }
   );

   const j=await r.json();

   if(!r.ok||!j.ok){
    throw Error(
     j.error || "게시글 삭제에 실패했습니다."
    );
   }

   setPosts(current=>
    current.filter(
     post=>post.id!==p.id
    )
   );

   setSelected(null);
   setComments([]);
   setCommentText("");
   setReply(null);
   setMessage("");

  }catch(e){
   setMessage(
    e instanceof Error
     ? e.message
     : "게시글 삭제에 실패했습니다."
   );
  }
 }
 async function likePost(p:Post){if(!user){setMessage("로그인 후 좋아요를 누를 수 있습니다.");return}const r=await fetch("/api/community/likes",{method:"POST",headers:{...(await headers()),"Content-Type":"application/json"},body:JSON.stringify({postId:p.id})}),j=await r.json();if(!r.ok||!j.ok){setMessage(j.error);return}const patch=(x:Post)=>x.id===p.id?{...x,likedByMe:j.liked,like_count:Number(j.likeCount||0)}:x;setPosts(x=>x.map(patch));setSelected(x=>x?patch(x):x)}
 async function addComment(){
  if(!selected||!commentText.trim())return;

  setBusy(true);

  try{
   const r=await fetch(
    "/api/community/comments",
    {
     method:"POST",
     headers:{
      ...(await headers()),
      "Content-Type":"application/json"
     },
     body:JSON.stringify({
      postId:selected.id,
      content:commentText.trim(),
      parentId:reply?.id||null
     })
    }
   );

   const j=await r.json();

   if(!r.ok||!j.ok){
    throw Error(
     j.error || "댓글 작성에 실패했습니다."
    );
   }

   if(j.comment){
    setComments(current=>[
     ...current,
     j.comment
    ]);
   }

   const nextCount=Number(
    j.commentCount ??
    (selected.comment_count+1)
   );

   setSelected(current=>
    current
     ? {
        ...current,
        comment_count:nextCount
       }
     : current
   );

   setPosts(current=>
    current.map(post=>
     post.id===selected.id
      ? {
         ...post,
         comment_count:nextCount
        }
      : post
    )
   );

   setCommentText("");
   setReply(null);

  }catch(e){
   setMessage(
    e instanceof Error
     ? e.message
     : "댓글 작성에 실패했습니다."
   );
  }finally{
   setBusy(false);
  }
 }
 async function likeComment(c:Comment){if(c.mine){setMessage("자기 댓글에는 좋아요를 누를 수 없습니다.");return}const r=await fetch("/api/community/comment-likes",{method:"POST",headers:{...(await headers()),"Content-Type":"application/json"},body:JSON.stringify({commentId:c.id})}),j=await r.json();if(!r.ok||!j.ok){setMessage(j.error);return}setComments(x=>x.map(v=>v.id===c.id?{...v,likedByMe:j.liked,like_count:Number(j.likeCount||0)}:v))}
 function startEditComment(c:Comment){
  setReply(null);
  setEditingCommentId(c.id);
  setEditingCommentText(c.content);
 }

 function cancelEditComment(){
  setEditingCommentId(null);
  setEditingCommentText("");
 }

 async function saveEditedComment(c:Comment){
  const value = editingCommentText.trim();

  if(!value){
   setMessage("댓글 내용을 입력해주세요.");
   return;
  }

  if(value === c.content){
   cancelEditComment();
   return;
  }

  setBusy(true);

  try{
   const r = await fetch("/api/community/comments",{
    method:"PATCH",
    headers:{
     ...(await headers()),
     "Content-Type":"application/json"
    },
    body:JSON.stringify({
     id:c.id,
     content:value
    })
   });

   const j = await r.json();

   if(!r.ok||!j.ok){
    throw Error(j.error || "댓글 수정에 실패했습니다.");
   }

   setComments(current =>
    current.map(item =>
     item.id===c.id
      ? {...item,...j.comment}
      : item
    )
   );

   cancelEditComment();

  }catch(e){
   setMessage(
    e instanceof Error
     ? e.message
     : "댓글 수정에 실패했습니다."
   );
  }finally{
   setBusy(false);
  }
 }
 async function deleteComment(c:Comment){
  if(!confirm("댓글을 삭제할까요?"))return;

  try{
   const r=await fetch(
    "/api/community/comments?id="+encodeURIComponent(c.id),
    {
     method:"DELETE",
     headers:await headers()
    }
   );

   const j=await r.json();

   if(!r.ok||!j.ok){
    throw Error(j.error || "댓글 삭제에 실패했습니다.");
   }

   const hasReplies=comments.some(
    item=>item.parent_id===c.id
   );

   setComments(current=>{
    if(hasReplies){
     return current.map(item=>
      item.id===c.id
       ? {
          ...item,
          content:"삭제된 댓글입니다.",
          is_deleted:true,
          mine:false
         }
       : item
     );
    }

    return current.filter(
     item=>item.id!==c.id
    );
   });

   const nextCount=Number(
    j.commentCount ??
    Math.max(
     0,
     (selected?.comment_count||0)-1
    )
   );

   setSelected(current=>
    current
     ? {
        ...current,
        comment_count:nextCount
       }
     : current
   );

   setPosts(current=>
    current.map(post=>
     post.id===c.post_id
      ? {
         ...post,
         comment_count:nextCount
        }
      : post
    )
   );

   if(reply?.id===c.id){
    setReply(null);
   }

   if(editingCommentId===c.id){
    cancelEditComment();
   }

  }catch(e){
   setMessage(
    e instanceof Error
     ? e.message
     : "댓글 삭제에 실패했습니다."
   );
  }
 }
 const roots=useMemo(()=>comments.filter(x=>!x.parent_id),[comments]);
 const best=useMemo(()=>roots.filter(x=>!x.is_deleted&&Number(x.like_count||0)>=3).sort((a,b)=>Number(b.like_count||0)-Number(a.like_count||0)).slice(0,3),[roots]);
 const actions=(c:Comment)=><div className={s.commentActions}>{!c.is_deleted&&<><button onClick={()=>void likeComment(c)} disabled={c.mine}>{c.likedByMe?"♥":"♡"} 좋아요 {c.like_count||0}</button><button onClick={()=>setReply(c)}>답글</button>{c.mine&&<><button onClick={()=>startEditComment(c)}>수정</button><button onClick={()=>void deleteComment(c)}>삭제</button></>}</>}</div>;
 const commentCard=(c:Comment,replyMode=false)=><article key={c.id} className={replyMode?s.reply:s.comment}>
  <header>
   <div className={s.commentAuthor}>
    {replyMode && (
     <span
      className={s.replyArrow}
      aria-hidden="true"
     >
      ↳
     </span>
    )}
    <strong>{c.author_name}</strong>
   </div>
   <time>{dt(c.created_at)}</time>
  </header>

  {editingCommentId===c.id ? (
   <div className={s.inlineEdit}>
    <textarea
     value={editingCommentText}
     maxLength={1000}
     autoFocus
     onChange={e=>setEditingCommentText(e.target.value)}
    />
    <div>
     <button
      type="button"
      className={s.inlineSave}
      disabled={busy || !editingCommentText.trim()}
      onClick={()=>void saveEditedComment(c)}
     >
      {busy ? "수정 중..." : "수정 완료"}
     </button>

     <button
      type="button"
      className={s.inlineCancel}
      onClick={cancelEditComment}
     >
      취소
     </button>
    </div>
   </div>
  ) : (
   <>
    <p>
     {!c.is_deleted&&replyMode&&c.reply_to_name
      ? <b>@{c.reply_to_name} </b>
      : null}
     {c.content}
    </p>
    {actions(c)}
   </>
  )}
 </article>;

 if(selected)return <main className={s.detail}><div className={s.detailTop}><button className={s.back} onClick={()=>setSelected(null)}>← 목록으로</button></div>{message&&<div className={s.message}>{message}</div>}<article className={`${s.article} ${selected.is_notice ? s.noticeArticle : ""}`}><header className={s.articleHead}>
 <div className={s.articleMetaRow}>
  <div className={s.category}>
   {selected.is_notice
    ? <span className={s.notice}>📢 공지</span>
    : labels[selected.category]}
  </div>

  <div className={s.author}>
   <strong>
    {selected.author_name}
    {selected.mine?" · 내 글":""}
   </strong>
   <time>{dt(selected.created_at)}</time>
  </div>
 </div>

 <h1>{selected.title}</h1>
</header>{(selected.mine||isAdmin)&&<div className={s.ownerActions}><button onClick={()=>openWrite(selected)}>수정</button><button className={s.danger} onClick={()=>void deletePost(selected)}>삭제</button></div>}<div className={s.content}>{selected.content}{!!selected.images?.length&&<div className={s.images}>{selected.images.map((x,i)=><a key={x.path||i} href={x.url} target="_blank" rel="noreferrer"><img src={x.url} alt={x.name||"첨부 이미지"}/></a>)}</div>}</div><footer className={s.articleFoot}><button onClick={()=>void likePost(selected)}>{selected.likedByMe?"♥":"♡"} 좋아요 {selected.like_count}</button></footer></article><section className={s.comments}><h2>댓글 <b>{selected.comment_count}</b></h2>{best.map(c=><div className={s.best} key={"best"+c.id}><div className={s.bestLabel}>🏆 BEST</div>{commentCard(c)}</div>)}{reply&&<div className={s.replyTarget}><span><b>@{reply.author_name}</b>님에게 답글</span><button onClick={()=>setReply(null)}>취소</button></div>}<div className={s.commentWrite}><textarea value={commentText} disabled={!user} placeholder={user?(reply?`@${reply.author_name}님에게 답글을 입력하세요.`:"댓글을 입력하세요."):"로그인 후 댓글을 작성할 수 있습니다."} onChange={e=>setCommentText(e.target.value)}/><button disabled={!user||!commentText.trim()} onClick={()=>void addComment()}>댓글 등록</button></div>{commentsLoading?<div className={s.empty}>댓글을 불러오는 중입니다.</div>:roots.map(c=><div key={c.id}>{commentCard(c)}{comments.filter(x=>x.parent_id===c.id).map(x=>commentCard(x,true))}</div>)}</section>

 {editor&&<div className={s.modal}>
  <section className={s.editor}>
   <header className={s.editorHead}>
    <div>
     <small>
      {editing?"EDIT POST":"NEW POST"}
     </small>
     <h2>
      {editing
       ?"게시글 수정"
       :"새 글 작성"}
     </h2>
    </div>

    <button
     type="button"
     onClick={()=>setEditor(false)}
    >
     ×
    </button>
   </header>

   <div className={s.editorGrid}>
    <select
     value={writeCategory}
     onChange={e=>
      setWriteCategory(e.target.value)
     }
    >
     <option value="talk">
      자유게시판
     </option>
     <option value="game">
      경기토론
     </option>
     <option value="analysis">
      AI 분석
     </option>
     <option value="combo">
      내 조합
     </option>
    </select>

    {writeCategory==="game"
     ?(
      <select
       value={writeGameId}
       onChange={e=>
        setWriteGameId(e.target.value)
       }
      >
       <option value="">
        경기 선택
       </option>

       {games.map(g=>(
        <option
         key={g.gameId}
         value={g.gameId}
        >
         {g.awayTeamName}
         {" vs "}
         {g.homeTeamName}
        </option>
       ))}
      </select>
     )
     :<div/>
    }
   </div>

   {isAdmin&&(
    <label>
     <input
      type="checkbox"
      checked={isNotice}
      onChange={e=>
       setIsNotice(e.target.checked)
      }
     />
     {" "}📢 공지로 등록
    </label>
   )}

   <input
    className={s.titleInput}
    value={title}
    maxLength={100}
    placeholder="제목을 입력하세요"
    onChange={e=>setTitle(e.target.value)}
   />

   <div className={s.formatBar}>
    <button
     type="button"
     onClick={()=>format("**")}
    >
     B
    </button>

    <button
     type="button"
     onClick={()=>format("*")}
    >
     I
    </button>

    <button
     type="button"
     onClick={()=>format("__")}
    >
     U
    </button>

    <button
     type="button"
     onClick={()=>line("## ")}
    >
     H
    </button>

    <button
     type="button"
     onClick={()=>line("> ")}
    >
     ❝
    </button>

    <button
     type="button"
     onClick={()=>line("• ")}
    >
     • 목록
    </button>

    <button
     type="button"
     onClick={()=>line("1. ")}
    >
     1. 목록
    </button>

    <button
     type="button"
     onClick={()=>line("---\n")}
    >
     ─
    </button>

    <button
     type="button"
     onClick={()=>format("[","](링크)")}
    >
     🔗
    </button>

    <label className={s.photoButton}>
     🖼 사진
     <input
      hidden
      type="file"
      multiple
      accept="image/jpeg,image/png,image/webp,image/gif"
      onChange={e=>
       choose(e.target.files)
      }
     />
    </label>
   </div>

   <textarea
    ref={area}
    className={s.editorArea}
    value={body}
    maxLength={10000}
    placeholder="내용을 자유롭게 작성하세요."
    onChange={e=>setBody(e.target.value)}
   />

   {(images.length>0||
     previews.length>0)&&(
    <div className={s.previews}>
     {images.map((x,i)=>(
      <div
       className={s.preview}
       key={x.path||i}
      >
       <img
        src={x.url}
        alt=""
       />
       <button
        type="button"
        onClick={()=>
         setImages(v=>
          v.filter((_,n)=>n!==i)
         )
        }
       >
        ×
       </button>
      </div>
     ))}

     {previews.map((x,i)=>(
      <div
       className={s.preview}
       key={x}
      >
       <img src={x} alt=""/>
       <button
        type="button"
        onClick={()=>{
         setFiles(v=>
          v.filter((_,n)=>n!==i)
         );
         setPreviews(v=>
          v.filter((_,n)=>n!==i)
         );
        }}
       >
        ×
       </button>
      </div>
     ))}
    </div>
   )}

   <footer className={s.editorFoot}>
    <span>
     {body.length.toLocaleString()}
     {" / 10,000자 · 사진 "}
     {images.length+files.length}/5
    </span>

    <div>
     <button
      type="button"
      className={s.ghost}
      onClick={()=>setEditor(false)}
     >
      취소
     </button>

     <button
      type="button"
      className={s.primary}
      disabled={busy}
      onClick={()=>void savePost()}
     >
      {busy
       ?"저장 중..."
       :editing
        ?"수정 완료"
        :"등록하기"}
     </button>
    </div>
   </footer>
  </section>
 </div>}

 </main>;

 return <main className={s.page}><header className={s.hero}><div><small>KBO COMMUNITY</small><h1>커뮤니티</h1><p>경기 의견과 AI 분석, 나만의 조합을 자유롭게 공유하세요.</p></div><button onClick={()=>openWrite()}>+ 글쓰기</button></header>{message&&<div className={s.message}>{message}</div>}<section className={s.toolbar}><div className={s.tabs}>{[["all","전체"],["talk","자유게시판"],["game","경기토론"],["analysis","AI 분석"],["combo","내 조합"]].map(([k,v])=><button key={k} className={category===k?s.active:""} onClick={()=>setCategory(k)}>{v}</button>)}</div><div className={s.sort}><button className={sort==="latest"?s.active:""} onClick={()=>setSort("latest")}>최신글</button><button className={sort==="popular"?s.active:""} onClick={()=>setSort("popular")}>인기글</button></div></section>{category==="game"&&<div className={s.gameFilter}><button className={!gameFilter?s.active:""} onClick={()=>setGameFilter("")}>전체 경기</button>{games.map(g=><button key={g.gameId} className={gameFilter===g.gameId?s.active:""} onClick={()=>setGameFilter(g.gameId)}>{g.awayTeamName} vs {g.homeTeamName}</button>)}</div>}<div className={s.layout}><section className={s.feed}>{loading?<div className={s.empty}>게시글을 불러오는 중입니다.</div>:posts.length===0?<div className={s.empty}>첫 글을 작성해보세요.</div>:posts.map(p=><article
 className={`${s.post} ${p.is_notice ? s.noticePost : ""}`}
 key={p.id}
><button className={s.postBody} onClick={()=>void loadComments(p)}><div className={s.meta}><span>{p.is_notice?"📢 공지":labels[p.category]}</span>{p.game_id&&<b>{gameName(p.game_id)}</b>}<i>{dt(p.created_at)}</i></div><h3>{p.title}</h3><p>{p.content}</p><footer className={s.postFoot}><strong>{p.author_name}{p.mine?" · 내 글":""}</strong><span>댓글 {p.comment_count}</span></footer></button><button className={s.like} onClick={()=>void likePost(p)}>{p.likedByMe?"♥":"♡"} {p.like_count}</button></article>)}</section><aside className={s.side}><section><small>COMMUNITY</small><h3>지금 이야기해보세요</h3><p>경기 전 예상부터 경기 후 의견까지 자유롭게 남길 수 있습니다.</p></section><section><small>TODAY GAMES</small><h3>오늘 경기</h3>{games.slice(0,5).map(g=><p key={g.gameId}>{g.time||"-"} · {g.awayTeamName} vs {g.homeTeamName}</p>)}</section></aside></div>
 {editor&&<div className={s.modal}><section className={s.editor}><header className={s.editorHead}><div><small>{editing?"EDIT POST":"NEW POST"}</small><h2>{editing?"게시글 수정":"새 글 작성"}</h2></div><button onClick={()=>setEditor(false)}>×</button></header><div className={s.editorGrid}><select value={writeCategory} onChange={e=>setWriteCategory(e.target.value)}><option value="talk">자유게시판</option><option value="game">경기토론</option><option value="analysis">AI 분석</option><option value="combo">내 조합</option></select>{writeCategory==="game"?<select value={writeGameId} onChange={e=>setWriteGameId(e.target.value)}><option value="">경기 선택</option>{games.map(g=><option key={g.gameId} value={g.gameId}>{g.awayTeamName} vs {g.homeTeamName}</option>)}</select>:<div/>}</div>{isAdmin&&<label><input type="checkbox" checked={isNotice} onChange={e=>setIsNotice(e.target.checked)}/> 📢 공지로 등록</label>}<input className={s.titleInput} value={title} maxLength={100} placeholder="제목을 입력하세요" onChange={e=>setTitle(e.target.value)}/><div className={s.formatBar}><button onClick={()=>format("**")}>B</button><button onClick={()=>format("*")}>I</button><button onClick={()=>format("__")}>U</button><button onClick={()=>line("## ")}>H</button><button onClick={()=>line("> ")}>❝</button><button onClick={()=>line("• ")}>• 목록</button><button onClick={()=>line("1. ")}>1. 목록</button><button onClick={()=>line("---\n")}>─</button><button onClick={()=>format("[","](링크)")}>🔗</button><label className={s.photoButton}>🖼 사진<input hidden type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" onChange={e=>choose(e.target.files)}/></label></div><textarea ref={area} className={s.editorArea} value={body} maxLength={10000} placeholder="내용을 자유롭게 작성하세요." onChange={e=>setBody(e.target.value)}/>{(images.length>0||previews.length>0)&&<div className={s.previews}>{images.map((x,i)=><div className={s.preview} key={x.path||i}><img src={x.url}/><button onClick={()=>setImages(v=>v.filter((_,n)=>n!==i))}>×</button></div>)}{previews.map((x,i)=><div className={s.preview} key={x}><img src={x}/><button onClick={()=>{setFiles(v=>v.filter((_,n)=>n!==i));setPreviews(v=>v.filter((_,n)=>n!==i))}}>×</button></div>)}</div>}<footer className={s.editorFoot}><span>{body.length.toLocaleString()} / 10,000자 · 사진 {images.length+files.length}/5</span><div><button className={s.ghost} onClick={()=>setEditor(false)}>취소</button><button className={s.primary} disabled={busy} onClick={()=>void savePost()}>{busy?"저장 중...":editing?"수정 완료":"등록하기"}</button></div></footer></section></div>}
 </main>
}
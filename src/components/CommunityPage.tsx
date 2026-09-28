"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { KboGame } from "@/types/kbo";
import { supabase } from "@/lib/supabase/client";

type CommunityPost = {
  id: string;
  user_id: string;
  author_name: string;
  category: string;
  game_id: string | null;
  title: string;
  content: string;
  like_count: number;
  comment_count: number;
  created_at: string;
  updated_at: string;
  likedByMe?: boolean;
  mine?: boolean;
};

type CommunityComment = {
  id: string;
  post_id: string;
  user_id: string;
  author_name: string;
  content: string;
  created_at: string;
};

type Props = {
  user: User | null;
  games: KboGame[];
};

const categoryLabels: Record<string, string> = {
  talk: "자유게시판",
  game: "경기토론",
  analysis: "AI 분석",
  combo: "내 조합",
};

async function accessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || "";
}

function dateText(value: string) {
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Seoul",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

export default function CommunityPage({
  user,
  games,
}: Props) {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<"latest" | "popular">("latest");
  const [gameFilter, setGameFilter] = useState("");

  const [writeOpen, setWriteOpen] = useState(false);
  const [writeCategory, setWriteCategory] = useState("talk");
  const [writeGameId, setWriteGameId] = useState("");
  const [writeTitle, setWriteTitle] = useState("");
  const [writeContent, setWriteContent] = useState("");

  const [selectedPost, setSelectedPost] =
    useState<CommunityPost | null>(null);

  const [comments, setComments] =
    useState<CommunityComment[]>([]);

  const [commentsLoading, setCommentsLoading] =
    useState(false);

  const [commentText, setCommentText] = useState("");

  const requestHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await accessToken();
    const headers: Record<string, string> = {};

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }, []);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const params = new URLSearchParams();

      params.set("sort", sort);

      if (category !== "all") {
        params.set("category", category);
      }

      if (gameFilter) {
        params.set("gameId", gameFilter);
      }

      const headers = await requestHeaders();

      const response = await fetch(
        `/api/community/posts?${params.toString()}`,
        {
          headers,
          cache: "no-store",
        }
      );

      const body = await response.json();

      if (!response.ok || !body?.ok) {
        throw new Error(
          body?.error || "게시글을 불러오지 못했습니다."
        );
      }

      setPosts(
        Array.isArray(body.posts) ? body.posts : []
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "게시글을 불러오지 못했습니다."
      );
    } finally {
      setLoading(false);
    }
  }, [
    category,
    gameFilter,
    requestHeaders,
    sort,
  ]);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts, user?.id]);

  const createPost = async () => {
    if (!user) {
      setMessage("로그인 후 글을 작성할 수 있습니다.");
      return;
    }

    if (!writeTitle.trim() || !writeContent.trim()) {
      setMessage("제목과 내용을 입력해주세요.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const headers = await requestHeaders();

      const response = await fetch(
        "/api/community/posts",
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            category: writeCategory,
            gameId:
              writeCategory === "game"
                ? writeGameId || null
                : null,
            title: writeTitle,
            content: writeContent,
          }),
        }
      );

      const body = await response.json();

      if (!response.ok || !body?.ok) {
        throw new Error(
          body?.error || "게시글 작성에 실패했습니다."
        );
      }

      setWriteTitle("");
      setWriteContent("");
      setWriteGameId("");
      setWriteCategory("talk");
      setWriteOpen(false);

      await loadPosts();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "게시글 작성에 실패했습니다."
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleLike = async (
    post: CommunityPost
  ) => {
    if (!user) {
      setMessage("로그인 후 좋아요를 누를 수 있습니다.");
      return;
    }

    try {
      const headers = await requestHeaders();

      const response = await fetch(
        "/api/community/likes",
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            postId: post.id,
          }),
        }
      );

      const body = await response.json();

      if (!response.ok || !body?.ok) {
        throw new Error(
          body?.error || "좋아요 처리에 실패했습니다."
        );
      }

      const patch = (item: CommunityPost) =>
        item.id === post.id
          ? {
              ...item,
              likedByMe: body.liked === true,
              like_count: Number(body.likeCount || 0),
            }
          : item;

      setPosts((current) =>
        current.map(patch)
      );

      setSelectedPost((current) =>
        current ? patch(current) : current
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "좋아요 처리에 실패했습니다."
      );
    }
  };

  const openPost = async (
    post: CommunityPost
  ) => {
    setSelectedPost(post);
    setComments([]);
    setCommentText("");
    setCommentsLoading(true);

    try {
      const response = await fetch(
        `/api/community/comments?postId=${encodeURIComponent(
          post.id
        )}`,
        {
          cache: "no-store",
        }
      );

      const body = await response.json();

      if (!response.ok || !body?.ok) {
        throw new Error(
          body?.error || "댓글을 불러오지 못했습니다."
        );
      }

      setComments(
        Array.isArray(body.comments)
          ? body.comments
          : []
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "댓글을 불러오지 못했습니다."
      );
    } finally {
      setCommentsLoading(false);
    }
  };

  const createComment = async () => {
    if (!selectedPost) return;

    if (!user) {
      setMessage("로그인 후 댓글을 작성할 수 있습니다.");
      return;
    }

    if (!commentText.trim()) {
      return;
    }

    setBusy(true);

    try {
      const headers = await requestHeaders();

      const response = await fetch(
        "/api/community/comments",
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            postId: selectedPost.id,
            content: commentText,
          }),
        }
      );

      const body = await response.json();

      if (!response.ok || !body?.ok) {
        throw new Error(
          body?.error || "댓글 작성에 실패했습니다."
        );
      }

      setComments((current) => [
        ...current,
        body.comment,
      ]);

      setCommentText("");

      const count = Number(
        body.commentCount || 0
      );

      setPosts((current) =>
        current.map((post) =>
          post.id === selectedPost.id
            ? {
                ...post,
                comment_count: count,
              }
            : post
        )
      );

      setSelectedPost((current) =>
        current
          ? {
              ...current,
              comment_count: count,
            }
          : current
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "댓글 작성에 실패했습니다."
      );
    } finally {
      setBusy(false);
    }
  };

  const gameName = (gameId: string | null) => {
    if (!gameId) return "";

    const game = games.find(
      (item) => item.gameId === gameId
    );

    return game
      ? `${game.awayTeamName} vs ${game.homeTeamName}`
      : "경기토론";
  };

  if (selectedPost) {
    return (
      <main className="communityPageV4 communityPostPageV5">
        <div className="communityPostPageTopV5">
          <button
            type="button"
            className="communityBackV5"
            onClick={() => {
              setSelectedPost(null);
              setComments([]);
              setCommentText("");
              setMessage("");
            }}
          >
            ← 목록으로
          </button>
        </div>

        {message && (
          <div className="communityMessageV4">
            {message}
          </div>
        )}

        <article className="communityFullPostV5">
          <header className="communityFullPostHeaderV5">
            <div className="communityFullPostCategoryV5">
              <span>
                {categoryLabels[selectedPost.category] || "커뮤니티"}
              </span>

              {selectedPost.game_id && (
                <b>
                  ⚾ {gameName(selectedPost.game_id)}
                </b>
              )}
            </div>

            <h1>{selectedPost.title}</h1>

            <div className="communityFullPostInfoV5">
              <strong>
                {selectedPost.author_name}
                {selectedPost.mine ? " · 내 글" : ""}
              </strong>

              <span>
                {dateText(selectedPost.created_at)}
              </span>
            </div>
          </header>

          <div className="communityFullPostContentV5">
            {selectedPost.content}
          </div>

          <footer className="communityFullPostActionsV5">
            <button
              type="button"
              className={`communityFullLikeV5 ${
                selectedPost.likedByMe ? "active" : ""
              }`}
              onClick={() => void toggleLike(selectedPost)}
            >
              <span>
                {selectedPost.likedByMe ? "♥" : "♡"}
              </span>
              좋아요 {selectedPost.like_count}
            </button>
          </footer>
        </article>

        <section className="communityFullCommentsV5">
          <header className="communityFullCommentsHeadV5">
            <div>
              <h2>
                댓글
                <b>{selectedPost.comment_count}</b>
              </h2>
              <p>경기에 대한 의견을 자유롭게 나눠보세요.</p>
            </div>
          </header>

          <div className="communityFullCommentWriteV5">
            <textarea
              value={commentText}
              maxLength={1000}
              placeholder={
                user
                  ? "댓글을 입력하세요."
                  : "로그인 후 댓글을 작성할 수 있습니다."
              }
              disabled={!user}
              onChange={(event) =>
                setCommentText(event.target.value)
              }
            />

            <button
              type="button"
              disabled={
                !user ||
                busy ||
                !commentText.trim()
              }
              onClick={() => void createComment()}
            >
              {busy ? "등록 중" : "댓글 등록"}
            </button>
          </div>

          <div className="communityFullCommentListV5">
            {commentsLoading ? (
              <div className="communityFullCommentEmptyV5">
                댓글을 불러오는 중입니다.
              </div>
            ) : comments.length === 0 ? (
              <div className="communityFullCommentEmptyV5">
                <strong>아직 댓글이 없습니다.</strong>
                <span>첫 댓글을 남겨보세요.</span>
              </div>
            ) : (
              comments.map((comment) => (
                <article
                  className="communityFullCommentV5"
                  key={comment.id}
                >
                  <header>
                    <strong>{comment.author_name}</strong>
                    <span>
                      {dateText(comment.created_at)}
                    </span>
                  </header>

                  <p>{comment.content}</p>
                </article>
              ))
            )}
          </div>
        </section>

        <div className="communityPostBottomV5">
          <button
            type="button"
            onClick={() => {
              setSelectedPost(null);
              setComments([]);
              setCommentText("");
              setMessage("");
            }}
          >
            ← 목록으로
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="communityPageV4">
      <header className="communityHeroV4">
        <div>
          <span>KBO COMMUNITY</span>
          <h1>커뮤니티</h1>
          <p>
            경기 의견과 AI 분석, 나만의 조합을
            자유롭게 공유하세요.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (!user) {
              setMessage(
                "로그인 후 글을 작성할 수 있습니다."
              );
              return;
            }

            setWriteOpen(true);
          }}
        >
          + 글쓰기
        </button>
      </header>

      {message && (
        <div className="communityMessageV4">
          {message}
        </div>
      )}

      <section className="communityToolbarV4">
        <div className="communityCategoryTabsV4">
          {[
            ["all", "전체"],
            ["talk", "자유게시판"],
            ["game", "경기토론"],
            ["analysis", "AI 분석"],
            ["combo", "내 조합"],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={
                category === key ? "active" : ""
              }
              onClick={() => setCategory(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="communitySortV4">
          <button
            type="button"
            className={
              sort === "latest" ? "active" : ""
            }
            onClick={() => setSort("latest")}
          >
            최신글
          </button>

          <button
            type="button"
            className={
              sort === "popular" ? "active" : ""
            }
            onClick={() => setSort("popular")}
          >
            인기글
          </button>
        </div>
      </section>

      {category === "game" && (
        <section className="communityGameFilterV4">
          <button
            type="button"
            className={!gameFilter ? "active" : ""}
            onClick={() => setGameFilter("")}
          >
            전체 경기
          </button>

          {games.map((game) => (
            <button
              type="button"
              key={game.gameId}
              className={
                gameFilter === game.gameId
                  ? "active"
                  : ""
              }
              onClick={() =>
                setGameFilter(game.gameId)
              }
            >
              {game.awayTeamName} vs{" "}
              {game.homeTeamName}
            </button>
          ))}
        </section>
      )}

      <div className="communityLayoutV4">
        <section className="communityFeedV4">
          {loading ? (
            <div className="communityEmptyV4">
              게시글을 불러오는 중입니다.
            </div>
          ) : posts.length === 0 ? (
            <div className="communityEmptyV4">
              <strong>첫 글을 작성해보세요.</strong>
              <span>
                아직 등록된 게시글이 없습니다.
              </span>
            </div>
          ) : (
            posts.map((post) => (
              <article
                className="communityPostV4"
                key={post.id}
              >
                <button
                  type="button"
                  className="communityPostBodyV4"
                  onClick={() => void openPost(post)}
                >
                  <div className="communityPostMetaV4">
                    <span>
                      {categoryLabels[
                        post.category
                      ] || "커뮤니티"}
                    </span>

                    {post.game_id && (
                      <b>
                        {gameName(post.game_id)}
                      </b>
                    )}

                    <i>
                      {dateText(post.created_at)}
                    </i>
                  </div>

                  <h3>{post.title}</h3>

                  <p>{post.content}</p>

                  <footer>
                    <strong>
                      {post.author_name}
                      {post.mine ? " · 내 글" : ""}
                    </strong>

                    <span>
                      ♥ {post.like_count} · 댓글{" "}
                      {post.comment_count}
                    </span>
                  </footer>
                </button>

                <button
                  type="button"
                  className={`communityLikeV4 ${
                    post.likedByMe ? "active" : ""
                  }`}
                  onClick={() =>
                    void toggleLike(post)
                  }
                >
                  {post.likedByMe ? "♥" : "♡"}{" "}
                  {post.like_count}
                </button>
              </article>
            ))
          )}
        </section>

        <aside className="communitySideV4">
          <section>
            <small>COMMUNITY</small>
            <h3>지금 이야기해보세요</h3>
            <p>
              경기 전 예상부터 경기 후 의견까지
              자유롭게 남길 수 있습니다.
            </p>
          </section>

          <section>
            <small>TODAY GAMES</small>
            <h3>오늘 경기</h3>

            {games.length === 0 ? (
              <p>오늘 예정된 경기가 없습니다.</p>
            ) : (
              <div className="communityTodayGamesV4">
                {games.slice(0, 5).map((game) => (
                  <button
                    type="button"
                    key={game.gameId}
                    onClick={() => {
                      setCategory("game");
                      setGameFilter(game.gameId);
                    }}
                  >
                    <span>{game.time || "-"}</span>
                    <b>
                      {game.awayTeamName} vs{" "}
                      {game.homeTeamName}
                    </b>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      {writeOpen && (
        <div
          className="communityModalBackdropV4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setWriteOpen(false);
            }
          }}
        >
          <section className="communityWriteModalV4">
            <header>
              <div>
                <small>NEW POST</small>
                <h2>새 글 작성</h2>
              </div>

              <button
                type="button"
                onClick={() => setWriteOpen(false)}
              >
                ×
              </button>
            </header>

            <label>
              게시판
              <select
                value={writeCategory}
                onChange={(event) =>
                  setWriteCategory(
                    event.target.value
                  )
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
            </label>

            {writeCategory === "game" && (
              <label>
                경기
                <select
                  value={writeGameId}
                  onChange={(event) =>
                    setWriteGameId(
                      event.target.value
                    )
                  }
                >
                  <option value="">
                    경기 선택
                  </option>

                  {games.map((game) => (
                    <option
                      key={game.gameId}
                      value={game.gameId}
                    >
                      {game.awayTeamName} vs{" "}
                      {game.homeTeamName}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label>
              제목
              <input
                value={writeTitle}
                maxLength={100}
                placeholder="제목을 입력하세요"
                onChange={(event) =>
                  setWriteTitle(event.target.value)
                }
              />
            </label>

            <label>
              내용
              <textarea
                value={writeContent}
                maxLength={5000}
                placeholder="내용을 입력하세요"
                onChange={(event) =>
                  setWriteContent(
                    event.target.value
                  )
                }
              />
            </label>

            <footer>
              <button
                type="button"
                className="secondary"
                onClick={() => setWriteOpen(false)}
              >
                취소
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => void createPost()}
              >
                {busy ? "등록 중..." : "등록하기"}
              </button>
            </footer>
          </section>
        </div>
      )}

    </main>
  );
}

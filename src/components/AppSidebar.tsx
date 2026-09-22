"use client";

export type MainSidebarTab =
  | "home"
  | "games"
  | "combos"
  | "history"
  | "community"
  | "my-combos"
  | "settings";

export type AppSidebarTab =
  | MainSidebarTab
  | "stats";

type AppSidebarProps = {
  active: AppSidebarTab;
  onMainTab?: (tab: MainSidebarTab) => void;
};

export default function AppSidebar({
  active,
  onMainTab,
}: AppSidebarProps) {
  function openMain(tab: MainSidebarTab) {
    if (onMainTab) {
      onMainTab(tab);
      return;
    }

    if (tab === "games") {
      window.location.href = "/";
      return;
    }

    window.location.href =
      `/?tab=${encodeURIComponent(tab)}`;
  }

  function openStats() {
    if (active === "stats") {
      return;
    }

    window.location.href = "/stats";
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        ⚾ <b>KBO PICKS</b>
        <small>v0.1</small>
      </div>

      <nav className="mainNav">
        {/* COMMUNITY_PLATFORM_SIDEBAR_V1 */}
        <button type="button" className={active === "home" ? "active" : ""} onClick={() => openMain("home")}>홈</button>

        <button
          type="button"
          className={
            active === "games"
              ? "active"
              : ""
          }
          onClick={() => openMain("games")}
        >
          경기분석
        </button>

        <button
          type="button"
          className={
            active === "combos"
              ? "active"
              : ""
          }
          onClick={() => openMain("combos")}
        >
          AI 추천픽
        </button>

        <button type="button" className={active === "community" ? "active" : ""} onClick={() => openMain("community")}>커뮤니티</button>

        <button
          type="button"
          className={
            active === "my-combos"
              ? "active"
              : ""
          }
          onClick={() =>
            openMain("my-combos")
          }
        >
          마이페이지
        </button>


        <button
          type="button"
          className={
            active === "stats"
              ? "active"
              : ""
          }
          onClick={openStats}
        >
          통계 리포트
        </button>

        <button
          type="button"
          className={
            active === "settings"
              ? "active"
              : ""
          }
          onClick={() =>
            openMain("settings")
          }
        >
          설정
        </button>
      </nav>

      <div className="collector">
        <b>자동 수집</b>
        <span>● KBO 경기/선발</span>
        <span>● 실시간 점수</span>
        <span>
          ○ 팀·투수 세부지표 (다음)
        </span>
      </div>
    </aside>
  );
}

import champion from "../../../data/kbo-engine-v1-champion.json";

export const dynamic = "force-dynamic";

export default function AiLearningReportPage() {
  const model = champion as { publicVersion?: string; version: string; trainedThrough: string; trainingGames: number; mode?: string };
  const version = model.publicVersion || "1.0";
  return (
    <div className="learningShell">
      <header className="learningSiteHeader"><a className="learningBrand" href="/">⚾ <b>KBO PICKS</b></a><nav><a href="/">오늘 경기</a><a href="/?tab=combos">⚾ 야구공 배팅</a><a href="/?tab=history">경기기록</a><a href="/?tab=community">커뮤니티</a><a href="/?tab=store">상점</a><a href="/?tab=profile">프로필</a><a href="/?tab=my-combos">구매내역</a><a className="active" href="/ai-learning-report">AI 학습</a><a href="/?tab=settings">설정</a></nav><a className="learningHomeButton" href="/">메인으로</a></header>
      <main className="learningMain">
        <section className="learningHero">
          <div><span className="learningEyebrow">KBO PICK ENGINE</span><h1>AI 학습 리포트</h1><p>경기 종료 후 실제 결과가 KBO PICK 엔진 학습과 검증에 어떻게 반영되는지 보여줍니다.</p></div>
          <div className="engineBadge"><span>현재 Champion</span><strong>KBO PICK 엔진 {version}</strong><small>운영 적용 중</small></div>
        </section>
        <section className="learningStats">
          <article><span>현재 엔진</span><strong>{version}</strong><small>KBO PICK Champion</small></article>
          <article><span>학습 완료 경기</span><strong>{model.trainingGames.toLocaleString()}경기</strong><small>현재 Champion 기준</small></article>
          <article><span>학습 완료 시점</span><strong>{model.trainedThrough}</strong><small>현재 Champion 학습 범위</small></article>
          <article><span>자동승격</span><strong>연결 준비중</strong><small>V4.14 안전검증</small></article>
        </section>
        <div className="learningGrid">
          <section className="learningPanel learningWide"><div className="panelHead"><div><span>DAILY LEARNING</span><h2>오늘의 학습</h2></div><b className="statusWait">데이터 연결 준비중</b></div><div className="learningEmpty"><strong>오늘의 학습 결과가 아직 연결되지 않았습니다.</strong><p>경기가 종료되면 당시 예상과 실제 결과를 비교하고 학습 데이터 반영 상태를 자동으로 표시합니다.</p></div></section>
          <section className="learningPanel"><div className="panelHead"><div><span>CHAMPION / CHALLENGER</span><h2>엔진 검증 현황</h2></div></div><div className="engineCompare"><div><span>CHAMPION</span><strong>{version}</strong><small>{model.trainingGames.toLocaleString()}경기 학습</small></div><b>VS</b><div><span>CHALLENGER</span><strong>대기</strong><small>최신 데이터 학습 전</small></div></div></section>
          <section className="learningPanel"><div className="panelHead"><div><span>AUTO PROMOTION</span><h2>자동승격 상태</h2></div><b className="statusWait">준비중</b></div><div className="promotionFlow"><strong>경기 종료</strong><i>→</i><strong>학습</strong><i>→</i><strong>검증</strong><i>→</i><strong>승격</strong></div><p className="panelNote">검증을 통과한 Challenger만 다음 Champion으로 적용됩니다.</p></section>
          <section className="learningPanel learningWide"><div className="panelHead"><div><span>GAME REPORTS</span><h2>경기별 AI 학습 리포트</h2></div><b>0경기</b></div><div className="learningEmpty"><strong>경기 종료 후 자동 생성</strong><p>분석 당시 예상 점수 · 실제 점수 · 팀별 득점 오차 · 총점 오차 · 승패 결과 · 학습 반영 여부를 경기별로 기록합니다.</p></div></section>
          <section className="learningPanel learningWide"><div className="panelHead"><div><span>VERSION HISTORY</span><h2>엔진 버전 기록</h2></div></div><div className="versionRow"><i></i><div><strong>KBO PICK 엔진 {version}</strong><p>{model.trainedThrough}까지 학습 · {model.trainingGames.toLocaleString()}경기</p></div><b>현재 Champion</b></div></section>
        </div>
      </main>
    </div>
  );
}

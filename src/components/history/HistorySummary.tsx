"use client";

import React from "react";

type Props = {
  selectedHistory: any;
};

export default function HistorySummary({
  selectedHistory,
}: Props) {
  if (!selectedHistory) return null;

  const awayScore = Number(selectedHistory.awayScore ?? 0);
  const homeScore = Number(selectedHistory.homeScore ?? 0);

  const winner =
    awayScore > homeScore
      ? selectedHistory.awayTeamName
      : homeScore > awayScore
      ? selectedHistory.homeTeamName
      : "무승부";

  return (
    <section className="historyTabSectionV9">
      <div className="historyTabTitleV9">
        <div>
          <small>GAME SUMMARY</small>
          <h3>경기 요약</h3>
        </div>

        <span>종료</span>
      </div>

      <div className="historySummaryScoreV9">
        <article>
          <small>AWAY</small>
          <strong>{selectedHistory.awayTeamName}</strong>
          <b>{selectedHistory.awayScore ?? "-"}</b>
        </article>

        <i>:</i>

        <article>
          <small>HOME</small>
          <strong>{selectedHistory.homeTeamName}</strong>
          <b>{selectedHistory.homeScore ?? "-"}</b>
        </article>
      </div>

      <div className="historyInfoGridV9">
        <article>
          <span>경기일</span>
          <strong>{selectedHistory.date || "-"}</strong>
        </article>

        <article>
          <span>구장</span>
          <strong>{selectedHistory.stadium || "-"}</strong>
        </article>

        <article>
          <span>승리팀</span>
          <strong>{winner}</strong>
        </article>

        <article>
          <span>총 득점</span>
          <strong>{awayScore + homeScore}</strong>
        </article>

        <article>
          <span>베트맨</span>
          <strong>
            {selectedHistory.betman ? "저장됨" : "없음"}
          </strong>
        </article>

        <article>
          <span>라인업</span>
          <strong>
            {selectedHistory.lineup ? "저장됨" : "없음"}
          </strong>
        </article>
      </div>

      <div className="historyStoredNoticeV9">
        이 화면은 당시 저장된 스냅샷만 사용하며
        현재 데이터로 과거 경기를 다시 계산하지 않습니다.
      </div>
    </section>
  );
}

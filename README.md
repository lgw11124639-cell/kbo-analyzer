# KBO Analyzer v0.1

첫 동작 버전입니다.

## 구현됨
- KBO 공식 게임센터 `GetKboGameList` 서버 호출
- 날짜별 경기 자동 로드
- 선발투수 / 구장 / 순위 / 실시간 점수 표시
- 경기별 카드 UI
- 승패 배당 직접 입력 + 브라우저 자동 저장
- 초기 ML 추천/EV 계산
- 경기 중복을 막은 자동 2/3/4폴 조합
- v0.2용 Supabase 적중기록 SQL 포함

## 실행
```bash
npm install
npm run dev
```
브라우저: http://localhost:3000

## 서버
```bash
npm run build
npm run start
```
기본 start 포트는 3200입니다.

## 다음 개발 순서
1. 팀 최근 5/10경기 자동 집계
2. 선발 ERA/WHIP/최근 3경기
3. 불펜 최근 3일 투구수/연투
4. 라인업 발표 후 모델 재계산
5. Supabase 추천 저장
6. 종료 경기 자동 정산(hit/miss/push)
7. 적중률/ROI 리포트

주의: KBO 공식 사이트의 내부 웹 API를 사용하므로 사이트 구조 변경 시 수집 어댑터 수정이 필요할 수 있습니다.

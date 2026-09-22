const date = "2026-09-13";

async function main() {
  const gameRes = await fetch(
    `http://localhost:3000/api/kbo/today?date=${date}`
  );

  const gameJson = await gameRes.json();

  console.log("===== 선발투수 목록 =====");

  for (const game of gameJson.games || []) {
    console.log(
      `${game.awayTeamName} ${game.startingPitchers?.away?.name ?? "-"} ` +
      `(${game.startingPitchers?.away?.id ?? "-"})` +
      "  vs  " +
      `${game.homeTeamName} ${game.startingPitchers?.home?.name ?? "-"} ` +
      `(${game.startingPitchers?.home?.id ?? "-"})`
    );
  }
}

main().catch(console.error);

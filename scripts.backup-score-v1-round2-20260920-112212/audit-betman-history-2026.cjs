const fs = require("fs");
const path = require("path");

const FILE = path.join(
  "/opt/kbo-analyzer",
  "data",
  "betman-kbo-history-2026.json"
);

const data = JSON.parse(
  fs.readFileSync(FILE, "utf8")
);

const games = Array.isArray(data.games)
  ? data.games
  : [];

function normalizeTeam(name) {
  const value = String(name || "")
    .replace(/\s+/g, "")
    .toLowerCase();

  const aliases = [
    [/^lg|lg트윈스$/, "LG"],
    [/^한화|한화이글스$/, "한화"],
    [/^ssg|ssg랜더스$/, "SSG"],
    [/^nc|nc다이노스$/, "NC"],
    [/^kt|kt위즈$/, "KT"],
    [/^kia|kia타이거즈$/, "KIA"],
    [/^삼성|삼성라이온즈$/, "삼성"],
    [/^롯데|롯데자이언츠$/, "롯데"],
    [/^두산|두산베어스$/, "두산"],
    [/^키움|키움히어로즈$/, "키움"],
  ];

  for (const [regex, result] of aliases) {
    if (regex.test(value)) {
      return result;
    }
  }

  return String(name || "").trim();
}

function actualGameKey(game) {
  return [
    game.date,
    normalizeTeam(game.homeTeam),
    normalizeTeam(game.awayTeam),
  ].join("|");
}

const groups = new Map();

for (const game of games) {
  const key = actualGameKey(game);

  const current =
    groups.get(key) || [];

  current.push(game);

  groups.set(key, current);
}

const uniqueGames =
  [...groups.values()];

const duplicates =
  uniqueGames
    .filter((items) => items.length > 1)
    .sort(
      (a, b) =>
        b.length - a.length
    );

const canceled =
  games.filter(
    (game) =>
      game.canceled ||
      !game.actualScore
  );

const completeMarkets =
  games.filter(
    (game) =>
      game.moneyline &&
      game.spread &&
      game.total
  );

console.log(
  "===== BETMAN HISTORY AUDIT ====="
);

console.log(
  "원본 레코드:",
  games.length
);

console.log(
  "실제 고유 경기:",
  uniqueGames.length
);

console.log(
  "중복 레코드 수:",
  games.length - uniqueGames.length
);

console.log(
  "중복된 실제 경기:",
  duplicates.length
);

console.log(
  "취소/결과없음 레코드:",
  canceled.length
);

console.log(
  "ML+핸디+UO 모두 존재:",
  completeMarkets.length
);

console.log();
console.log(
  "===== 중복 상위 30건 ====="
);

for (
  const items of duplicates.slice(0, 30)
) {
  const first = items[0];

  console.log(
    [
      actualGameKey(first),
      `COUNT=${items.length}`,
      `ROUNDS=${items
        .map((g) => g.round)
        .join(",")}`,
      `GMTS=${items
        .map((g) => g.gmTs)
        .join(",")}`,
    ].join(" | ")
  );
}

console.log();
console.log(
  "===== 월별 고유 경기 ====="
);

const monthly = {};

for (const items of uniqueGames) {
  const game = items[0];
  const month =
    String(game.date).slice(0, 7);

  monthly[month] =
    (monthly[month] || 0) + 1;
}

console.table(
  Object.entries(monthly)
    .sort()
    .map(([month, count]) => ({
      month,
      games: count,
    }))
);

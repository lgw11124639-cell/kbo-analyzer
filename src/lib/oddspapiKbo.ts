type MarketCatalogItem = {
  marketId: number;
  marketLength: number;
  marketName: string;
  playerProp: boolean;
  sportId: number;
  handicap: number;
  period: string;
  marketType: string;
  outcomes: {
    outcomeId: number;
    outcomeName: string;
  }[];
};

type OddsPlayer = {
  price?: number;
  mainLine?: boolean;
  active?: boolean;
};

type OddsOutcome = {
  players?: Record<string, OddsPlayer>;
};

type OddsMarket = {
  bookmakerMarketId?: string;
  marketActive?: boolean;
  outcomes?: Record<string, OddsOutcome>;
};

type OddsBook = {
  bookmakerActive?: boolean;
  markets?: Record<string, OddsMarket>;
};

type OddsFixture = {
  fixtureId: string;
  participant1Name?: string;
  participant2Name?: string;
  startTime?: string;
  updatedAt?: string;
  hasOdds?: boolean;
  bookmakerOdds?: Record<string, OddsBook>;
};

export type OddspapiNormalizedEvent = {
  id: string;
  commenceTime: string;

  awayTeamRaw: string;
  homeTeamRaw: string;

  awayTeam: string;
  homeTeam: string;

  awayMl: number | null;
  homeMl: number | null;

  awaySpreadLine: number | null;
  homeSpreadLine: number | null;

  awayHandicap: number | null;
  homeHandicap: number | null;

  totalLine: number | null;
  overOdds: number | null;
  underOdds: number | null;

  bookmakerCount: number;
  lastUpdate: string | null;
};

let marketCache:
  | {
      expiresAt: number;
      map: Map<number, MarketCatalogItem>;
    }
  | null = null;

function normalizeTeam(
  name: string
) {
  const n = name
    .toLowerCase()
    .replace(
      /[^a-z0-9가-힣]/g,
      ""
    );

  const aliases:
    Record<string, string> = {
      lgtwins: "LG",
      lg트윈스: "LG",

      hanwhaeagles: "한화",
      한화이글스: "한화",

      sslanders: "SSG",
      ssglanders: "SSG",
      ssg랜더스: "SSG",

      ncdinos: "NC",
      nc다이노스: "NC",

      ktwiz: "KT",
      kt위즈: "KT",

      kiatigers: "KIA",
      kia타이거즈: "KIA",

      samsunglions: "삼성",
      삼성라이온즈: "삼성",

      lottegiants: "롯데",
      롯데자이언츠: "롯데",

      doosanbears: "두산",
      두산베어스: "두산",

      kiwoomheroes: "키움",
      키움히어로즈: "키움",
    };

  return aliases[n] || name;
}

function kstDate(
  iso: string
) {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }
  ).format(
    new Date(iso)
  );
}

async function loadMarketMap(
  apiKey: string
) {
  if (
    marketCache &&
    marketCache.expiresAt >
      Date.now()
  ) {
    return marketCache.map;
  }

  const url =
    new URL(
      "https://api.oddspapi.io/v4/markets"
    );

  url.searchParams.set(
    "sportId",
    "13"
  );

  url.searchParams.set(
    "language",
    "en"
  );

  url.searchParams.set(
    "apiKey",
    apiKey
  );

  const response =
    await fetch(
      url.toString(),
      {
        cache: "no-store",
      }
    );

  if (!response.ok) {
    throw new Error(
      `Oddspapi markets ${response.status}`
    );
  }

  const data =
    await response.json();

  if (!Array.isArray(data)) {
    throw new Error(
      "Oddspapi market catalog invalid"
    );
  }

  const map =
    new Map<
      number,
      MarketCatalogItem
    >();

  for (const item of data) {
    if (
      typeof item?.marketId !==
      "number"
    ) {
      continue;
    }

    map.set(
      item.marketId,
      item as MarketCatalogItem
    );
  }

  /*
    시장표는 자주 바뀌지 않으므로
    프로세스 메모리에 6시간 캐시.
  */
  marketCache = {
    expiresAt:
      Date.now() +
      6 * 60 * 60 * 1000,
    map,
  };

  return map;
}

function marketHasMainLine(
  market: OddsMarket
) {
  for (
    const outcome of
    Object.values(
      market.outcomes || {}
    )
  ) {
    for (
      const player of
      Object.values(
        outcome.players || {}
      )
    ) {
      if (
        player.active !== false &&
        player.mainLine === true
      ) {
        return true;
      }
    }
  }

  return false;
}

function outcomePrice(
  market: OddsMarket,
  outcomeId: number
) {
  const outcome =
    market.outcomes?.[
      String(outcomeId)
    ];

  if (!outcome) {
    return null;
  }

  const players =
    Object.values(
      outcome.players || {}
    );

  const active =
    players.find(
      (player) =>
        player.active !== false &&
        typeof player.price ===
          "number" &&
        player.price > 1
    );

  return active?.price ?? null;
}

function outcomeIdByName(
  catalog: MarketCatalogItem,
  name: string
) {
  const found =
    catalog.outcomes.find(
      (outcome) =>
        outcome.outcomeName
          .toLowerCase() ===
        name.toLowerCase()
    );

  return (
    found?.outcomeId ??
    null
  );
}

export async function fetchOddspapiKboOdds(
  targetDate: string
): Promise<
  OddspapiNormalizedEvent[]
> {
  const apiKey =
    process.env
      .ODDSPAPI_API_KEY;

  if (!apiKey) {
    return [];
  }

  const [
    marketMap,
    oddsResponse,
  ] =
    await Promise.all([
      loadMarketMap(
        apiKey
      ),

      (() => {
        const url =
          new URL(
            "https://api.oddspapi.io/v4/odds-by-tournaments"
          );

        url.searchParams.set(
          "tournamentIds",
          "2541"
        );

        url.searchParams.set(
          "bookmaker",
          "kalshi"
        );

        url.searchParams.set(
          "language",
          "en"
        );

        url.searchParams.set(
          "oddsFormat",
          "decimal"
        );

        url.searchParams.set(
          "verbosity",
          "3"
        );

        url.searchParams.set(
          "apiKey",
          apiKey
        );

        return fetch(
          url.toString(),
          {
            cache: "no-store",
          }
        );
      })(),
    ]);

  if (!oddsResponse.ok) {
    throw new Error(
      `Oddspapi odds ${oddsResponse.status}`
    );
  }

  const data =
    await oddsResponse.json();

  if (!Array.isArray(data)) {
    return [];
  }

  const fixtures =
    data as OddsFixture[];

  const result:
    OddspapiNormalizedEvent[] =
    [];

  for (const fixture of fixtures) {
    if (
      !fixture.startTime ||
      !fixture.participant1Name ||
      !fixture.participant2Name
    ) {
      continue;
    }

    if (
      kstDate(
        fixture.startTime
      ) !== targetDate
    ) {
      continue;
    }

    if (
      fixture.hasOdds !== true
    ) {
      continue;
    }

    const book =
      fixture.bookmakerOdds
        ?.kalshi;

    if (!book) {
      continue;
    }

    const markets =
      book.markets || {};

    /*
      Oddspapi KBO fixture 구조 확인 결과:

      participant1 = 홈팀
      participant2 = 원정팀

      outcome "1" = 홈팀
      outcome "2" = 원정팀
    */
    const homeRaw =
      fixture.participant1Name;

    const awayRaw =
      fixture.participant2Name;

    let awayMl:
      number | null =
      null;

    let homeMl:
      number | null =
      null;

    let awaySpreadLine:
      number | null =
      null;

    let homeSpreadLine:
      number | null =
      null;

    let awayHandicap:
      number | null =
      null;

    let homeHandicap:
      number | null =
      null;

    let totalLine:
      number | null =
      null;

    let overOdds:
      number | null =
      null;

    let underOdds:
      number | null =
      null;

    for (
      const [
        marketIdText,
        market,
      ] of Object.entries(
        markets
      )
    ) {
      const marketId =
        Number(
          marketIdText
        );

      if (
        !Number.isFinite(
          marketId
        )
      ) {
        continue;
      }

      const catalog =
        marketMap.get(
          marketId
        );

      if (!catalog) {
        continue;
      }

      /*
        전체 경기(result) 시장만 사용.
        1회 O/U(p1), 이닝별 시장 등은 제외.
      */
      if (
        catalog.period !==
        "result"
      ) {
        continue;
      }

      /*
        bookmaker가 지정한 메인라인만 사용.
        예: O/U 5.5, 7.5, 9.5, 11.5 중
        현재 주력 기준점 하나만 선택.
      */
      if (
        !marketHasMainLine(
          market
        )
      ) {
        continue;
      }

      if (
        catalog.marketType ===
        "moneyline"
      ) {
        const homeId =
          outcomeIdByName(
            catalog,
            "1"
          );

        const awayId =
          outcomeIdByName(
            catalog,
            "2"
          );

        if (
          homeId !== null
        ) {
          homeMl =
            outcomePrice(
              market,
              homeId
            );
        }

        if (
          awayId !== null
        ) {
          awayMl =
            outcomePrice(
              market,
              awayId
            );
        }

        continue;
      }

      if (
        catalog.marketType ===
        "spreads"
      ) {
        const homeId =
          outcomeIdByName(
            catalog,
            "1"
          );

        const awayId =
          outcomeIdByName(
            catalog,
            "2"
          );

        /*
          Oddspapi handicap은
          participant1(홈팀) 기준.
        */
        homeSpreadLine =
          catalog.handicap;

        awaySpreadLine =
          catalog.handicap *
          -1;

        if (
          homeId !== null
        ) {
          homeHandicap =
            outcomePrice(
              market,
              homeId
            );
        }

        if (
          awayId !== null
        ) {
          awayHandicap =
            outcomePrice(
              market,
              awayId
            );
        }

        continue;
      }

      if (
        catalog.marketType ===
        "totals"
      ) {
        const overId =
          outcomeIdByName(
            catalog,
            "Over"
          );

        const underId =
          outcomeIdByName(
            catalog,
            "Under"
          );

        totalLine =
          catalog.handicap;

        if (
          overId !== null
        ) {
          overOdds =
            outcomePrice(
              market,
              overId
            );
        }

        if (
          underId !== null
        ) {
          underOdds =
            outcomePrice(
              market,
              underId
            );
        }
      }
    }

    const hasUsableOdds =
      awayMl !== null ||
      homeMl !== null ||
      awayHandicap !== null ||
      homeHandicap !== null ||
      overOdds !== null ||
      underOdds !== null;

    if (!hasUsableOdds) {
      continue;
    }

    result.push({
      id:
        fixture.fixtureId,

      commenceTime:
        fixture.startTime,

      awayTeamRaw:
        awayRaw,

      homeTeamRaw:
        homeRaw,

      awayTeam:
        normalizeTeam(
          awayRaw
        ),

      homeTeam:
        normalizeTeam(
          homeRaw
        ),

      awayMl,
      homeMl,

      awaySpreadLine,
      homeSpreadLine,

      awayHandicap,
      homeHandicap,

      totalLine,
      overOdds,
      underOdds,

      bookmakerCount:
        1,

      lastUpdate:
        fixture.updatedAt ||
        null,
    });
  }

  return result;
}

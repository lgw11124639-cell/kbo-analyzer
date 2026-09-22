import fs from "node:fs";
import path from "node:path";

export type BetmanNormalizedEvent = {
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

type BetmanStoredEvent = {
  id: string;
  provider?: string;
  date: string;
  commenceTime: string;

  homeTeamRaw: string;
  awayTeamRaw: string;

  moneyline?: {
    matchSeq?: number;
    homeOdds?: number;
    awayOdds?: number;
  } | null;

  spread?: {
    matchSeq?: number;
    homeLine?: number;
    homeOdds?: number;
    awayLine?: number;
    awayOdds?: number;
  } | null;

  total?: {
    matchSeq?: number;
    line?: number;
    underOdds?: number;
    overOdds?: number;
  } | null;
};

type BetmanCacheFile = {
  provider?: string;
  fetchedAt?: string;

  gmId?: string;
  gmTs?: number;

  round?: number;
  roundYear?: number;

  saleStatus?: string | null;
  statusMessage?: string | null;

  events?: BetmanStoredEvent[];
};

const CACHE_FILE =
  path.join(
    process.cwd(),
    "data",
    "betman-kbo-live.json"
  );

/*
  Betman 수집기가 5분마다 갱신된다.

  15분 이상 업데이트되지 않은 파일은
  장애/세션 문제 가능성이 있으므로 사용하지 않는다.
*/
const MAX_AGE_MS =
  15 * 60 * 1000;

function normalizeTeam(
  name: string
) {
  const n =
    name
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

  return (
    aliases[n] ||
    name
  );
}

function validOdd(
  value: unknown
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 1
  );
}

function validLine(
  value: unknown
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}

export function fetchBetmanKboOdds(
  requestedDate: string
): BetmanNormalizedEvent[] {
  try {
    if (
      !fs.existsSync(
        CACHE_FILE
      )
    ) {
      return [];
    }

    const raw =
      fs.readFileSync(
        CACHE_FILE,
        "utf8"
      );

    const data:
      BetmanCacheFile =
      JSON.parse(raw);

    if (
      !data.fetchedAt
    ) {
      return [];
    }

    const fetchedAtMs =
      new Date(
        data.fetchedAt
      ).getTime();

    if (
      !Number.isFinite(
        fetchedAtMs
      )
    ) {
      return [];
    }

    const age =
      Date.now() -
      fetchedAtMs;

    const isStale =
      age < 0 ||
      age >
        MAX_AGE_MS;

    if (isStale) {
      console.warn(
        "[BETMAN KBO] stale cache - matching date will still be used",
        {
          fetchedAt:
            data.fetchedAt,
          requestedDate,
          ageSeconds:
            Math.round(
              age / 1000
            ),
        }
      );
    }

    const events =
      Array.isArray(
        data.events
      )
        ? data.events
        : [];

    return events
      .filter(
        (event) =>
          event.date ===
          requestedDate
      )
      .map(
        (
          event
        ): BetmanNormalizedEvent => {
          const ml =
            event.moneyline;

          const spread =
            event.spread;

          const total =
            event.total;

          return {
            id:
              event.id,

            commenceTime:
              event.commenceTime,

            awayTeamRaw:
              event.awayTeamRaw,

            homeTeamRaw:
              event.homeTeamRaw,

            awayTeam:
              normalizeTeam(
                event.awayTeamRaw
              ),

            homeTeam:
              normalizeTeam(
                event.homeTeamRaw
              ),

            awayMl:
              validOdd(
                ml?.awayOdds
              )
                ? ml!.awayOdds!
                : null,

            homeMl:
              validOdd(
                ml?.homeOdds
              )
                ? ml!.homeOdds!
                : null,

            awaySpreadLine:
              validLine(
                spread?.awayLine
              )
                ? spread!.awayLine!
                : null,

            homeSpreadLine:
              validLine(
                spread?.homeLine
              )
                ? spread!.homeLine!
                : null,

            awayHandicap:
              validOdd(
                spread?.awayOdds
              )
                ? spread!.awayOdds!
                : null,

            homeHandicap:
              validOdd(
                spread?.homeOdds
              )
                ? spread!.homeOdds!
                : null,

            totalLine:
              validLine(
                total?.line
              ) &&
              total!.line! > 0
                ? total!.line!
                : null,

            overOdds:
              validOdd(
                total?.overOdds
              )
                ? total!.overOdds!
                : null,

            underOdds:
              validOdd(
                total?.underOdds
              )
                ? total!.underOdds!
                : null,

            bookmakerCount:
              1,

            lastUpdate:
              data.fetchedAt ||
              null,
          };
        }
      )
      .filter(
        (event) =>
          event.homeMl !==
            null ||
          event.awayMl !==
            null ||
          event.homeHandicap !==
            null ||
          event.awayHandicap !==
            null ||
          event.totalLine !==
            null
      );
  } catch (error) {
    console.error(
      "[BETMAN KBO CACHE]",
      error
    );

    return [];
  }
}

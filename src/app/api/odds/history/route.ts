import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

type OddsSnapshot = {
  id: string;
  gameId: string;
  date: string;

  awayTeamName: string;
  homeTeamName: string;

  capturedAt: string;

  awayMl: number | null;
  homeMl: number | null;

  awayHandicapLine: number | null;
  homeHandicapLine: number | null;

  awayHandicap: number | null;
  homeHandicap: number | null;

  totalLine: number | null;
  overOdds: number | null;
  underOdds: number | null;

  source: "AUTO" | "MANUAL";
};

type HistoryFile = {
  version: number;
  snapshots: OddsSnapshot[];
};

const dataDir =
  path.join(
    process.cwd(),
    "data"
  );

const dataFile =
  path.join(
    dataDir,
    "kbo-odds-history.json"
  );

const EMPTY: HistoryFile = {
  version: 1,
  snapshots: [],
};

async function readHistory():
  Promise<HistoryFile> {
  try {
    const raw =
      await fs.readFile(
        dataFile,
        "utf8"
      );

    const parsed =
      JSON.parse(raw);

    return {
      version: 1,
      snapshots:
        Array.isArray(parsed.snapshots)
          ? parsed.snapshots
          : [],
    };
  } catch {
    return EMPTY;
  }
}

async function writeHistory(
  data: HistoryFile
) {
  await fs.mkdir(
    dataDir,
    { recursive: true }
  );

  const temp =
    `${dataFile}.tmp`;

  await fs.writeFile(
    temp,
    JSON.stringify(
      data,
      null,
      2
    ),
    "utf8"
  );

  await fs.rename(
    temp,
    dataFile
  );
}

function sameOdds(
  a: OddsSnapshot,
  b: OddsSnapshot
) {
  return (
    a.gameId === b.gameId &&
    a.awayMl === b.awayMl &&
    a.homeMl === b.homeMl &&
    a.awayHandicapLine ===
      b.awayHandicapLine &&
    a.homeHandicapLine ===
      b.homeHandicapLine &&
    a.awayHandicap ===
      b.awayHandicap &&
    a.homeHandicap ===
      b.homeHandicap &&
    a.totalLine ===
      b.totalLine &&
    a.overOdds ===
      b.overOdds &&
    a.underOdds ===
      b.underOdds
  );
}

export async function GET(
  request: Request
) {
  const history =
    await readHistory();

  const url =
    new URL(request.url);

  const date =
    url.searchParams.get("date");

  const gameId =
    url.searchParams.get("gameId");

  let snapshots =
    history.snapshots;

  if (date) {
    snapshots =
      snapshots.filter(
        (item) =>
          item.date === date
      );
  }

  if (gameId) {
    snapshots =
      snapshots.filter(
        (item) =>
          item.gameId === gameId
      );
  }

  return NextResponse.json(
    {
      version: 1,
      count:
        snapshots.length,
      snapshots,
    },
    {
      headers: {
        "Cache-Control":
          "no-store, no-cache, must-revalidate",
      },
    }
  );
}

export async function POST(
  request: Request
) {
  try {
    const body =
      await request.json();

    const incoming =
      Array.isArray(body.snapshots)
        ? body.snapshots
        : [];

    if (!incoming.length) {
      return NextResponse.json({
        ok: true,
        added: 0,
      });
    }

    const history =
      await readHistory();

    let added = 0;

    for (const raw of incoming) {
      if (
        !raw ||
        typeof raw.gameId !== "string" ||
        typeof raw.date !== "string"
      ) {
        continue;
      }

      const snapshot:
        OddsSnapshot = {
        id:
          `${raw.gameId}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,

        gameId:
          raw.gameId,

        date:
          raw.date,

        awayTeamName:
          String(
            raw.awayTeamName || ""
          ),

        homeTeamName:
          String(
            raw.homeTeamName || ""
          ),

        capturedAt:
          new Date().toISOString(),

        awayMl:
          raw.awayMl ?? null,

        homeMl:
          raw.homeMl ?? null,

        awayHandicapLine:
          raw.awayHandicapLine ??
          null,

        homeHandicapLine:
          raw.homeHandicapLine ??
          null,

        awayHandicap:
          raw.awayHandicap ??
          null,

        homeHandicap:
          raw.homeHandicap ??
          null,

        totalLine:
          raw.totalLine ?? null,

        overOdds:
          raw.overOdds ?? null,

        underOdds:
          raw.underOdds ?? null,

        source:
          raw.source === "MANUAL"
            ? "MANUAL"
            : "AUTO",
      };

      const previous =
        [...history.snapshots]
          .reverse()
          .find(
            (item) =>
              item.gameId ===
              snapshot.gameId &&
              item.source ===
              snapshot.source
          );

      /*
        같은 경기에서 배당/기준점이
        하나도 변하지 않았다면
        중복 스냅샷을 만들지 않는다.
      */
      if (
        previous &&
        sameOdds(
          previous,
          snapshot
        )
      ) {
        continue;
      }

      history.snapshots.push(
        snapshot
      );

      added += 1;
    }

    /*
      임시 JSON 저장소가 너무 커지는 것을
      방지하기 위해 최신 20,000개 유지.
      DB 이전 시 이 제한 제거 가능.
    */
    if (
      history.snapshots.length >
      20000
    ) {
      history.snapshots =
        history.snapshots.slice(
          -20000
        );
    }

    await writeHistory(
      history
    );

    return NextResponse.json({
      ok: true,
      added,
      total:
        history.snapshots.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "odds history save failed",
      },
      {
        status: 500,
      }
    );
  }
}

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

type SharedState = {
  version: number;
  updatedAt: string | null;

  savedOdds: Record<string, unknown>;
  lockedOdds: Record<string, boolean>;
  savedCombos: unknown[];
};

const EMPTY_STATE: SharedState = {
  version: 1,
  updatedAt: null,
  savedOdds: {},
  lockedOdds: {},
  savedCombos: [],
};

const dataDir = path.join(
  process.cwd(),
  "data"
);

const dataFile = path.join(
  dataDir,
  "kbo-shared-state.json"
);

async function readState(): Promise<SharedState> {
  try {
    const raw = await fs.readFile(
      dataFile,
      "utf8"
    );

    const parsed = JSON.parse(raw);

    return {
      version: 1,
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : null,

      savedOdds:
        parsed.savedOdds &&
        typeof parsed.savedOdds === "object"
          ? parsed.savedOdds
          : {},

      lockedOdds:
        parsed.lockedOdds &&
        typeof parsed.lockedOdds === "object"
          ? parsed.lockedOdds
          : {},

      savedCombos:
        Array.isArray(parsed.savedCombos)
          ? parsed.savedCombos
          : [],
    };
  } catch {
    return EMPTY_STATE;
  }
}

async function writeState(
  state: SharedState
) {
  await fs.mkdir(
    dataDir,
    { recursive: true }
  );

  const tempFile =
    `${dataFile}.tmp`;

  await fs.writeFile(
    tempFile,
    JSON.stringify(
      state,
      null,
      2
    ),
    "utf8"
  );

  await fs.rename(
    tempFile,
    dataFile
  );
}

export async function GET() {
  const state =
    await readState();

  return NextResponse.json(
    state,
    {
      headers: {
        "Cache-Control":
          "no-store, no-cache, must-revalidate",
      },
    }
  );
}

export async function PUT(
  request: Request
) {
  try {
    const body =
      await request.json();

    const current =
      await readState();

    const next: SharedState = {
      version: 1,
      updatedAt:
        new Date().toISOString(),

      savedOdds:
        body.savedOdds &&
        typeof body.savedOdds === "object"
          ? body.savedOdds
          : current.savedOdds,

      lockedOdds:
        body.lockedOdds &&
        typeof body.lockedOdds === "object"
          ? body.lockedOdds
          : current.lockedOdds,

      savedCombos:
        Array.isArray(body.savedCombos)
          ? body.savedCombos
          : current.savedCombos,
    };

    await writeState(next);

    return NextResponse.json({
      ok: true,
      ...next,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "state save failed",
      },
      {
        status: 500,
      }
    );
  }
}

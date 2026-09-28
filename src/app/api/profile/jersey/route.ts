import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createClient,
  type User,
} from "@supabase/supabase-js";

export const dynamic =
  "force-dynamic";

type JerseyProfileRow = {
  jersey_number: string | null;
  free_jersey_change_used: boolean;
  jersey_change_tickets: number;
  jersey_number_updated_at: string | null;
};


const url =
  process.env
    .NEXT_PUBLIC_SUPABASE_URL ||
  "";

const pub =
  process.env
    .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "";

const secret =
  process.env
    .SUPABASE_SECRET_KEY ||
  "";


function publicClient() {
  return createClient(
    url,
    pub,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}


function adminClient() {
  return createClient(
    url,
    secret,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}


async function authUser(
  req: NextRequest
): Promise<User | null> {

  const authorization =
    req.headers.get(
      "authorization"
    ) || "";

  const token =
    authorization.startsWith(
      "Bearer "
    )
      ? authorization.slice(7)
      : "";

  if (!token) {
    return null;
  }

  const {
    data,
    error,
  } =
    await publicClient()
      .auth
      .getUser(token);

  if (error) {
    return null;
  }

  return data.user ?? null;
}


function normalizeNumber(
  value: unknown
) {

  const raw =
    String(value ?? "")
      .trim();

  if (
    !/^[0-9]{1,2}$/.test(raw)
  ) {
    return null;
  }

  const number =
    Number(raw);

  if (
    !Number.isInteger(number) ||
    number < 0 ||
    number > 99
  ) {
    return null;
  }

  return String(number)
    .padStart(2, "0");
}


/* ==========================================================
   GET /api/profile/jersey
   ========================================================== */

export async function GET(
  req: NextRequest
) {

  const user =
    await authUser(req);

  if (!user) {
    return NextResponse.json(
      {
        error:
          "로그인이 필요합니다.",
      },
      {
        status: 401,
      }
    );
  }

  const admin =
    adminClient();

  const {
    data,
    error,
  } =
    await admin
      .from(
        "kbo_user_profiles"
      )
      .select(
        [
          "jersey_number",
          "free_jersey_change_used",
          "jersey_change_tickets",
          "jersey_number_updated_at",
        ].join(",")
      )
      .eq(
        "user_id",
        user.id
      )
      .maybeSingle();

  if (error) {
    console.error(
      "JERSEY_GET_ERROR",
      error
    );

    return NextResponse.json(
      {
        error:
          "등번호 정보를 불러오지 못했습니다.",
      },
      {
        status: 500,
      }
    );
  }

  const profile =
    (data ?? null) as
      JerseyProfileRow | null;

  return NextResponse.json({
    jerseyNumber:
      profile?.jersey_number ??
      null,

    freeChangeUsed:
      Boolean(
        profile
          ?.free_jersey_change_used
      ),

    tickets:
      Number(
        profile
          ?.jersey_change_tickets ??
        0
      ),

    updatedAt:
      profile
        ?.jersey_number_updated_at ??
      null,
  });
}


/* ==========================================================
   POST /api/profile/jersey
   ========================================================== */

export async function POST(
  req: NextRequest
) {

  const user =
    await authUser(req);

  if (!user) {
    return NextResponse.json(
      {
        error:
          "로그인이 필요합니다.",
      },
      {
        status: 401,
      }
    );
  }

  let body:
    | {
        jerseyNumber?: unknown;
      }
    | null = null;

  try {
    body =
      await req.json();
  } catch {
    return NextResponse.json(
      {
        error:
          "잘못된 요청입니다.",
      },
      {
        status: 400,
      }
    );
  }


  const jerseyNumber =
    normalizeNumber(
      body?.jerseyNumber
    );

  if (!jerseyNumber) {
    return NextResponse.json(
      {
        error:
          "등번호는 00~99 중에서 선택해주세요.",
      },
      {
        status: 400,
      }
    );
  }


  const admin =
    adminClient();

  const {
    data,
    error,
  } =
    await admin.rpc(
      "kbo_change_jersey_number",
      {
        p_user_id:
          user.id,

        p_jersey_number:
          jerseyNumber,
      }
    );


  if (error) {

    console.error(
      "JERSEY_CHANGE_ERROR",
      error
    );

    const message =
      String(
        error.message ?? ""
      );


    if (
      message.includes(
        "SAME_JERSEY_NUMBER"
      )
    ) {
      return NextResponse.json(
        {
          error:
            "현재 사용 중인 등번호입니다.",
        },
        {
          status: 400,
        }
      );
    }


    if (
      message.includes(
        "JERSEY_CHANGE_TICKET_REQUIRED"
      )
    ) {
      return NextResponse.json(
        {
          error:
            "무료 변경을 모두 사용했습니다. 상점에서 등번호 변경권이 필요합니다.",
          code:
            "JERSEY_CHANGE_TICKET_REQUIRED",
        },
        {
          status: 409,
        }
      );
    }


    if (
      message.includes(
        "INVALID_JERSEY_NUMBER"
      )
    ) {
      return NextResponse.json(
        {
          error:
            "등번호는 00~99 중에서 선택해주세요.",
        },
        {
          status: 400,
        }
      );
    }


    return NextResponse.json(
      {
        error:
          "등번호 변경에 실패했습니다.",
      },
      {
        status: 500,
      }
    );
  }


  /*
   * Auth metadata도 현재 번호와 동기화.
   * DB 프로필이 실제 기준이고,
   * metadata는 화면/호환용 복사본.
   */
  const {
    error: metadataError,
  } =
    await admin.auth.admin
      .updateUserById(
        user.id,
        {
          user_metadata: {
            ...(
              user.user_metadata ??
              {}
            ),
            jersey_number:
              jerseyNumber,
          },
        }
      );

  if (metadataError) {
    console.error(
      "JERSEY_METADATA_SYNC_ERROR",
      metadataError
    );
  }


  return NextResponse.json({
    ok: true,

    jerseyNumber:
      data?.jerseyNumber ??
      jerseyNumber,

    changeMethod:
      data?.changeMethod ??
      null,

    freeChangeUsed:
      Boolean(
        data?.freeChangeUsed
      ),

    tickets:
      Number(
        data?.tickets ?? 0
      ),
  });
}

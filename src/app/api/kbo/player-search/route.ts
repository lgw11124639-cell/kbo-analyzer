import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

export const dynamic = "force-dynamic";

function normalizeTeamName(
  value: string | null | undefined
) {
  return (value ?? "")
    .replace(/\s+/g, "")
    .replace("두산베어스", "두산")
    .replace("LG트윈스", "LG")
    .replace("삼성라이온즈", "삼성")
    .replace("KIA타이거즈", "KIA")
    .replace("한화이글스", "한화")
    .replace("롯데자이언츠", "롯데")
    .replace("KT위즈", "KT")
    .replace("NC다이노스", "NC")
    .replace("SSG랜더스", "SSG")
    .replace("키움히어로즈", "키움");
}

function playerIdFromHref(
  href: string | undefined
) {
  if (!href) {
    return null;
  }

  const match =
    href.match(
      /playerId=(\d+)/i
    );

  return match
    ? Number(match[1])
    : null;
}

export async function GET(
  request: Request
) {
  const url =
    new URL(request.url);

  const name =
    url.searchParams
      .get("name")
      ?.trim();

  const team =
    normalizeTeamName(
      url.searchParams.get(
        "team"
      )
    );

  if (!name) {
    return NextResponse.json(
      {
        error:
          "name 파라미터가 필요합니다.",
      },
      {
        status: 400,
      }
    );
  }

  try {
    const searchUrl =
      new URL(
        "https://www.koreabaseball.com/Player/Search.aspx"
      );

    searchUrl.searchParams.set(
      "searchWord",
      name
    );

    const response =
      await fetch(
        searchUrl.toString(),
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",

            "Accept-Language":
              "ko-KR,ko;q=0.9",
          },

          cache: "no-store",
        }
      );

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            "KBO 선수 조회 실패",
        },
        {
          status: 502,
        }
      );
    }

    const html =
      await response.text();

    const $ =
      cheerio.load(html);

    const candidates: Array<{
      name: string;
      team: string;
      position: string;
      number: string;
      playerId: number | null;
      href: string | null;
    }> = [];

    $("table tbody tr").each(
      (_, row) => {
        const cells =
          $(row).find("td");

        if (
          cells.length < 3
        ) {
          return;
        }

        const number =
          $(cells[0])
            .text()
            .trim();

        const nameCell =
          $(cells[1]);

        const playerName =
          nameCell
            .text()
            .trim();

        const teamName =
          normalizeTeamName(
            $(cells[2])
              .text()
              .trim()
          );

        const position =
          cells.length > 3
            ? $(cells[3])
                .text()
                .trim()
            : "";

        const anchor =
          nameCell.find("a")
            .first();

        const href =
          anchor.attr("href") ??
          null;

        const playerId =
          playerIdFromHref(
            href ??
            undefined
          );

        if (
          playerName
        ) {
          candidates.push({
            name:
              playerName,
            team:
              teamName,
            position,
            number,
            playerId,
            href,
          });
        }
      }
    );

    const exact =
      candidates.find(
        (player) =>
          player.name === name &&
          (
            !team ||
            player.team === team
          )
      ) ??
      candidates.find(
        (player) =>
          player.name === name
      ) ??
      null;

    return NextResponse.json({
      fetchedAt:
        new Date()
          .toISOString(),

      query: {
        name,
        team:
          team || null,
      },

      found:
        Boolean(exact),

      player:
        exact,

      candidates,
    });

  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "unknown error",
      },
      {
        status: 500,
      }
    );
  }
}

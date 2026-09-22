const cheerio = require("cheerio");

async function main() {
  const response = await fetch(
    "https://www.koreabaseball.com/Player/RegisterAll.aspx",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept-Language":
          "ko-KR,ko;q=0.9,en;q=0.8"
      }
    }
  );

  console.log(
    "CONTENT-TYPE =",
    response.headers.get("content-type")
  );

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  const utf8 =
    new TextDecoder("utf-8")
      .decode(buffer);

  const euckr =
    new TextDecoder("euc-kr")
      .decode(buffer);

  /*
    소스파일 한글 인코딩 영향까지 피하기 위해
    이름을 Unicode escape로 작성
  */

  const names = [
    "\uAE40\uC8FC\uC6D0",       // 김주원
    "\uAD8C\uD76C\uB3D9",       // 권희동
    "\uC591\uC758\uC9C0",       // 양의지
    "\uC138\uBCA0\uB9AC\uB178"  // 세베리노
  ];

  function score(text) {
    return names.filter(
      name => text.includes(name)
    ).length;
  }

  console.log(
    "UTF8 MATCH =",
    score(utf8)
  );

  console.log(
    "EUC-KR MATCH =",
    score(euckr)
  );

  const html =
    score(euckr) >
    score(utf8)
      ? euckr
      : utf8;

  console.log(
    "USING =",
    html === euckr
      ? "EUC-KR"
      : "UTF-8"
  );

  const $ =
    cheerio.load(html);

  for (
    const name of names
  ) {
    console.log(
      "\n===================="
    );

    console.log(
      "NAME =",
      name
    );

    const matches =
      $("a, span, td")
        .filter((_, el) =>
          $(el)
            .text()
            .trim() === name
        );

    console.log(
      "MATCH COUNT =",
      matches.length
    );

    matches
      .slice(0, 5)
      .each((_, el) => {
        const node =
          $(el);

        console.log(
          "\nTAG =",
          el.tagName
        );

        console.log(
          "TEXT =",
          node.text().trim()
        );

        console.log(
          "HREF =",
          node.attr("href")
        );

        console.log(
          "ONCLICK =",
          node.attr("onclick")
        );

        console.log(
          "ID =",
          node.attr("id")
        );

        console.log(
          "CLASS =",
          node.attr("class")
        );

        console.log(
          "HTML =",
          $.html(el)
            .replace(/\s+/g, " ")
            .slice(0, 500)
        );

        const parent =
          node.parent();

        console.log(
          "PARENT HTML =",
          parent
            .toString()
            .replace(/\s+/g, " ")
            .slice(0, 800)
        );
      });
  }
}

main().catch(
  console.error
);

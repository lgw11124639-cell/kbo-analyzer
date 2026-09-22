import * as cheerio from "cheerio";

async function main() {
  const url =
    "https://www.koreabaseball.com/Record/Etc/HitVsPit.aspx";

  const res =
    await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept-Language":
          "ko-KR,ko;q=0.9",
      },
    });

  const html =
    await res.text();

  const $ =
    cheerio.load(html);

  console.log(
    "STATUS =",
    res.status
  );

  console.log(
    "CONTENT-TYPE =",
    res.headers.get(
      "content-type"
    )
  );

  console.log(
    "\n===== SELECT ====="
  );

  $("select").each(
    (_, el) => {
      const id =
        $(el).attr("id");

      const name =
        $(el).attr("name");

      console.log(
        "SELECT",
        {
          id,
          name,
        }
      );

      $(el)
        .find("option")
        .slice(0, 15)
        .each(
          (_, opt) => {
            console.log(
              "  OPTION",
              {
                value:
                  $(opt)
                    .attr("value"),
                text:
                  $(opt)
                    .text()
                    .trim(),
              }
            );
          }
        );
    }
  );

  console.log(
    "\n===== INPUT ====="
  );

  $("input").each(
    (_, el) => {
      const type =
        $(el).attr("type");

      const id =
        $(el).attr("id");

      const name =
        $(el).attr("name");

      const value =
        $(el).attr("value");

      if (
        type === "hidden" ||
        type === "submit" ||
        type === "button"
      ) {
        console.log({
          type,
          id,
          name,
          value:
            value?.slice(
              0,
              120
            ),
        });
      }
    }
  );

  console.log(
    "\n===== FORM ====="
  );

  $("form").each(
    (_, form) => {
      console.log({
        id:
          $(form).attr("id"),
        method:
          $(form).attr("method"),
        action:
          $(form).attr("action"),
      });
    }
  );
}

main().catch(console.error);

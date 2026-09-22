async function main() {
  const response = await fetch(
    "https://www.koreabaseball.com/Player/RegisterAll.aspx",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept-Language":
          "ko-KR,ko;q=0.9"
      }
    }
  );

  const html = await response.text();

  const names = [
    "\uAE40\uC8FC\uC6D0",       // 김주원
    "\uAD8C\uD76C\uB3D9",       // 권희동
    "\uC591\uC758\uC9C0",       // 양의지
    "\uC138\uBCA0\uB9AC\uB178"  // 세베리노
  ];

  for (const name of names) {
    console.log(
      "\n========================================"
    );

    console.log(
      "NAME =",
      name
    );

    let start = 0;
    let count = 0;

    while (true) {
      const index =
        html.indexOf(
          name,
          start
        );

      if (index < 0) {
        break;
      }

      count++;

      const from =
        Math.max(
          0,
          index - 500
        );

      const to =
        Math.min(
          html.length,
          index + 500
        );

      console.log(
        "\n--- MATCH",
        count,
        "---"
      );

      console.log(
        html
          .slice(
            from,
            to
          )
          .replace(
            /\r?\n/g,
            " "
          )
          .replace(
            /\s+/g,
            " "
          )
      );

      start =
        index +
        name.length;
    }

    console.log(
      "\nTOTAL =",
      count
    );
  }
}

main().catch(console.error);

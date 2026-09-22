const {
  spawn,
} = require(
  "child_process"
);

const path =
  require(
    "path"
  );

const ROOT =
  "/opt/kbo-analyzer";

const COLLECTOR =
  path.join(
    ROOT,
    "scripts",
    "betman-kbo-collector.cjs"
  );

const INTERVAL_MS =
  5 * 60 * 1000;

const COLLECT_TIMEOUT_MS =
  120 * 1000;

let running =
  false;

async function collect() {
  if (running) {
    console.log(
      "[BETMAN] 이전 수집이 아직 실행 중 - 건너뜀"
    );

    return;
  }

  running =
    true;

  console.log();
  console.log(
    `[BETMAN] 수집 시작 ${new Date().toISOString()}`
  );

  const child =
    spawn(
      process.execPath,
      [
        COLLECTOR,
      ],
      {
        cwd:
          ROOT,

        stdio:
          "inherit",

        detached:
          true,
      }
    );

  const timeout =
    setTimeout(
      () => {
        if (!running) return;

        console.error(
          "[BETMAN] 수집 제한시간 초과 - 프로세스 종료"
        );

        try {
          process.kill(
            -child.pid,
            "SIGTERM"
          );
        } catch {}

        setTimeout(
          () => {
            try {
              process.kill(
                -child.pid,
                "SIGKILL"
              );
            } catch {}
          },
          5000
        );
      },
      COLLECT_TIMEOUT_MS
    );

  child.on(
    "error",
    (error) => {
      console.error(
        "[BETMAN] 실행 오류",
        error
      );

      clearTimeout(
        timeout
      );

      running =
        false;
    }
  );

  child.on(
    "exit",
    (code) => {
      console.log(
        `[BETMAN] 수집 종료 code=${code}`
      );

      clearTimeout(
        timeout
      );

      running =
        false;
    }
  );
}

console.log(
  "===== BETMAN KBO AUTO COLLECTOR ====="
);

console.log(
  "INTERVAL: 5 minutes"
);

collect();

setInterval(
  collect,
  INTERVAL_MS
);

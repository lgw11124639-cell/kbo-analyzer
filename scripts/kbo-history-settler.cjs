const fs = require("node:fs/promises");
const once = process.argv.includes("--once");
async function run() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const token = (await fs.readFile("/opt/kbo-analyzer/data/.history-settle-token", "utf8")).trim();
    const response = await fetch("http://127.0.0.1:3200/api/predictions/live", { method: "PUT", headers: { Authorization: "Bearer " + token }, signal: controller.signal });
    const body = await response.json();
    console.log("[HISTORY_SETTLEMENT]", new Date().toISOString(), JSON.stringify(body));
    if (!response.ok || !body.ok) throw new Error("Settlement incomplete: HTTP " + response.status);
    /* KBO_PICK_LEARNING_SYNC_V1 */
    try {
      const { execFileSync } = require("node:child_process");
      const out = execFileSync(process.execPath, ["/opt/kbo-analyzer/scripts/kbo-pick-learning-sync.cjs"], { cwd: "/opt/kbo-analyzer", encoding: "utf8", timeout: 60000 });
      console.log("[KBO_PICK_LEARNING_SYNC]", out.trim().replace(/\n/g, " | "));
    } catch (syncError) {
      console.error("[KBO_PICK_LEARNING_SYNC_FAILED]", syncError.message);
    }
  } catch (error) {
    console.error("[HISTORY_SETTLEMENT_FAILED]", error.message);
    if (once) process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    if (!once) setTimeout(run, 300000);
  }
}
void run();

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
  } catch (error) {
    console.error("[HISTORY_SETTLEMENT_FAILED]", error.message);
    if (once) process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    if (!once) setTimeout(run, 300000);
  }
}
void run();

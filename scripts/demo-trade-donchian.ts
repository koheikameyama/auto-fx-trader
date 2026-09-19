import { pathToFileURL } from "url";
import { OandaClient } from "../src/broker/oanda-client.js";
import { runDemoCycle } from "../src/demo/donchian-runner.js";
import { isKillSwitchActive, getKillSwitchInfo } from "../src/demo/kill-switch.js";
import { sendSlack, formatKillSwitch, formatErrorAlert } from "../src/demo/slack-notifier.js";

const DRY_RUN = process.argv.includes("--dry-run");
const PRACTICE_BASE_URL = "https://api-fxpractice.oanda.com";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function main() {
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] Demo trading runner start (dry-run=${DRY_RUN})`);

  if (isKillSwitchActive()) {
    const info = getKillSwitchInfo();
    console.log(`⏸ Kill switch active: ${info.reason} (since ${info.createdAt?.toISOString()})`);
    await sendSlack({ text: formatKillSwitch(info.reason ?? "(no reason)"), level: "warn" });
    return;
  }

  const oanda = new OandaClient({
    apiToken: requireEnv("OANDA_API_TOKEN"),
    accountId: requireEnv("OANDA_ACCOUNT_ID"),
    baseUrl: process.env.OANDA_API_URL ?? PRACTICE_BASE_URL,
  });

  try {
    await runDemoCycle({ oanda, dryRun: DRY_RUN });
  } finally {
    const elapsed = Date.now() - startTime.getTime();
    console.log(`[${new Date().toISOString()}] Demo trading runner end (elapsed ${elapsed}ms)`);
  }
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectRun) {
  main()
    .then(() => {
      process.exitCode = 0;
    })
    .catch(async (e) => {
      console.error("❌ Demo trading runner failed:", e?.message ?? e);
      if (e?.stack) console.error(e.stack);
      try {
        await sendSlack({
          text: formatErrorAlert("UNCAUGHT_EXCEPTION", String(e?.message ?? e)),
          level: "critical",
        });
      } catch {
        // best-effort notification; do not mask the original failure
      }
      process.exitCode = 1;
    });
}

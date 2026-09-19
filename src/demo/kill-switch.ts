// Ported from auto-us-stock-trader/src/paper-trading/kill-switch.ts.
//
// NOTE: on GitHub Actions this only works if the stop file is committed to
// the repo — each run checks out a fresh tree, so an uncommitted local file
// has no effect there. Emergency stop on GHA is therefore: commit this file,
// or disable the workflow.
import * as fs from "fs";
import * as path from "path";

const KILL_SWITCH_FILE = path.resolve(".demo-trading-stop");

export function isKillSwitchActive(): boolean {
  return fs.existsSync(KILL_SWITCH_FILE);
}

export function getKillSwitchInfo(): { active: boolean; reason?: string; createdAt?: Date } {
  if (!fs.existsSync(KILL_SWITCH_FILE)) return { active: false };
  const stat = fs.statSync(KILL_SWITCH_FILE);
  const reason = fs.readFileSync(KILL_SWITCH_FILE, "utf-8").trim() || "(no reason)";
  return { active: true, reason, createdAt: stat.birthtime };
}

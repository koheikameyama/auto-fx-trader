import { maCrossoverStrategy } from "../src/core/ma-crossover/index.js";
import type { Strategy } from "../src/types/strategy.js";
import { runWfForAllPairs } from "./walk-forward-shared.js";

const paramGrid: Record<string, number[]> = {
  shortEma: [10, 20, 30],
  longEma: [50, 100, 200],
  atrPeriod: [14],
};

runWfForAllPairs({
  strategy: maCrossoverStrategy as unknown as Strategy<Record<string, number>>,
  paramGrid,
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

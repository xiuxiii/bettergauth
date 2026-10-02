import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { EvalCase } from "@/evals/runCase.mjs";

/**
 * The eval cases (evals/cases/*.json), sorted by file name like `npm run
 * eval`. Read from disk on each call: they ship with the two routes that need
 * them (next.config.mjs, outputFileTracingIncludes), resolved against
 * process.cwd() as on Vercel.
 */
export async function loadCases(): Promise<EvalCase[]> {
  const dir = path.join(process.cwd(), "evals", "cases");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(
    files.map(async (f) => JSON.parse(await readFile(path.join(dir, f), "utf8")) as EvalCase),
  );
}

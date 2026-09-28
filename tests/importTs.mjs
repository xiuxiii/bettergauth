/**
 * Import a TypeScript module from the app for a unit test, with no build step
 * and no new dependency: transpile it with the project's own `typescript`, and
 * inline its `@/…` imports the same way. Type-only imports disappear in the
 * transpile. Modules that touch React, Next or the network aren't meant for
 * this — keep the logic under test in pure files (lib/richText.ts, …).
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(path.join(ROOT, "package.json"))("typescript");

function toDataUrl(file) {
  let js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  js = js.replace(/from "@\/([^"]+)"/g, (_, spec) => {
    const target = path.join(ROOT, spec.endsWith(".ts") ? spec : `${spec}.ts`);
    return `from "${toDataUrl(target)}"`;
  });
  return `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
}

/** `await importTs("lib/richText.ts")` */
export function importTs(relPath) {
  return import(toDataUrl(path.join(ROOT, relPath)));
}

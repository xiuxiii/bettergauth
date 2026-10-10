#!/usr/bin/env node
/**
 * The browser tests: every e2e/*.e2e.mjs spec, against a production build.
 *
 *   npm run build && npm run e2e
 *   npm run e2e -- --only camera       one spec (file name without .e2e.mjs)
 *   npm run e2e -- --base http://localhost:3000   use a running server (all
 *                                       specs then share its environment)
 *
 * For each server profile the specs ask for (harness.mjs PROFILES), it starts
 * `next start` on a free port with that profile's environment, runs the specs,
 * then stops that server (by its own process, never `pkill -f`). Nothing
 * reaches a real AI: see harness.mjs. Screenshots go to e2e/out/.
 *
 * A profile with its own NEXT_DIST_DIR (accounts) is built here, into that
 * directory, whenever its build is missing or older than .next, so a fresh
 * `npm run build` always brings it along. A profile pointing at the fake
 * Supabase gets it started alongside (`t.supabase` in its specs).
 *
 * Playwright isn't a project dependency (it would weigh on every Vercel
 * build): it is loaded from the global npm root, as evals/make-images.mjs does.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FAKE_SUPABASE_URL, FakeSupabase } from "./fakeSupabase.mjs";
import { OUT, PROFILES, ROOT, launchBrowser, loadPlaywright, newPage, serverEnv } from "./harness.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const ONLY = flag("--only");
const BASE = flag("--base");

if (!BASE && !fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
  console.error("No production build. Run `npm run build` first.");
  process.exit(1);
}

const pw = await loadPlaywright();
if (!pw) {
  console.error("Playwright isn't installed. Run `npm i -g playwright` (or use a machine where it is), then retry.");
  process.exit(1);
}

const files = fs
  .readdirSync(path.join(ROOT, "e2e"))
  .filter((f) => f.endsWith(".e2e.mjs"))
  .filter((f) => !ONLY || f === `${ONLY}.e2e.mjs`)
  .sort();
if (!files.length) {
  console.error(ONLY ? `No spec e2e/${ONLY}.e2e.mjs.` : "No specs in e2e/.");
  process.exit(1);
}

const specs = [];
for (const f of files) {
  const mod = await import(pathToFileURL(path.join(ROOT, "e2e", f)).href);
  const profile = mod.profile ?? "default";
  if (!PROFILES[profile]) throw new Error(`${f}: unknown profile "${profile}"`);
  specs.push({ name: f.replace(/\.e2e\.mjs$/, ""), profile, run: mod.default });
}

fs.mkdirSync(OUT, { recursive: true });

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

const mtime = (f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0);

/** A profile's own build (NEXT_DIST_DIR), remade when older than .next. */
function ensureBuild(profile) {
  const dir = PROFILES[profile].NEXT_DIST_DIR;
  if (!dir || BASE) return;
  const id = path.join(ROOT, dir, "BUILD_ID");
  if (mtime(id) >= mtime(path.join(ROOT, ".next", "BUILD_ID"))) return;
  console.log(`\nBuilding the ${profile} profile into ${dir} (its env is baked in at build time)…`);
  const r = spawnSync(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "build"], {
    cwd: ROOT,
    env: serverEnv(profile),
    encoding: "utf8",
  });
  fs.writeFileSync(path.join(OUT, `build-${profile}.log`), `${r.stdout ?? ""}${r.stderr ?? ""}`);
  if (r.status !== 0) throw new Error(`next build failed (${profile}); see e2e/out/build-${profile}.log`);
}

async function startServer(profile) {
  const port = await freePort();
  const log = fs.createWriteStream(path.join(OUT, `server-${profile}.log`));
  const child = spawn(
    process.execPath,
    [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)],
    { cwd: ROOT, env: serverEnv(profile), stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`next start exited (${profile}); see e2e/out/server-${profile}.log`);
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return { base, stop: () => child.kill("SIGTERM") };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill("SIGTERM");
  throw new Error(`next start didn't answer on ${base} (${profile})`);
}

const browser = await launchBrowser(pw.chromium);
let pass = 0;
let fail = 0;
const failures = [];

for (const profile of [...new Set(specs.map((s) => s.profile))]) {
  ensureBuild(profile);
  const supabase = PROFILES[profile].NEXT_PUBLIC_SUPABASE_URL === FAKE_SUPABASE_URL ? await new FakeSupabase().start() : null;
  const server = BASE ? { base: BASE.replace(/\/$/, ""), stop() {} } : await startServer(profile);
  try {
    for (const spec of specs.filter((s) => s.profile === profile)) {
      console.log(`\n${spec.name}  (${profile})`);
      const open = [];
      const t = {
        base: server.base,
        out: OUT,
        /** The fake Supabase (fakeSupabase.mjs), for the accounts profile. */
        supabase,
        /** A fresh phone-sized page; closed when its test ends. */
        async page(opts) {
          const pg = await newPage(browser, server.base, opts);
          open.push(pg);
          return pg;
        },
        ok(label, cond, got) {
          if (cond) {
            pass++;
            console.log("  ✓", label);
          } else {
            fail++;
            failures.push(`${spec.name}: ${label}`);
            console.log("  ✗", label, got === undefined ? "" : `-> ${JSON.stringify(got)}`);
          }
        },
        /** One named check group; a throw inside counts as a failure, not a crash. */
        async test(name, fn) {
          try {
            await fn();
          } catch (err) {
            fail++;
            failures.push(`${spec.name}: ${name}`);
            console.log("  ✗", name, "threw:", String(err?.message ?? err).split("\n")[0]);
          } finally {
            for (const pg of open.splice(0)) {
              if (pg.st.pageErrors.length) console.log("    page errors:", pg.st.pageErrors.join(" | "));
              if (pg.st.unmocked.length) console.log("    unmocked AI calls:", [...new Set(pg.st.unmocked)].join(", "));
              await pg.c.close().catch(() => {});
            }
          }
        },
        shot(p, name) {
          return p.screenshot({ path: path.join(OUT, `${spec.name}-${name}.png`) });
        },
      };
      await spec.run(t);
    }
  } finally {
    server.stop();
    await supabase?.stop();
  }
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
process.exit(fail ? 1 : 0);

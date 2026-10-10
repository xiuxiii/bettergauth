/**
 * The access gate (middleware.ts, app/unlock), the open /privacy page, the
 * public /api/health, and the owner page (/owner?code=<DEBUG_CODE>). Wrong
 * codes count as guesses (10 per 15 min per IP), so this spec makes only a
 * handful; the server is fresh each run.
 */
export const profile = "gate";

const ACCESS = "e2e-access";
const DEBUG = "e2e-debug";

const pathOf = (p) => new URL(p.url()).pathname;
const sameOrigin = (p, base) => new URL(p.url()).origin === new URL(base).origin;

/** Unlock through the page itself, as a student would. */
async function unlock(p, base) {
  await p.goto(base + "/unlock");
  await p.getByPlaceholder("Access code").fill(ACCESS);
  await p.getByRole("button", { name: "Unlock" }).click();
  await p.waitForURL((u) => u.pathname === "/", { timeout: 10000 });
}

export default async function gateSpec(t) {
  await t.test("A fresh visitor is sent to /unlock and lets themselves in", async () => {
    const { p, st } = await t.page();
    await p.goto(t.base + "/");
    t.ok("/ redirects to /unlock", pathOf(p) === "/unlock", p.url());
    await p.getByRole("heading", { name: "Enter access code" }).waitFor();
    t.ok("the code field has focus", await p.getByPlaceholder("Access code").evaluate((el) => el === document.activeElement));
    await t.shot(p, "unlock");

    const apiLocked = await p.request.get(t.base + "/api/providers");
    t.ok("API routes answer 401 while locked", apiLocked.status() === 401, apiLocked.status());

    await p.getByPlaceholder("Access code").fill("not-the-code");
    await p.getByRole("button", { name: "Unlock" }).click();
    const err = p.getByText("Incorrect code.");
    await err.waitFor({ timeout: 5000 }).catch(() => {});
    t.ok("a wrong code shows an error", await err.isVisible());
    t.ok("and stays on /unlock", pathOf(p) === "/unlock", p.url());
    t.ok("the field is marked invalid",
      (await p.getByPlaceholder("Access code").getAttribute("aria-invalid")) === "true");
    await t.shot(p, "unlock-wrong");

    await p.getByPlaceholder("Access code").fill(ACCESS);
    await p.getByRole("button", { name: "Unlock" }).click();
    await p.waitForURL((u) => u.pathname === "/", { timeout: 10000 }).catch(() => {});
    t.ok("the right code lets them in", pathOf(p) === "/", p.url());
    await p.getByRole("button", { name: "Snap a problem" }).waitFor({ timeout: 10000 }).catch(() => {});
    t.ok("home is shown", await p.getByRole("button", { name: "Snap a problem" }).isVisible());
    const cookies = await p.context().cookies();
    const gate = cookies.find((c) => c.httpOnly && c.value);
    t.ok("an httpOnly cookie is set, and it doesn't contain the code",
      !!gate && !gate.value.includes(ACCESS), cookies.map((c) => c.name));
    await p.goto(t.base + "/settings");
    t.ok("other pages open now", pathOf(p) === "/settings", p.url());
    t.ok("no page errors", st.pageErrors.length === 0, st.pageErrors);
  });

  await t.test("/privacy is open before unlocking, and its Back stays on-site", async () => {
    const { p } = await t.page();
    await p.goto(t.base + "/privacy");
    t.ok("/privacy isn't redirected", pathOf(p) === "/privacy", p.url());
    t.ok("its heading is shown", await p.getByRole("heading", { name: "Privacy", level: 1 }).isVisible());
    t.ok("it names who receives the photos",
      await p.getByText(/Anthropic/).first().isVisible() && await p.getByText(/DeepSeek/).first().isVisible());

    for (const [query, label] of [
      ["?back=/%5Cevil.example", "backslash host"],
      ["?back=/%09/evil.example", "tab host"],
      ["?back=//evil.example", "protocol-relative"],
    ]) {
      await p.goto(t.base + "/privacy" + query);
      const back = p.getByRole("link", { name: "Back" });
      const href = await back.evaluate((a) => a.href);
      t.ok(`${label}: Back links to / on this origin`, href === t.base + "/", href);
      await back.click();
      await p.waitForURL((u) => u.pathname !== "/privacy", { timeout: 10000 }).catch(() => {});
      t.ok(`${label}: following it stays on this origin (and the gate catches it)`,
        sameOrigin(p, t.base) && pathOf(p) === "/unlock", p.url());
    }

    await p.goto(t.base + "/unlock");
    await p.getByRole("link", { name: "How MindGap handles your data" }).click();
    await p.waitForURL((u) => u.pathname === "/privacy", { timeout: 10000 }).catch(() => {});
    t.ok("the unlock page links to /privacy", pathOf(p) === "/privacy", p.url());
    await p.getByRole("link", { name: "Back" }).click();
    await p.waitForURL((u) => u.pathname === "/unlock", { timeout: 10000 }).catch(() => {});
    t.ok("and its Back returns to /unlock", pathOf(p) === "/unlock", p.url());
  });

  await t.test("/api/health is up/down in public, details only with the debug code", async () => {
    const { p } = await t.page();
    const get = async (q) => {
      const res = await p.request.get(t.base + "/api/health" + q);
      return { status: res.status(), json: await res.json().catch(() => null) };
    };
    const pub = await get("");
    t.ok("public: 200 with only { ok: true }",
      pub.status === 200 && JSON.stringify(pub.json) === '{"ok":true}', pub);
    const dbg = await get(`?code=${DEBUG}`);
    t.ok("with the code: provider details",
      dbg.status === 200 && dbg.json?.ok === true && dbg.json?.provider === "deepseek" &&
        !!dbg.json?.providers?.anthropic && typeof dbg.json?.rateLimitStore === "string", dbg);
    t.ok("with the code: never a key", !JSON.stringify(dbg.json).includes('"e2e"'), dbg.json);
    const wrong = await get("?code=wrong-code");
    t.ok("a wrong code: only { ok: true }",
      wrong.status === 200 && JSON.stringify(wrong.json) === '{"ok":true}', wrong);
  });

  await t.test("The owner page: status and five runs with the code, Not found without", async () => {
    const { p } = await t.page();
    const evalCalls = [];
    p.on("request", (r) => {
      if (r.url().includes("/api/owner/eval")) evalCalls.push(r.url());
    });

    await p.goto(t.base + `/owner?code=${DEBUG}`);
    t.ok("locked: even with the code, /owner goes to /unlock first", pathOf(p) === "/unlock", p.url());

    await unlock(p, t.base);
    await p.goto(t.base + `/owner?code=${DEBUG}`);
    const status = p.getByRole("region", { name: "Status" });
    await status.waitFor({ timeout: 15000 });
    t.ok("the Status section is shown", await status.isVisible());
    t.ok("the page is titled Owner", await p.getByRole("heading", { name: "Owner", level: 1 }).isVisible());
    const runs = p.getByRole("button", { name: /^Run / });
    await runs.first().waitFor();
    const labels = await runs.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    t.ok("five Run buttons", labels.length === 5, labels);
    t.ok("three box-placement runs and two checking-work runs",
      labels.filter((l) => /Box placement/.test(l)).length === 3 &&
        labels.filter((l) => /Checking work/.test(l)).length === 2, labels);
    await p.getByRole("region", { name: /Usage/ }).waitFor({ timeout: 10000 }).catch(() => {});
    t.ok("the usage section is shown", await p.getByRole("region", { name: /Usage/ }).isVisible());
    await t.shot(p, "owner");
    t.ok("nothing ran (no eval requests)", evalCalls.length === 0, evalCalls);

    for (const [q, label] of [["", "no code"], ["?code=wrong-code", "a wrong code"]]) {
      await p.goto(t.base + "/owner" + q);
      const nf = p.getByText("Page not found");
      await nf.waitFor({ timeout: 10000 }).catch(() => {});
      t.ok(`${label}: "Page not found"`, await nf.isVisible());
      t.ok(`${label}: no status, no Run buttons`,
        (await p.getByRole("region", { name: "Status" }).count()) === 0 &&
          (await p.getByRole("button", { name: /^Run / }).count()) === 0);
    }
    // From the page: the gate cookie is Secure, which the API client won't send over http.
    const api = await p.evaluate(async () => (await fetch("/api/owner/status?code=wrong-code")).status);
    t.ok("the owner API answers 404 to a wrong code", api === 404, api);
    t.ok("still nothing ran", evalCalls.length === 0, evalCalls);
  });
}

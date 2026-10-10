/**
 * The Tutor switch (TUTOR_SWITCH=on): Settings shows DeepSeek / Claude, a pick
 * is saved under its own key (lib/aiChoice.ts, never in the preferences that
 * reach the prompt), and the next AI request carries it as x-ai-provider.
 */
import { record, seed } from "./harness.mjs";

export const profile = "switch";

const checked = (p, name) => p.getByRole("radio", { name, exact: true }).getAttribute("aria-checked");

/** Answer /api/progress, keeping each request's x-ai-provider header. */
async function mockProgress(p, base) {
  const seen = [];
  await p.route(`${base}/api/progress`, (r) => {
    seen.push(r.request().headers()["x-ai-provider"] ?? null);
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: "SUMMARY ok" }) });
  });
  return seen;
}

/** History's "Explain my pattern" is one AI request (/api/progress). */
async function explain(p, base) {
  await p.goto(base + "/history");
  await p.getByRole("button", { name: "Explain my pattern" }).click();
  await p.getByText("SUMMARY ok").waitFor({ timeout: 10000 });
}

export default async function settingsSwitchSpec(t) {
  await t.test("Tutor row: DeepSeek / Claude, and a pick rides on the next request", async () => {
    const { p, st } = await t.page();
    const seen = await mockProgress(p, t.base);
    await p.goto(t.base + "/");
    // A canonical gap label, so History ranks it and offers "Explain my pattern".
    await seed(p, [
      record("s1", {
        memory: { demonstrated: [], misconceptions: [], errors: [{ type: "conceptual", concept: "Conservation of energy" }], bottleneck: "" },
      }),
    ]);

    await explain(p, t.base);
    t.ok("before any pick: no x-ai-provider header", seen.length === 1 && seen[0] === null, seen);

    await p.goto(t.base + "/settings");
    const tutor = p.getByRole("radiogroup", { name: "Tutor" });
    await tutor.waitFor({ timeout: 10000 });
    t.ok("the Tutor row is shown", await tutor.isVisible());
    const opts = await tutor.getByRole("radio").allInnerTexts();
    t.ok("it offers DeepSeek and Claude", JSON.stringify(opts.map((s) => s.trim())) === '["DeepSeek","Claude"]', opts);
    t.ok("DeepSeek (the default) is selected", (await checked(p, "DeepSeek")) === "true");

    await p.getByRole("radio", { name: "Claude", exact: true }).click();
    await p.getByRole("status").getByText("Saved", { exact: true }).waitFor({ timeout: 3000 }).catch(() => {});
    t.ok("choosing Claude shows Saved", await p.getByRole("status").getByText("Saved", { exact: true }).isVisible());
    t.ok("Claude is selected", (await checked(p, "Claude")) === "true");
    t.ok("saved under mindgap:ai",
      (await p.evaluate(() => localStorage.getItem("mindgap:ai"))) === "anthropic");
    t.ok("never in the preferences sent to the tutor",
      !/anthropic|claude|deepseek/i.test(await p.evaluate(() => localStorage.getItem("mindgap:preferences") ?? "")));

    await p.reload();
    await tutor.waitFor({ timeout: 10000 });
    await p.waitForFunction(() =>
      [...document.querySelectorAll('[role="radio"][aria-checked="true"]')].some((e) => e.textContent?.includes("Claude")),
      null, { timeout: 5000 },
    ).catch(() => {});
    t.ok("after reload: Claude is still selected", (await checked(p, "Claude")) === "true");

    await explain(p, t.base);
    t.ok("the next AI request carries x-ai-provider: anthropic", seen.length === 2 && seen[1] === "anthropic", seen);
    t.ok("no unmocked AI calls", st.unmocked.length === 0, st.unmocked);
  });
}

/**
 * Settings (components/SettingsView.tsx): every change saves the moment it's
 * made, the theme is painted before the first frame, the Focus/Grade
 * ChoiceSheet traps focus on a phone and is a toggling popover on a desktop,
 * Back never leaves the site, there is no Tutor row without TUTOR_SWITCH, and
 * Clear history is held for UNDO_MS with an Undo.
 */
import { allSessions, record, seed } from "./harness.mjs";

export const profile = "default";

/** components/ui/useUndoable.ts */
const UNDO_MS = 5000;

const prefsOf = (p) =>
  p.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("mindgap:preferences") ?? "null");
    } catch {
      return null;
    }
  });
const checked = (p, name) => p.getByRole("radio", { name, exact: true }).getAttribute("aria-checked");
const toast = (p) => p.getByRole("status").filter({ hasText: /\S/ });
const focusRow = (p) => p.getByRole("button", { name: /^Focus/ });
const gradeRow = (p) => p.getByRole("button", { name: /^Grade/ });

/** Wait for the "Saved" toast, true if it showed. */
async function sawSaved(p) {
  return p
    .getByRole("status")
    .getByText("Saved", { exact: true })
    .waitFor({ timeout: 3000 })
    .then(() => true, () => false);
}

/** Open /settings with hydration done (the rows answer clicks). */
async function openSettings(p, base, query = "") {
  await p.goto(base + "/settings" + query);
  await p.getByRole("heading", { name: "Settings" }).waitFor();
  await p.getByRole("radio", { name: "Hints first" }).waitFor();
  await p.waitForLoadState("networkidle");
}

export default async function settingsSpec(t) {
  await t.test("Each change saves the moment it's made, and survives a reload", async () => {
    // prefs: false: starts from no saved preferences, as a first visit does.
    const { p } = await t.page({ prefs: false });
    await openSettings(p, t.base);
    t.ok("no submit button on the page", (await p.getByRole("button", { name: /^(Save|Submit|Done)$/ }).count()) === 0);

    await p.getByRole("radio", { name: "Direct", exact: true }).click();
    t.ok("help style: Saved toast", await sawSaved(p));
    t.ok("help style: stored at once", (await prefsOf(p))?.assistanceStyle === "direct", await prefsOf(p));

    await focusRow(p).click();
    await p.getByRole("option", { name: /^Exam prep/ }).click();
    await p.getByRole("dialog").waitFor({ state: "detached" });
    t.ok("focus: Saved toast", await sawSaved(p));
    t.ok("focus: stored at once", (await prefsOf(p))?.goal === "exam", await prefsOf(p));
    t.ok("focus: the row shows the new value", /Exam prep/.test(await focusRow(p).innerText()));

    await gradeRow(p).click();
    await p.getByRole("option", { name: "Grade 11" }).click();
    await p.getByRole("dialog").waitFor({ state: "detached" });
    t.ok("grade: Saved toast", await sawSaved(p));
    t.ok("grade: stored at once", (await prefsOf(p))?.grade === "11", await prefsOf(p));

    await p.getByRole("radio", { name: "IB", exact: true }).click();
    t.ok("curriculum: Saved toast", await sawSaved(p));
    t.ok("curriculum: stored at once", (await prefsOf(p))?.curriculum === "ib", await prefsOf(p));

    await p.reload();
    await p.getByRole("heading", { name: "Settings" }).waitFor();
    await p.waitForFunction(() =>
      document.querySelector('[role="radio"][aria-checked="true"]')?.textContent?.includes("Direct"),
    ).catch(() => {});
    t.ok("after reload: Direct is selected", (await checked(p, "Direct")) === "true");
    t.ok("after reload: IB is selected", (await checked(p, "IB")) === "true");
    t.ok("after reload: Focus reads Exam prep", /Exam prep/.test(await focusRow(p).innerText()));
    t.ok("after reload: Grade reads Grade 11", /Grade 11/.test(await gradeRow(p).innerText()));
    t.ok("after reload: storage still holds every change",
      JSON.stringify(await prefsOf(p)) ===
        JSON.stringify({ grade: "11", assistanceStyle: "direct", goal: "exam", curriculum: "ib" }),
      await prefsOf(p));
  });

  await t.test("Theme: Dark applies at once and is stored", async () => {
    const { p } = await t.page();
    await openSettings(p, t.base);
    const theme = () => p.evaluate(() => document.documentElement.dataset.theme);
    t.ok("starts light", (await theme()) === "light", await theme());
    await p.getByRole("radio", { name: "Dark", exact: true }).click();
    t.ok("Dark sets data-theme=dark on <html>", (await theme()) === "dark", await theme());
    t.ok("Dark: Saved toast", await sawSaved(p));
    t.ok("Dark is stored under mindgap:theme",
      (await p.evaluate(() => localStorage.getItem("mindgap:theme"))) === "dark");
    await p.getByRole("radio", { name: "Light", exact: true }).click();
    t.ok("Light switches it back", (await theme()) === "light", await theme());
  });

  await t.test("Theme: a stored Dark is painted before the first frame", async () => {
    // The harness stores the theme on every load, so "after a reload with Dark
    // chosen" is a page whose storage says dark, as the test above leaves it.
    const { c, p } = await t.page({ theme: "dark" });
    await c.addInitScript(() => {
      const seen = [];
      window.__themeSeen = seen;
      const note = (when) => seen.push([when, document.documentElement?.getAttribute("data-theme") ?? null]);
      const mo = new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === "attributes") note("attr");
          for (const n of r.addedNodes ?? []) if (n.nodeName === "BODY") note("body");
        }
      });
      mo.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-theme"] });
      document.addEventListener("DOMContentLoaded", () => note("dcl"));
    });
    await openSettings(p, t.base);
    const seen = await p.evaluate(() => window.__themeSeen);
    const atBody = seen.find(([w]) => w === "body");
    t.ok("data-theme is already dark when <body> starts", atBody?.[1] === "dark", seen);
    t.ok("never painted light on the way", seen.every(([, v]) => v !== "light"), seen);
    t.ok("Settings shows Dark selected", (await checked(p, "Dark")) === "true");

    // Without any bundled JS at all: only the inline <head> script can do it.
    const bare = await c.newPage();
    await bare.route("**/_next/static/**/*.js", (r) => r.abort());
    await bare.goto(t.base + "/settings");
    const noJs = await bare.evaluate(() => document.documentElement.dataset.theme);
    t.ok("dark even with every bundle blocked (inline head script)", noJs === "dark", noJs);
  });

  await t.test("ChoiceSheet on a phone traps focus; Escape returns it to the row", async () => {
    const { p } = await t.page();
    await openSettings(p, t.base);
    await focusRow(p).focus();
    await p.keyboard.press("Enter");
    const sheet = p.getByRole("dialog", { name: "Focus" });
    await sheet.waitFor();
    t.ok("it is a modal sheet", (await sheet.getAttribute("aria-modal")) === "true");
    const inSheet = () =>
      p.evaluate(() => !!document.activeElement?.closest('[role="dialog"][aria-modal="true"]'));
    t.ok("focus starts on the selected option",
      await p.evaluate(() => document.activeElement?.getAttribute("aria-selected") === "true"));
    let stayed = true;
    for (let i = 0; i < 8; i++) {
      await p.keyboard.press(i % 3 === 2 ? "Shift+Tab" : "Tab");
      if (!(await inSheet())) stayed = false;
    }
    t.ok("Tab and Shift+Tab never leave the sheet", stayed);
    await p.keyboard.press("ArrowDown");
    await p.keyboard.press("Tab");
    t.ok("Tab from an arrowed-to option stays in the sheet", await inSheet());

    await p.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached" });
    const back = await p.evaluate(() => document.activeElement?.textContent ?? "");
    t.ok("Escape closes it and focus is back on the Focus row", /^Focus/.test(back.trim()), back);
    t.ok("Escape picked nothing", (await prefsOf(p))?.goal === "both", await prefsOf(p));
  });

  await t.test("Desktop popover: the row opens it, and clicking it again closes it", async () => {
    const { p } = await t.page({ width: 1280, height: 900 });
    await openSettings(p, t.base);
    const pop = p.getByRole("dialog", { name: "Focus" });
    await focusRow(p).click();
    await pop.waitFor();
    t.ok("a popover, not a modal sheet", (await pop.getAttribute("aria-modal")) === null);
    t.ok("row says expanded", (await focusRow(p).getAttribute("aria-expanded")) === "true");

    await focusRow(p).click();
    await pop.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    t.ok("second click closes it", (await pop.count()) === 0);
    await p.waitForTimeout(400); // a reopen would come from the same click's events
    t.ok("and it doesn't reopen", (await pop.count()) === 0 && (await focusRow(p).getAttribute("aria-expanded")) === "false");

    await focusRow(p).click();
    await pop.waitFor();
    await p.getByRole("heading", { name: "Settings" }).click();
    await pop.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    t.ok("a click elsewhere closes it too", (await pop.count()) === 0);
  });

  for (const [query, want, label] of [
    ["?back=/%5Cevil.example", "/", "backslash host"],
    ["?back=/%09/evil.example", "/", "tab host"],
    ["?back=/history", "/history", "a real path"],
  ]) {
    await t.test(`Back stays on-site (${label})`, async () => {
      const { p } = await t.page();
      await openSettings(p, t.base, query);
      await p.getByRole("button", { name: "Back" }).click();
      await p.waitForURL((u) => !u.pathname.startsWith("/settings"), { timeout: 10000 }).catch(() => {});
      const u = new URL(p.url());
      t.ok(`${label}: Back goes to ${want} on this origin`,
        u.origin === new URL(t.base).origin && u.pathname === want, p.url());
    });
  }

  await t.test("No Tutor row without the switch", async () => {
    const { p } = await t.page();
    const providers = p.waitForResponse((r) => r.url().endsWith("/api/providers"));
    await openSettings(p, t.base);
    const status = await (await providers).json();
    t.ok("the server says not switchable", status.switchable === false, status);
    t.ok("no Tutor row", (await p.getByText("Tutor", { exact: true }).count()) === 0);
    t.ok("no DeepSeek / Claude choice",
      (await p.getByRole("radio", { name: /DeepSeek|Claude/ }).count()) === 0);
  });

  await t.test("Clear history waits with an Undo", async () => {
    const { p } = await t.page();
    await p.goto(t.base + "/");
    await seed(p, [record("c1"), record("c2", { createdAt: Date.now() - 1000 })]);
    await openSettings(p, t.base);

    await p.getByRole("button", { name: "Clear history" }).click();
    t.ok("asks first, naming the count", await p.getByText("Delete all 2 saved problems").isVisible());
    await p.getByRole("button", { name: "Delete everything" }).click();
    await toast(p).getByText("History cleared").waitFor();
    t.ok("toast offers Undo", await toast(p).getByRole("button", { name: "Undo" }).isVisible());
    t.ok("nothing deleted yet", (await allSessions(p)).length === 2);
    await toast(p).getByRole("button", { name: "Undo" }).click();
    t.ok("Undo clears the toast", (await toast(p).getByText("History cleared").count()) === 0);
    t.ok("Clear history is offered again", await p.getByRole("button", { name: "Clear history" }).isVisible());
    await p.waitForTimeout(UNDO_MS + 500); // past the window: an Undo must cancel, not postpone
    t.ok("after Undo, past the window: both records still there", (await allSessions(p)).length === 2);

    await p.getByRole("button", { name: "Clear history" }).click();
    await p.getByRole("button", { name: "Delete everything" }).click();
    const start = Date.now();
    await toast(p).getByText("History cleared").waitFor();
    let left = 2;
    while (left && Date.now() - start < UNDO_MS + 4000) {
      await p.waitForTimeout(250);
      left = (await allSessions(p)).length;
    }
    const took = Date.now() - start;
    t.ok("left alone, the records are deleted", left === 0, left);
    t.ok("but only after the undo window", took >= UNDO_MS - 500, took);
    t.ok("Clear history is gone (nothing to clear)",
      (await p.getByRole("button", { name: "Clear history" }).count()) === 0);
  });
}

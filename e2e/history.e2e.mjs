/**
 * History (components/HistoryView.tsx): newest first, a record opens its
 * session, deletes are held with an Undo and rapid deletes all happen (the
 * race fixed in lib/undoHolder.ts), and blocked IndexedDB degrades to "no
 * history" instead of throwing.
 */
import { allSessions, analysis, record, seed } from "./harness.mjs";

export const profile = "default";

/** components/ui/useUndoable.ts */
const UNDO_MS = 5000;

const rec = (id, ago, text, subject) =>
  record(id, {
    createdAt: Date.now() - ago,
    updatedAt: Date.now() - ago,
    analysis: analysis({ problemText: text, subject, topic: `${subject} topic` }),
  });

const ids = async (p) => (await allSessions(p)).map((r) => r.id).sort();
const rows = (p) => p.getByRole("main").getByRole("listitem");
const toast = (p) => p.getByRole("status");

/** Poll storage until `done(ids)` or the time runs out; the last ids seen. */
async function pollIds(p, done, ms) {
  const end = Date.now() + ms;
  let got = await ids(p);
  while (!done(got) && Date.now() < end) {
    await p.waitForTimeout(250);
    got = await ids(p);
  }
  return got;
}

export default async function historySpec(t) {
  await t.test("Records list newest first and open their session", async () => {
    const { p, st } = await t.page();
    await p.goto(t.base + "/");
    await seed(p, [
      rec("old", 3 * 86400e3, "OLDEST a block slides down a ramp", "Physics"),
      rec("new", 60e3, "NEWEST balance Fe + O2", "Chemistry"),
      rec("mid", 86400e3, "MIDDLE how far does the cart roll", "Mathematics"),
    ]);
    await p.goto(t.base + "/history");
    await p.getByRole("heading", { name: "History" }).waitFor();
    await p.getByText("NEWEST").waitFor();
    const texts = await rows(p).allInnerTexts();
    const order = texts.map((x) => (x.match(/NEWEST|MIDDLE|OLDEST/) ?? ["?"])[0]);
    t.ok("three rows, newest first", JSON.stringify(order) === '["NEWEST","MIDDLE","OLDEST"]', order);
    t.ok("each row shows its problem and subject",
      /balance Fe \+ O2/.test(texts[0]) && /Chemistry/.test(texts[0]) &&
        /Mathematics/.test(texts[1]) && /Physics/.test(texts[2]), texts);

    await p.getByRole("link", { name: /MIDDLE/ }).click();
    await p.waitForURL(/\/workspace\?session=mid$/, { timeout: 10000 }).catch(() => {});
    const u = new URL(p.url());
    t.ok("opening one goes to /workspace?session=<id>",
      u.pathname === "/workspace" && u.searchParams.get("session") === "mid", p.url());
    // The workspace keeps more than one copy of the card in the DOM (one per
    // layout), so look for a visible one.
    const shown = await p
      .waitForFunction(
        () =>
          [...document.querySelectorAll("body *")].some(
            (e) => e.children.length === 0 && /MIDDLE how far does the cart roll/.test(e.textContent ?? "") && e.checkVisibility(),
          ),
        null,
        { timeout: 10000 },
      )
      .then(() => true, () => false);
    t.ok("the workspace shows that problem", shown);
    t.ok("no page errors", st.pageErrors.length === 0, st.pageErrors);
  });

  await t.test("Delete waits with an Undo", async () => {
    const { p } = await t.page();
    await p.goto(t.base + "/");
    await seed(p, [rec("a", 1000, "ALPHA problem", "Physics"), rec("b", 2000, "BRAVO problem", "Physics")]);
    await p.goto(t.base + "/history");
    await p.getByText("ALPHA").waitFor();
    await p.waitForLoadState("networkidle");

    await rows(p).filter({ hasText: "ALPHA" }).getByRole("button", { name: "Delete this problem" }).click();
    await toast(p).getByText("Problem deleted").waitFor();
    t.ok("the row disappears at once", (await p.getByText("ALPHA").count()) === 0);
    t.ok("but it isn't deleted yet", JSON.stringify(await ids(p)) === '["a","b"]', await ids(p));
    await toast(p).getByRole("button", { name: "Undo" }).click();
    await p.getByText("ALPHA").waitFor({ timeout: 3000 }).catch(() => {});
    t.ok("Undo brings the row back", await p.getByText("ALPHA").isVisible());
    await p.waitForTimeout(UNDO_MS + 500); // an Undo must cancel, not postpone
    t.ok("past the window, the record is still stored", JSON.stringify(await ids(p)) === '["a","b"]', await ids(p));
    t.ok("and still listed", await p.getByText("ALPHA").isVisible());
  });

  await t.test("Quick deletes in a row all happen", async () => {
    const { p } = await t.page();
    await p.goto(t.base + "/");
    await seed(p, [
      rec("x", 1000, "XRAY problem", "Physics"),
      rec("y", 2000, "YANKEE problem", "Physics"),
      rec("keep", 4000, "KEEP problem", "Physics"),
    ]);
    await p.goto(t.base + "/history");
    await p.getByText("YANKEE").waitFor();
    await p.waitForLoadState("networkidle");

    // The second tap commits the first at once and holds itself for the window.
    await rows(p).filter({ hasText: "XRAY" }).getByRole("button", { name: "Delete this problem" }).click();
    await rows(p).filter({ hasText: "YANKEE" }).getByRole("button", { name: "Delete this problem" }).click();
    const start = Date.now();
    const early = await pollIds(p, (g) => !g.includes("x"), 2000);
    t.ok("the second delete commits the first straight away", JSON.stringify(early) === '["keep","y"]', early);
    const got = await pollIds(p, (g) => JSON.stringify(g) === '["keep"]', UNDO_MS + 3000);
    t.ok("after the undo window every deleted record is gone, the other kept",
      JSON.stringify(got) === '["keep"]', got);
    t.ok("the last one waited for the window", Date.now() - start >= UNDO_MS - 1000, Date.now() - start);
    t.ok("only the kept row is listed",
      JSON.stringify((await rows(p).allInnerTexts()).map((x) => /KEEP/.test(x))) === "[true]",
      await rows(p).allInnerTexts());
  });

  await t.test("Three deletes in one burst all happen", async () => {
    const { p } = await t.page();
    await p.goto(t.base + "/");
    await seed(p, [
      rec("r1", 1000, "ONE problem", "Physics"),
      rec("r2", 2000, "TWO problem", "Physics"),
      rec("r3", 3000, "THREE problem", "Physics"),
    ]);
    await p.goto(t.base + "/history");
    await p.getByText("THREE").waitFor();
    await p.waitForLoadState("networkidle");
    await p.evaluate(() => {
      for (const b of [...document.querySelectorAll('main li button[aria-label="Delete this problem"]')]) b.click();
    });
    const got = await pollIds(p, (g) => g.length === 0, UNDO_MS + 3000);
    t.ok("all three are deleted once the window has passed", got.length === 0, got);
    await p.getByText("Nothing saved yet").waitFor({ timeout: 3000 }).catch(() => {});
    t.ok("the page shows the empty state", await p.getByText("Nothing saved yet").isVisible());
  });

  for (const [label, block] of [
    ["indexedDB.open throws", () => {
      IDBFactory.prototype.open = function () {
        throw new DOMException("e2e: blocked", "SecurityError");
      };
    }],
    ["indexedDB itself throws", () => {
      Object.defineProperty(window, "indexedDB", {
        configurable: true,
        get() {
          throw new DOMException("e2e: blocked", "SecurityError");
        },
      });
    }],
  ]) {
    await t.test(`Blocked storage is "no history" (${label})`, async () => {
      const { c, p, st } = await t.page();
      await c.addInitScript(block);
      await p.goto(t.base + "/history");
      await p.getByText("Nothing saved yet").waitFor({ timeout: 10000 }).catch(() => {});
      t.ok(`${label}: the empty state shows`, await p.getByText("Nothing saved yet").isVisible());
      t.ok(`${label}: it offers to scan a problem`, await p.getByRole("link", { name: "Scan a problem" }).isVisible());
      t.ok(`${label}: no page errors`, st.pageErrors.length === 0, st.pageErrors);
    });
  }
}

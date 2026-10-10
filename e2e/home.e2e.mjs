/**
 * Home: a typed problem, and a chosen photo through the question cropper to
 * the workspace. The cropper's failure path (a hand-off that can't be stored),
 * its not-a-question gate (fails open), Ask mode, and its box: reachable on a
 * full-width question, drawn by dragging across the photo, picked by a tap.
 *
 * Snap a problem → in-app camera → cropper is camera.e2e.mjs's job.
 */
import { PHOTO, analysis, mock, turnFrames } from "./harness.mjs";

export const profile = "default";

/** Wait until `fn()` is truthy, polling; false if it never is. */
async function until(p, fn, ms = 8000) {
  for (let waited = 0; waited < ms; waited += 100) {
    if (await fn()) return true;
    await p.waitForTimeout(100);
  }
  return !!(await fn());
}

/** Text a person can see (innerText skips display:none copies). */
const onScreen = (p, s) => p.evaluate((s) => document.body.innerText.includes(s), s);

const ONE_QUESTION = {
  hasStemContent: true,
  primaryIndex: 0,
  questions: [{ label: "1", rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.4 } }],
};

/** Choose PHOTO from the phone's photos and wait for the cropper. */
async function choosePhoto(p) {
  const [chooser] = await Promise.all([
    p.waitForEvent("filechooser"),
    p.getByRole("button", { name: "Choose from photos" }).click(),
  ]);
  await chooser.setFiles(PHOTO);
  await p.getByRole("dialog", { name: "Select the question" }).waitFor({ timeout: 15000 });
}

export default async function homeSpec(t) {
  await t.test("A typed problem goes to the workspace and is analyzed as typed", async () => {
    const { p, st } = await t.page();
    const analyses = await mock(p, t.base, "analyze", () => analysis());
    const turns = await mock(p, t.base, "tutor", () => ({ ndjson: turnFrames({ message: "TURN should not be asked for" }) }));
    const typed = "A ball is dropped from 20 m. How fast is it going at the ground?";
    await p.goto(t.base + "/");
    const start = p.getByRole("button", { name: "Start this problem" });
    t.ok("typed: Start is disabled while the box is empty", await start.isDisabled());
    await p.getByRole("textbox", { name: "Type or paste a problem" }).fill(typed);
    await start.click();
    await p.waitForURL(/\/workspace/);
    await p.getByText("OPENER which quantity").first().waitFor();
    t.ok("typed: analysis is requested once, with exactly the typed text and no image",
      analyses.length === 1 && analyses[0]?.text === typed && !analyses[0]?.image, analyses);
    t.ok("typed: the opening hint comes from the analysis, no extra tutor call", turns.length === 0, turns.length);
    t.ok("typed: the typed problem is shown on the problem card",
      await onScreen(p, "A ball is dropped from 20 m. Find its speed at the ground."));
    t.ok("typed: once saved, the URL names the session (a reload reopens, not re-analyzes)",
      await until(p, () => /\/workspace\?session=/.test(p.url())), p.url());
    t.ok("typed: the hand-off in sessionStorage is spent",
      await p.evaluate(() => sessionStorage.getItem("mindgap:text") === null));
    t.ok("typed: no unmocked AI calls", st.unmocked.length === 0, st.unmocked);
  });

  await t.test("A failed crop hand-off shows its error in the cropper and can be retried", async () => {
    const { c, p, st } = await t.page();
    // sessionStorage full: the crop can't be handed to the workspace until
    // the test lifts the stub.
    await c.addInitScript(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "mindgap:image" && window.__failImage !== false) {
          throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        }
        return orig.call(this, key, value);
      };
    });
    const detects = await mock(p, t.base, "detect-questions", () => ONE_QUESTION);
    const analyses = await mock(p, t.base, "analyze", () => analysis());
    await p.goto(t.base + "/");
    await choosePhoto(p);
    await p.getByText("Drag the box to frame the question").waitFor();
    t.ok("crop: detection was asked once, with a JPEG", detects.length === 1 &&
      /^data:image\/jpeg;base64,/.test(detects[0]?.image ?? ""), detects.length);

    const use = p.getByRole("button", { name: "Use this question" });
    await use.click();
    const alert = p.getByRole("alert").filter({ hasText: "Could not crop that photo" });
    await alert.waitFor({ timeout: 10000 });
    t.ok("crop: the error is shown inside the cropper",
      await p.getByRole("dialog", { name: "Select the question" }).getByRole("alert").isVisible());
    t.ok("crop: still on home", new URL(p.url()).pathname === "/", p.url());
    t.ok("crop: the cropper stays open", await p.getByRole("dialog", { name: "Select the question" }).isVisible());
    t.ok("crop: the button works again", await until(p, () => use.isEnabled()));
    t.ok("crop: nothing was analyzed", analyses.length === 0, analyses.length);

    await p.evaluate(() => {
      window.__failImage = false;
    });
    await use.click();
    await p.waitForURL(/\/workspace/, { timeout: 15000 });
    await p.getByText("OPENER which quantity").first().waitFor();
    t.ok("crop: the retry reaches the workspace and analyzes the cropped photo",
      analyses.length === 1 && /^data:image\/jpeg;base64,/.test(analyses[0]?.image ?? ""),
      analyses.map((a) => Object.keys(a ?? {})));
    t.ok("crop: no unmocked AI calls", st.unmocked.length === 0, st.unmocked);
  });

  await t.test("The cropper's not-a-question gate fails open", async () => {
    // An explicit false: the overlay, with a way through.
    {
      const { p, st } = await t.page();
      await mock(p, t.base, "detect-questions", () => ({ hasStemContent: false, primaryIndex: 0, questions: [] }));
      const analyses = await mock(p, t.base, "analyze", () => analysis());
      await p.goto(t.base + "/");
      await choosePhoto(p);
      const overlay = p.getByRole("alertdialog", { name: "Question not detected" });
      await overlay.waitFor({ timeout: 10000 });
      t.ok("not work: the overlay offers Take another photo",
        await overlay.getByRole("button", { name: "Take another photo" }).isVisible());
      t.ok("not work: Use this question is hidden behind the overlay",
        (await p.getByRole("button", { name: "Use this question" }).count()) === 0);
      await overlay.getByRole("button", { name: "Use this photo anyway" }).click();
      t.ok("not work: Use this photo anyway clears the overlay", (await overlay.count()) === 0);
      const use = p.getByRole("button", { name: "Use this question" });
      t.ok("not work: the student can confirm the photo after all", await until(p, () => use.isEnabled()));
      await use.click();
      await p.waitForURL(/\/workspace/, { timeout: 15000 });
      await p.getByText("OPENER which quantity").first().waitFor();
      t.ok("not work: the photo is analyzed after Use this photo anyway",
        analyses.length === 1 && /^data:image\/jpeg/.test(analyses[0]?.image ?? ""), analyses.length);
      t.ok("not work: no unmocked AI calls", st.unmocked.length === 0, st.unmocked);
    }
    // No hasStemContent at all: must not block.
    {
      const { p, st } = await t.page();
      const detects = await mock(p, t.base, "detect-questions", () => ({
        primaryIndex: 0,
        questions: ONE_QUESTION.questions,
      }));
      await p.goto(t.base + "/");
      await choosePhoto(p);
      // This instruction only appears once the detection result was applied.
      await p.getByText("Drag the box to frame the question").waitFor({ timeout: 10000 });
      t.ok("missing flag: detection answered", detects.length === 1, detects.length);
      t.ok("missing flag: no not-a-question overlay",
        (await p.getByRole("alertdialog", { name: "Question not detected" }).count()) === 0);
      t.ok("missing flag: Use this question is available",
        await p.getByRole("button", { name: "Use this question" }).isEnabled());
      t.ok("missing flag: no unmocked AI calls", st.unmocked.length === 0, st.unmocked);
    }
  });

  await t.test("Ask mode: the typed question reaches the tutor", async () => {
    const { p, st } = await t.page();
    await mock(p, t.base, "detect-questions", () => ONE_QUESTION);
    const analyses = await mock(p, t.base, "analyze", () => analysis());
    const turns = await mock(p, t.base, "tutor", () => ({
      ndjson: turnFrames({ message: "ASKANSWER mass cancels out of mgh = ½mv²." }),
    }));
    const checks = await mock(p, t.base, "check-work", () => ({ status: 500, json: { error: "e2e: not expected" } }));
    const question = "Why doesn't the mass matter here?";
    await p.goto(t.base + "/");
    await choosePhoto(p);
    await p.getByText("Drag the box to frame the question").waitFor({ timeout: 10000 });

    await p.getByRole("switch", { name: "Ask a specific question" }).click();
    const ask = p.getByRole("button", { name: "Ask", exact: true });
    await ask.waitFor();
    t.ok("ask: the switch is on", (await p.getByRole("switch", { name: "Ask a specific question" }).getAttribute("aria-checked")) === "true");
    t.ok("ask: Ask is disabled with no question", await ask.isDisabled());
    const box = p.getByRole("textbox", { name: "Your question" });
    await box.fill("   ");
    t.ok("ask: whitespace is not a question", await ask.isDisabled());
    await box.fill(question);
    t.ok("ask: Ask is enabled once a question is typed", await ask.isEnabled());
    await ask.click();
    await p.waitForURL(/\/workspace/, { timeout: 15000 });
    await p.getByText("ASKANSWER mass cancels").first().waitFor();

    t.ok("ask: the photo is analyzed", analyses.length === 1 && /^data:image\/jpeg/.test(analyses[0]?.image ?? ""));
    t.ok("ask: the first tutor turn is the question, word for word",
      turns.length === 1 && turns[0]?.action === "question" && turns[0]?.studentText === question,
      turns.map((x) => ({ action: x?.action, studentText: x?.studentText })));
    t.ok("ask: the question is shown as the student's message", await onScreen(p, question));
    t.ok("ask: the question replaces the opening hint", !(await onScreen(p, "OPENER")));
    t.ok("ask: no work check is started", checks.length === 0, checks.length);
    t.ok("ask: no unmocked AI calls", st.unmocked.length === 0, st.unmocked);
  });

  await t.test("The crop box: clear of the screen edges, drawn by a drag, picked by a tap", async () => {
    const { p, st } = await t.page();
    // Slow on purpose: a dense page took longer than the old 8 s ceiling and
    // came back with nothing.
    await mock(p, t.base, "detect-questions", async () => {
      await new Promise((r) => setTimeout(r, 9500));
      return {
        hasStemContent: true,
        primaryIndex: 0,
        questions: [
          { label: "2(a)", rect: { x: 0, y: 0.1, w: 1, h: 0.15 } },
          { label: "2(b)", rect: { x: 0.1, y: 0.5, w: 0.4, h: 0.1 } },
        ],
      };
    });
    await p.goto(t.base + "/");
    await choosePhoto(p);
    const chip = (label) => p.getByRole("radio", { name: label });
    const landed = await chip("2(a)").waitFor({ timeout: 15000 }).then(() => true, () => false);
    t.ok("a detection slower than 8 s still lands", landed);

    const box = p.locator(".cursor-move.border-brand-500");
    const photo = await p.getByRole("img", { name: "Your photo" }).boundingBox();
    const vw = p.viewportSize().width;
    const b = await box.boundingBox();
    t.ok("a full-width question's box sits ≥ 24 px inside both screen edges (Android's back-gesture strips)",
      !!b && b.x >= 24 && b.x + b.width <= vw - 24, { box: b, vw });
    await t.shot(p, "crop-full-width");

    // A tap on the other question, outside the current box, picks it.
    const at = (fx, fy) => [photo.x + fx * photo.width, photo.y + fy * photo.height];
    await p.mouse.click(...at(0.3, 0.55));
    t.ok("a tap on a detected question picks it", (await chip("2(b)").getAttribute("aria-checked")) === "true");

    // A drag across empty photo draws a new box from the press to the release.
    const [x1, y1] = at(0.2, 0.75);
    const [x2, y2] = at(0.7, 0.85);
    await p.mouse.move(x1, y1);
    await p.mouse.down();
    await p.mouse.move(x2, y2, { steps: 6 });
    await p.mouse.up();
    const d = await box.boundingBox();
    const near = (a, e) => Math.abs(a - e) <= 3;
    t.ok("a drag across the photo draws the box there",
      !!d && near(d.x, x1) && near(d.y, y1) && near(d.x + d.width, x2) && near(d.y + d.height, y2),
      { drawn: d, from: [x1, y1], to: [x2, y2] });
    // Drawn by the student, so a late re-render of detection doesn't move it.
    t.ok("Reset offers the detected box back", await p.getByRole("button", { name: "Reset" }).isVisible());
    t.ok("no page errors", st.pageErrors.length === 0, st.pageErrors);
  });
}

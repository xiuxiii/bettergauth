/**
 * Every "take a photo" uses MindGap's own camera (CameraScanner), never the
 * phone's camera app: Check my work, the retry sheet, practice answers and
 * Snap a problem. A `filechooser` event would mean the phone's picker opened.
 * Chromium's fake camera stands in for the phone's.
 */
import { PHOTO, analysis, checkFrames, mock, practiceProblem, record, seed } from "./harness.mjs";

export const profile = "default";

export default async function (t) {
  const camera = (p) => p.getByRole("dialog", { name: "Camera" });
  const focused = (p) => p.evaluate(() => document.activeElement?.textContent?.trim());

  for (const theme of ["light", "dark"]) {
    await t.test(`Check my work, in-app camera (${theme})`, async () => {
      const { p, st } = await t.page({ theme });
      const checks = await mock(p, t.base, "check-work", () => ({ ndjson: checkFrames() }));
      await p.goto(t.base + "/");
      await seed(p, [record("s1")]);
      await p.goto(t.base + "/workspace?session=s1");
      await p.getByRole("button", { name: "Check my work" }).first().click();
      const take = p.getByRole("button", { name: /Take a photo of your work/ });
      await take.waitFor();
      t.ok(`${theme}: composer offers Take a photo and Choose from your photos`,
        await p.getByRole("button", { name: "Choose from your photos" }).isVisible());
      await p.waitForTimeout(700); // let the sheet finish rising
      await t.shot(p, `composer-${theme}`);

      await take.click();
      await camera(p).waitFor();
      await p.getByRole("button", { name: "Capture problem" }).waitFor();
      const box = await camera(p).boundingBox();
      t.ok(`${theme}: camera covers the whole screen, not clipped by the sheet`,
        !!box && box.y === 0 && box.height >= 800 && box.width >= 375, box);
      t.ok(`${theme}: camera says what to frame`,
        await p.getByText("Fit your working and answer in the frame").isVisible());

      await p.getByRole("button", { name: "Capture problem" }).click();
      await p.getByText("Photo attached").waitFor({ timeout: 10000 });
      t.ok(`${theme}: camera closes after the shutter`, (await camera(p).count()) === 0);
      t.ok(`${theme}: focus lands on Retake`, (await focused(p)) === "Retake");

      await p.getByRole("button", { name: "Retake" }).click();
      await camera(p).waitFor();
      await p.keyboard.press("Escape");
      t.ok(`${theme}: Escape closes only the camera, not the sheet under it`,
        (await camera(p).count()) === 0 && (await p.getByText("Photo attached").isVisible()));
      t.ok(`${theme}: focus back on Retake`, (await focused(p)) === "Retake");

      await p.getByRole("button", { name: "Check it" }).click();
      for (let i = 0; i < 25 && !checks.length; i++) await p.waitForTimeout(200);
      t.ok(`${theme}: the check is sent with the photo`,
        checks.length === 1 && /^data:image\/jpeg;base64,/.test(checks[0]?.attempt?.imageDataUrl ?? ""),
        checks.map((x) => Object.keys(x?.attempt ?? {})));
      t.ok(`${theme}: the phone's picker never opened`, st.choosers === 0, st.choosers);
    });
  }

  await t.test("Choose from your photos still uploads", async () => {
    const { p, st } = await t.page();
    await p.goto(t.base + "/");
    await seed(p, [record("s1")]);
    await p.goto(t.base + "/workspace?session=s1");
    await p.getByRole("button", { name: "Check my work" }).first().click();
    const [chooser] = await Promise.all([
      p.waitForEvent("filechooser"),
      p.getByRole("button", { name: "Choose from your photos" }).click(),
    ]);
    await chooser.setFiles(PHOTO);
    await p.getByText("Photo attached").waitFor();
    t.ok("a chosen photo is attached (the only path that opens the picker)", st.choosers === 1, st.choosers);
  });

  await t.test("Practice answer, in-app camera", async () => {
    const { p, st } = await t.page();
    await mock(p, t.base, "practice/generate", () => practiceProblem());
    const evals = await mock(p, t.base, "practice/evaluate", () => ({ status: 500, json: { error: "e2e: stop here" } }));
    await p.goto(t.base + "/");
    await seed(p, [
      record("s2", { messages: [{ id: "p1", role: "tutor", content: "", createdAt: 1, practiceFor: analysis() }] }),
    ]);
    await p.goto(t.base + "/workspace?session=s2");
    await p.getByText("PRACTICE-Q").waitFor();
    await p.getByRole("button", { name: /Take a photo of your work/ }).click();
    await camera(p).waitFor();
    await p.getByRole("button", { name: "Capture problem" }).click();
    await p.getByText("Photo attached").waitFor({ timeout: 10000 });
    await p.getByRole("button", { name: "Submit for feedback" }).first().click();
    for (let i = 0; i < 25 && !evals.length; i++) await p.waitForTimeout(200);
    t.ok("practice: the in-app photo is submitted",
      evals.length === 1 && /^data:image\/jpeg/.test(evals[0]?.attempt?.imageDataUrl ?? ""),
      evals.map((x) => Object.keys(x ?? {})));
    t.ok("practice: the phone's picker never opened", st.choosers === 0, st.choosers);
  });

  await t.test("Snap a problem, in-app camera to the cropper", async () => {
    const { p, st } = await t.page();
    await mock(p, t.base, "detect-questions", () => ({
      hasStemContent: true,
      primaryIndex: 0,
      questions: [{ label: "1", rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.3 } }],
    }));
    await p.goto(t.base + "/");
    t.ok("home: Choose from photos button", await p.getByRole("button", { name: "Choose from photos" }).isVisible());
    await p.getByRole("button", { name: "Snap a problem" }).click();
    await camera(p).waitFor();
    t.ok("home: the scanner keeps the question hint", await p.getByText("Fit the whole question in the frame").isVisible());
    await p.getByRole("button", { name: "Capture problem" }).click();
    await p.getByRole("button", { name: "Use this question" }).waitFor({ timeout: 15000 });
    t.ok("home: the shutter reaches the cropper", true);
    t.ok("home: the phone's picker never opened", st.choosers === 0, st.choosers);
  });
}

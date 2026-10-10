/**
 * The workspace: the check revealed one piece at a time, the key idea held
 * back until the session is resolved, chips that follow the stage, old
 * records read safely, and tutor turns that stream (or fail) cleanly.
 * Preferences are the harness default: hint first.
 */
import {
  ANSWER,
  FIRST_ERROR,
  KEY_IDEA,
  allSessions,
  analysis,
  check,
  checkFrames,
  mock,
  record,
  seed,
  turnFrames,
} from "./harness.mjs";

export const profile = "default";

/** Wait until `fn()` is truthy, polling; false if it never is. */
async function until(p, fn, ms = 8000) {
  for (let waited = 0; waited < ms; waited += 100) {
    if (await fn()) return true;
    await p.waitForTimeout(100);
  }
  return !!(await fn());
}

/** Text a person can see. innerText skips display:none, which matters here:
 *  the problem card is rendered twice (phone list, desktop pane). */
const onScreen = (p, s) => p.evaluate((s) => document.body.innerText.includes(s), s);
/** The same, ignoring case (eyebrows are upper-cased by CSS). */
const onScreenI = (p, s) => p.evaluate((s) => document.body.innerText.toLowerCase().includes(s), s.toLowerCase());
const visible = (p, s) => p.getByText(s).filter({ visible: true }).first();

const CHIP_LABELS = ["Hint", "I'm stuck", "Explain why", "Check my work", "Go deeper", "Try a similar one", "Show solution"];

/** The chips in the bar, in order (the More menu closed). */
async function chips(p) {
  const out = [];
  for (const b of await p.getByRole("button").filter({ visible: true }).all()) {
    const name = (await b.textContent())?.trim();
    if (CHIP_LABELS.includes(name) && (await b.getAttribute("role")) !== "menuitem") out.push(name);
  }
  return out;
}

async function moreItems(p) {
  await p.getByRole("button", { name: "More actions" }).filter({ visible: true }).click();
  const menu = p.getByRole("menu", { name: "More actions" });
  await menu.waitFor();
  const items = (await menu.getByRole("menuitem").allTextContents()).map((s) => s.trim());
  await p.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  return items;
}

const TYPED_WORK = "v = g h = 9.8 × 20 = 196";

/** Start from a typed problem with working in it, so the check runs at once. */
async function typedProblemWithWork(t, p, c) {
  await mock(p, t.base, "analyze", () => analysis({ studentWork: { present: true }, attemptText: TYPED_WORK }));
  const checks = await mock(p, t.base, "check-work", () => ({ ndjson: checkFrames(c) }));
  await p.goto(t.base + "/");
  await p.getByRole("textbox", { name: "Type or paste a problem" }).fill(
    `A ball is dropped from 20 m. Find its speed at the ground. My working: ${TYPED_WORK}`,
  );
  await p.getByRole("button", { name: "Start this problem" }).click();
  await p.waitForURL(/\/workspace/);
  return checks;
}

export default async function workspaceSpec(t) {
  await t.test("The check is revealed one piece at a time", async () => {
    const { p, st } = await t.page();
    const checks = await typedProblemWithWork(t, p, check());
    await visible(p, "HEADLINE right up to line 2").waitFor({ timeout: 10000 });

    t.ok("reveal: the typed working is what gets checked",
      checks.length === 1 && checks[0]?.attempt?.text === TYPED_WORK, checks.map((x) => x?.attempt));
    t.ok("reveal: step 0 shows the headline, where, the flagged line and the nudge",
      (await onScreen(p, "HEADLINE")) && (await onScreen(p, "LOCATE line 2")) &&
        (await onScreen(p, FIRST_ERROR.line)) && (await onScreen(p, "NUDGE which energy")));
    t.ok("reveal: step 0 hides the diagnosis and the fix",
      !(await onScreen(p, "DIAGNOSIS")) && !(await onScreen(p, "FIXTEXT")));
    t.ok("reveal: step 0 hides the final answer", !(await onScreen(p, ANSWER)));
    t.ok("reveal: step 0 offers Show me the fix, not Show the rest",
      (await p.getByRole("button", { name: "Show me the fix" }).isVisible()) &&
        (await p.getByRole("button", { name: "Show the rest" }).count()) === 0);
    t.ok("reveal: the key idea stays hidden while diagnosed", !(await onScreen(p, KEY_IDEA)));

    await p.getByRole("button", { name: "Show me the fix" }).click();
    await visible(p, "FIXTEXT").waitFor();
    t.ok("reveal: step 1 shows the diagnosis and the fix",
      (await onScreen(p, "DIAGNOSIS you set speed")) && (await onScreen(p, "FIXTEXT use mgh")));
    t.ok("reveal: step 1 still hides the final answer", !(await onScreen(p, ANSWER)));
    t.ok("reveal: step 1 offers Show the rest",
      (await p.getByRole("button", { name: "Show the rest" }).isVisible()) &&
        (await p.getByRole("button", { name: "Show me the fix" }).count()) === 0);

    // The step reached is saved on the message: a reopen shows no more.
    t.ok("reveal: the URL names the saved session", await until(p, () => /session=/.test(p.url())), p.url());
    t.ok("reveal: the step reached is saved on the message",
      await until(p, async () => (await allSessions(p)).some((r) => r.messages?.some((m) => m.workCheck && m.reveal === 1)), 5000));
    await p.reload();
    await visible(p, "HEADLINE right up to line 2").waitFor();
    t.ok("reveal: a reopen shows the fix again, and still not the answer",
      (await onScreen(p, "FIXTEXT")) && !(await onScreen(p, ANSWER)));

    await p.getByRole("button", { name: "Show the rest" }).click();
    await visible(p, ANSWER).waitFor();
    t.ok("reveal: the final answer appears only after Show the rest", await onScreen(p, ANSWER));
    t.ok("reveal: nothing left to reveal, no reveal buttons",
      (await p.getByRole("button", { name: /Show me the fix|Show the rest/ }).count()) === 0);
    t.ok("reveal: once resolved, the key idea is shown", await until(p, () => onScreen(p, KEY_IDEA)));
    await p.waitForTimeout(400); // let the fade-in finish before the picture
    await t.shot(p, "check-revealed-light");
    t.ok("reveal: no unmocked AI calls", st.unmocked.length === 0, st.unmocked);
  });

  await t.test("A check with nothing behind the fix goes straight to the rest", async () => {
    // Correct: nothing to hide, the rest is out at once.
    {
      const { p, st } = await t.page();
      await typedProblemWithWork(t, p, check({ verdict: "correct", headline: "HEADLINE all correct.", firstError: undefined }));
      await visible(p, "HEADLINE all correct").waitFor({ timeout: 10000 });
      t.ok("correct: no Show me the fix", (await p.getByRole("button", { name: "Show me the fix" }).count()) === 0);
      t.ok("correct: the rest of the way is shown with it",
        (await onScreen(p, ANSWER)) && (await onScreenI(p, "why it holds")),
        await p.evaluate(() => document.body.innerText.slice(0, 600)));
      t.ok("correct: the key idea is shown (resolved)", await onScreen(p, KEY_IDEA));
      t.ok("correct: no unmocked AI calls", st.unmocked.length === 0, st.unmocked);
    }
    // Partly right, no single error: Show the rest straight away.
    {
      const { p, st } = await t.page();
      await typedProblemWithWork(t, p, check({ verdict: "partially_correct", headline: "HEADLINE nearly.", firstError: undefined }));
      await visible(p, "HEADLINE nearly").waitFor({ timeout: 10000 });
      t.ok("no error: offers Show the rest and no Show me the fix",
        (await p.getByRole("button", { name: "Show the rest" }).isVisible()) &&
          (await p.getByRole("button", { name: "Show me the fix" }).count()) === 0);
      t.ok("no error: the answer waits behind Show the rest", !(await onScreen(p, ANSWER)));
      await p.getByRole("button", { name: "Show the rest" }).click();
      t.ok("no error: Show the rest reveals the answer", await until(p, () => onScreen(p, ANSWER)));
      t.ok("no error: no unmocked AI calls", st.unmocked.length === 0, st.unmocked);
    }
  });

  await t.test("The key idea waits for the session to be resolved; the safe label shows", async () => {
    const { p, st } = await t.page();
    await mock(p, t.base, "analyze", () => analysis({ concept: "CONCEPTLABEL Free fall" }));
    await p.goto(t.base + "/");
    await p.getByRole("textbox", { name: "Type or paste a problem" }).fill("A ball is dropped from 20 m. Find its speed.");
    await p.getByRole("button", { name: "Start this problem" }).click();
    await p.waitForURL(/\/workspace/);
    await visible(p, "OPENER which quantity").waitFor();
    t.ok("key idea: the safe concept label is on screen", await onScreen(p, "CONCEPTLABEL Free fall"));
    t.ok("key idea: the key idea is not on screen in a fresh session", !(await onScreen(p, KEY_IDEA)));
    t.ok("key idea: nor is the Key idea heading", !(await onScreenI(p, "key idea")));
    t.ok("key idea: no unmocked AI calls", st.unmocked.length === 0, st.unmocked);
  });

  await t.test("Chips follow the stage", async () => {
    const { p, st } = await t.page();
    const opener = { id: "o1", role: "tutor", content: "OPENER which quantity is conserved here?", createdAt: 1, opener: true };
    const checked = (c, reveal) => ({ id: "c1", role: "tutor", content: c.headline, createdAt: 2, workCheck: c, reveal });
    await p.goto(t.base + "/");
    await seed(p, [
      record("fresh"),
      record("hinted", { messages: [opener] }),
      record("diagnosed", { messages: [opener, checked(check(), 0)] }),
      record("resolved", { messages: [opener, checked(check({ verdict: "correct", firstError: undefined }), 2)] }),
    ]);

    const open = async (id) => {
      await p.goto(t.base + "/workspace?session=" + id);
      await p.getByRole("button", { name: "Go deeper" }).waitFor();
    };

    await open("fresh");
    let row = await chips(p);
    t.ok("fresh: Hint, Check my work, Go deeper", row.join("|") === "Hint|Check my work|Go deeper", row);
    let more = await moreItems(p);
    t.ok("fresh: Show solution is under More", more.includes("Show solution"), more);
    t.ok("fresh: More holds what the bar doesn't", !more.includes("Hint") && more.includes("Explain why"), more);

    await open("hinted");
    row = await chips(p);
    t.ok("after the opening nudge: Explain why replaces Hint",
      row.join("|") === "Explain why|Check my work|Go deeper", row);
    more = await moreItems(p);
    t.ok("after the opening nudge: Hint and Show solution are under More",
      more.includes("Hint") && more.includes("Show solution"), more);

    await open("diagnosed");
    row = await chips(p);
    t.ok("diagnosed: Explain why, Check my work, Go deeper", row.join("|") === "Explain why|Check my work|Go deeper", row);
    t.ok("diagnosed: Show solution under More", (await moreItems(p)).includes("Show solution"));

    await open("resolved");
    row = await chips(p);
    t.ok("resolved: Try a similar one, Go deeper", row.join("|") === "Try a similar one|Go deeper", row);
    t.ok("resolved: Show solution under More", (await moreItems(p)).includes("Show solution"));

    // Show solution from More, in a fresh session: one JSON turn, then resolved chips.
    const turns = await mock(p, t.base, "tutor", () => ({
      message: "Here is the full solution.",
      solution: {
        understanding: "A drop from rest.",
        keyConcept: "Energy is conserved.",
        reasoning: "mgh becomes ½mv².",
        solution: "v = √(2gh)",
        finalAnswer: "SOLUTIONANSWER 19.8 m/s",
        takeaway: "Mass cancels.",
      },
    }));
    await open("fresh");
    await p.getByRole("button", { name: "More actions" }).filter({ visible: true }).click();
    await p.getByRole("menuitem", { name: "Show solution" }).click();
    await visible(p, "SOLUTIONANSWER").waitFor();
    t.ok("show solution: the tutor is asked for show_solution",
      turns.length === 1 && turns[0]?.action === "show_solution", turns.map((x) => x?.action));
    t.ok("show solution: the session is then resolved",
      await until(p, async () => (await chips(p)).join("|") === "Try a similar one|Go deeper"), await chips(p));
    t.ok("chips: no unmocked AI calls", st.unmocked.length === 0, st.unmocked);
  });

  await t.test("Old records with a long concept still render safely", async () => {
    const { p, st } = await t.page();
    const OLD = "OLDSPOILER use conservation of energy, mgh equals one half m v squared";
    const old = analysis({ concept: OLD });
    delete old.keyIdea;
    const correct = check({ verdict: "correct", firstError: undefined });
    await p.goto(t.base + "/");
    await seed(p, [
      record("old", { analysis: old, messages: [{ id: "o1", role: "tutor", content: "OPENER which quantity is conserved here?", createdAt: 1, opener: true }] }),
      record("old-solved", { analysis: old, messages: [{ id: "c1", role: "tutor", content: correct.headline, createdAt: 2, workCheck: correct, reveal: 2 }] }),
    ]);
    await p.goto(t.base + "/workspace?session=old");
    await visible(p, "OPENER which quantity").waitFor();
    t.ok("old record: the long old concept is not on screen", !(await onScreen(p, "OLDSPOILER")));
    t.ok("old record: the topic is shown as the label instead", await onScreen(p, "Free fall"));

    await p.goto(t.base + "/workspace?session=old-solved");
    await p.getByRole("button", { name: "Go deeper" }).waitFor();
    t.ok("old record, resolved: the old concept appears as the key idea", await until(p, () => onScreen(p, "OLDSPOILER")));
    t.ok("old record: no unmocked AI calls", st.unmocked.length === 0, st.unmocked);
  });

  await t.test("A tutor turn streams in, and a failed one says so plainly", async () => {
    const { p, st } = await t.page();
    const turns = await mock(p, t.base, "tutor", (body, n) => {
      if (n === 1) {
        return { ndjson: [{ t: "delta", v: "HINTPART partial…" }, { t: "done", turn: { message: "HINTTEXT what does the ball have at the top?", hasMore: false } }] };
      }
      if (n === 2) {
        return { ndjson: [{ t: "delta", v: "EXPLAINPART " }, { t: "error", message: "The tutor stopped mid-answer. Please try again." }] };
      }
      if (n === 3) return { ndjson: turnFrames({ message: "EXPLAINTEXT energy at the top becomes speed at the bottom." }) };
      // A stream that ends without its done frame: the connection dropped.
      return { ndjson: [{ t: "delta", v: "DEEPERPART " }] };
    });
    await p.goto(t.base + "/");
    await seed(p, [record("s1")]);
    await p.goto(t.base + "/workspace?session=s1");
    await p.getByRole("button", { name: "Hint", exact: true }).click();
    await visible(p, "HINTTEXT").waitFor();
    t.ok("stream: the hint is requested as a hint", turns[0]?.action === "hint", turns[0]?.action);
    t.ok("stream: the done frame's text replaces the streamed draft", !(await onScreen(p, "HINTPART")));
    t.ok("stream: after a hint, Explain why takes Hint's place",
      await until(p, async () => (await chips(p)).join("|") === "Explain why|Check my work|Go deeper"), await chips(p));

    await p.getByRole("button", { name: "Explain why" }).click();
    await visible(p, "Something went wrong").waitFor();
    t.ok("stream error: the server's plain message is shown", await onScreen(p, "The tutor stopped mid-answer. Please try again."));
    t.ok("stream error: nothing raw leaks", !(await p.evaluate(() =>
      /SyntaxError|Unexpected token|Failed to fetch|Load failed|\{"t"/.test(document.body.innerText))));
    t.ok("stream error: the chips work again", await until(p, () => p.getByRole("button", { name: "Explain why" }).isEnabled()));
    await p.getByRole("button", { name: "Try again" }).click();
    await visible(p, "EXPLAINTEXT").waitFor();
    t.ok("stream error: Try again re-asks the same thing", turns[2]?.action === "explain", turns.map((x) => x?.action));
    t.ok("stream error: the error card goes once it works", !(await onScreen(p, "Something went wrong")));

    await p.getByRole("button", { name: "Go deeper" }).click();
    await visible(p, "Something went wrong").waitFor();
    t.ok("cut off: a stream with no result says it was cut off",
      await onScreen(p, "The tutor's answer was cut off. Please try again."));
    t.ok("stream: no unmocked AI calls", st.unmocked.length === 0, st.unmocked);
  });

  await t.test("A revealed check, dark theme", async () => {
    const { p, st } = await t.page({ theme: "dark" });
    await p.goto(t.base + "/");
    const c = check();
    await seed(p, [record("dark", {
      messages: [
        { id: "s1", role: "student", content: TYPED_WORK, createdAt: 1 },
        { id: "c1", role: "tutor", content: c.headline, createdAt: 2, workCheck: c, reveal: 1 },
      ],
    })]);
    await p.goto(t.base + "/workspace?session=dark");
    await visible(p, "FIXTEXT").waitFor();
    t.ok("dark: a saved step-1 reveal reopens at step 1", !(await onScreen(p, ANSWER)) &&
      (await p.getByRole("button", { name: "Show the rest" }).isVisible()));
    t.ok("dark: the dark theme is applied", (await p.evaluate(() => document.documentElement.dataset.theme)) === "dark");
    await p.waitForTimeout(400);
    await t.shot(p, "check-revealed-dark");
    t.ok("dark: no unmocked AI calls", st.unmocked.length === 0, st.unmocked);
  });
}

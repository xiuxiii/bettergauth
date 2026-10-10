/**
 * Accounts (Supabase), against the fake in fakeSupabase.mjs: signing in with
 * an emailed link and with Google, the 13+ step (under 13 deletes the account
 * on the spot), bringing signed-out problems in, a second device pulling them
 * and the photo, preferences both ways, a delete reaching the other device,
 * signing out, and deleting the account. `t.supabase` is the fake's state.
 */
import fs from "node:fs";
import { PHOTO, allSessions, analysis, imageIds, record, seed } from "./harness.mjs";

export const profile = "accounts";

const THIS_YEAR = new Date().getFullYear();

/** Poll `fn` until it returns something truthy, or the time runs out. */
async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  let v = await fn();
  while (!v && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 200));
    v = await fn();
  }
  return v;
}

const signInLink = (p) => p.getByRole("link", { name: "Sign in", exact: true }).first();
const accountLink = (p) => p.getByRole("link", { name: "Your account" });
const path = (p) => new URL(p.url()).pathname;
const prefsOf = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("mindgap:preferences") ?? "null"));
/** Supabase's session cookies (not the PKCE verifier). */
const authCookies = async (c) => (await c.cookies()).filter((k) => /^sb-.+-auth-token(\.\d+)?$/.test(k.name));

async function openSignIn(p, base) {
  await p.goto(base + "/signin");
  await p.getByRole("heading", { name: "Sign in to MindGap" }).waitFor();
  await p.waitForLoadState("networkidle");
}

/** Ask for an emailed link, then open it, as the student's mail app would. */
async function signInByEmail(t, p, email) {
  await openSignIn(p, t.base);
  await p.getByLabel("Email").fill(email);
  await p.getByRole("button", { name: "Email me a sign-in link" }).click();
  await p.getByRole("heading", { name: "Check your email" }).waitFor();
  const link = t.supabase.links.get(email);
  await p.goto(link);
}

async function signInWithGoogle(t, p) {
  await openSignIn(p, t.base);
  await p.getByRole("button", { name: "Continue with Google" }).click();
}

async function answerAge(p, year, month = 1) {
  await p.getByRole("heading", { name: "When were you born?" }).waitFor();
  await p.waitForLoadState("networkidle");
  await p.getByLabel("Birth month").selectOption(String(month));
  await p.getByLabel("Birth year").selectOption(String(year));
  await p.getByRole("button", { name: "Continue" }).click();
}

const guest = (id, text, over = {}) =>
  record(id, {
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now() - 60_000,
    analysis: analysis({ problemText: text }),
    ...over,
  });

export default async function accountsSpec(t) {
  const fake = t.supabase;

  for (const theme of ["light", "dark"]) {
    await t.test(`Signed out (${theme})`, async () => {
      fake.reset();
      const { p, st } = await t.page({ theme });
      await p.goto(t.base + "/");
      await signInLink(p).waitFor();
      t.ok(`${theme}: home offers Sign in`, await signInLink(p).isVisible());

      await openSignIn(p, t.base);
      t.ok(`${theme}: Continue with Google`, await p.getByRole("button", { name: "Continue with Google" }).isVisible());
      t.ok(`${theme}: the email form`, await p.getByLabel("Email").isVisible());
      t.ok(`${theme}: says accounts are 13+`, await p.getByText("Accounts are for ages 13 and up.").isVisible());
      await t.shot(p, `signin-${theme}`);

      await p.goto(t.base + "/privacy");
      t.ok(`${theme}: privacy has "With an account"`,
        await p.getByRole("heading", { name: "With an account" }).isVisible());
      const text = await p.getByRole("main").innerText();
      t.ok(`${theme}: privacy drops the accounts-off claims`,
        !/only cookie MindGap uses|Nothing about your problems: no photos|Ask for an account/.test(text));
      t.ok(`${theme}: no page errors`, st.pageErrors.length === 0, st.pageErrors);
    });
  }

  await t.test("Email link, under 13: the account is deleted on the spot", async () => {
    fake.reset();
    const { c, p, st } = await t.page();
    await signInByEmail(t, p, "kid@example.com");
    await p.waitForURL(/\/account\/age/, { timeout: 10000 }).catch(() => {});
    t.ok("the emailed link lands on the age step", path(p) === "/account/age", p.url());
    t.ok("a session cookie was set", (await authCookies(c)).length > 0);
    await t.shot(p, "age");

    await answerAge(p, THIS_YEAR - 10);
    await p.getByRole("heading", { name: "Accounts are for 13 and up" }).waitFor();
    t.ok("the fake has no such user any more", fake.userByEmail("kid@example.com") === null);
    t.ok("and no profile", fake.profiles.size === 0, [...fake.profiles.values()]);
    t.ok("signed out: no session cookie", (await authCookies(c)).length === 0, await authCookies(c));
    await t.shot(p, "too-young");

    await p.getByRole("link", { name: "Back to MindGap" }).click();
    await signInLink(p).waitFor();
    t.ok("home works, signed out", await signInLink(p).isVisible());
    t.ok("no page errors", st.pageErrors.length === 0, st.pageErrors);
  });

  await t.test("Google, bringing problems in, a second device, deletes", async () => {
    fake.reset();
    fake.google = { email: "sam@example.com", name: "Sam Student" };
    const d1 = await t.page();
    const p = d1.p;
    await p.goto(t.base + "/");
    await seed(p, [guest("g1", "GUEST1 a ball rolls off a table", { imageId: "img-g1" })], { "img-g1": PHOTO });

    await signInWithGoogle(t, p);
    await p.waitForURL(/\/account\/age/, { timeout: 10000 }).catch(() => {});
    t.ok("Google comes back through the callback to the age step", path(p) === "/account/age", p.url());
    t.ok("the code was traded with the browser's PKCE verifier",
      fake.log.includes("GET /auth/v1/authorize") && fake.log.includes("POST /auth/v1/token") && !!fake.userByEmail("sam@example.com"));

    await answerAge(p, 2000);
    await p.waitForURL((u) => new URL(u).pathname === "/", { timeout: 10000 }).catch(() => {});
    await accountLink(p).waitFor();
    t.ok("13+: home, signed in", path(p) === "/" && (await accountLink(p).isVisible()), p.url());
    const uid = fake.userByEmail("sam@example.com").id;
    const profile = fake.profiles.get(uid);
    t.ok("the profile records 13+ and nothing about the birthday",
      !!profile?.age_ok_at &&
        Object.keys(profile).every((k) => ["id", "age_ok_at", "preferences", "plan", "created_at", "updated_at"].includes(k)),
      profile);

    const prompt = p.getByText("Save the 1 problem on this device to your account?");
    await prompt.waitFor();
    t.ok("asks to bring the signed-out problem in", await prompt.isVisible());
    t.ok("nothing is sent before they say so", fake.rowsOf(uid).length === 0 && fake.objectsOf(uid).length === 0);
    t.ok("this device's preferences go up to the empty account",
      !!(await until(() => fake.profiles.get(uid)?.preferences)));
    await t.shot(p, "import-prompt");

    await p.getByRole("button", { name: "Save to account" }).click();
    const row = await until(() => fake.rowsOf(uid).find((r) => r.id === "g1" && r.record));
    t.ok("Save to account: the problem is in the account", !!row && /GUEST1/.test(JSON.stringify(row.record)));
    const photo = await until(() => fake.objects.get(`${uid}/img-g1.jpg`));
    t.ok("and its photo, whole", photo?.bytes.length === fs.statSync(PHOTO).size, photo?.bytes.length);
    const local = await until(async () => (await allSessions(p)).find((r) => r.id === "g1" && r.syncedAt === r.updatedAt));
    t.ok("the device's copy is marked as the account's", local?.ownerId === uid, local);
    t.ok("the device's copy never goes up with its bookkeeping", !("ownerId" in row.record) && !("syncedAt" in row.record));
    await prompt.waitFor({ state: "detached" });

    // A second device (fresh browser), signed in by email as the same student.
    const d2 = await t.page({ theme: "dark" });
    const q = d2.p;
    await signInByEmail(t, q, "sam@example.com");
    await q.waitForURL((u) => new URL(u).pathname === "/", { timeout: 10000 }).catch(() => {});
    await accountLink(q).waitFor();
    t.ok("device 2: an account that passed 13+ goes straight home", path(q) === "/", q.url());

    await q.goto(t.base + "/history");
    await q.getByText("GUEST1").waitFor({ timeout: 10000 });
    t.ok("device 2: History lists the problem", await q.getByText("GUEST1").isVisible());
    t.ok("device 2: the photo isn't downloaded until it's needed", !(await imageIds(q)).includes("img-g1"));
    await q.getByRole("link", { name: /GUEST1/ }).click();
    t.ok("device 2: opening it fetches the photo",
      !!(await until(async () => (await imageIds(q)).includes("img-g1"))));

    await q.goto(t.base + "/settings");
    await q.getByRole("heading", { name: "Settings" }).waitFor();
    await q.waitForLoadState("networkidle");
    await q.getByRole("button", { name: /^Grade/ }).click();
    await q.getByRole("option", { name: "Grade 11" }).click();
    t.ok("device 2: a Settings change reaches the account",
      !!(await until(() => fake.profiles.get(uid)?.preferences?.grade === "11")), fake.profiles.get(uid)?.preferences);
    await p.reload();
    t.ok("device 1: picks it up on its next sync",
      !!(await until(async () => (await prefsOf(p))?.grade === "11")), await prefsOf(p));

    await q.goto(t.base + "/history");
    await q.getByRole("button", { name: "Delete this problem" }).first().click();
    const tomb = await until(() => {
      const r = fake.rowsOf(uid).find((x) => x.id === "g1");
      return r && r.deleted_at !== null && r.record === null && r;
    }, 15000);
    t.ok("device 2: a delete leaves a tombstone in the account", !!tomb, fake.rowsOf(uid));
    t.ok("and removes the photo", fake.objectsOf(uid).length === 0, fake.objectsOf(uid));
    await p.reload();
    t.ok("device 1: the delete reaches it",
      !!(await until(async () => !(await allSessions(p)).some((r) => r.id === "g1"))));
    for (const d of [d1, d2]) t.ok("no page errors", d.st.pageErrors.length === 0, d.st.pageErrors);
  });

  await t.test("Keep on this device, sign out, delete the account", async () => {
    fake.reset();
    fake.google = { email: "alex@example.com", name: "Alex" };
    const { c, p, st } = await t.page();
    await p.goto(t.base + "/");
    await seed(p, [guest("g2", "GUEST2 stays on this device")]);
    await signInWithGoogle(t, p);
    await p.waitForURL(/\/account\/age/, { timeout: 10000 }).catch(() => {});
    await answerAge(p, 2000);
    await accountLink(p).waitFor();
    const uid = fake.userByEmail("alex@example.com").id;

    await p.getByRole("button", { name: "Keep on this device" }).click();
    await p.getByText(/on this device to your account\?/).waitFor({ state: "detached" });
    await p.waitForTimeout(2500); // a sync pass would have run by now
    t.ok("Keep on this device: nothing goes to the account", fake.rowsOf(uid).length === 0, fake.rowsOf(uid));

    // A problem made after signing in is the account's without asking.
    await seed(p, [record("s3", { imageId: "img-s3", analysis: analysis({ problemText: "SIGNEDIN3 made signed in" }) })], {
      "img-s3": PHOTO,
    });
    await p.reload();
    t.ok("a problem made signed in is saved to the account, with its photo",
      !!(await until(() => fake.rowsOf(uid).some((r) => r.id === "s3" && r.record) && fake.objects.has(`${uid}/img-s3.jpg`))),
      { rows: fake.rowsOf(uid).map((r) => r.id), objects: fake.objectsOf(uid) });
    t.ok("the kept one still isn't", !fake.rowsOf(uid).some((r) => r.id === "g2"));

    await p.goto(t.base + "/account");
    await p.getByText(/Your problems are saved to your account/).waitFor({ timeout: 10000 });
    t.ok("Account: shows the email and the sync state", await p.getByText("alex@example.com").isVisible());
    await t.shot(p, "account");

    await p.getByRole("button", { name: "Sign out" }).click();
    await signInLink(p).waitFor({ timeout: 10000 });
    const ids = async () => (await allSessions(p)).map((r) => r.id).sort().join(",");
    t.ok("sign out: the account's problem leaves this device, the kept one stays",
      (await until(async () => (await ids()) === "g2")) && true, await ids());
    t.ok("sign out: still in the account", fake.rowsOf(uid).some((r) => r.id === "s3" && r.record));
    t.ok("sign out: no session cookie", (await authCookies(c)).length === 0, await authCookies(c));

    await signInByEmail(t, p, "alex@example.com");
    await accountLink(p).waitFor({ timeout: 10000 });
    t.ok("signing back in brings it back", (await until(async () => (await ids()) === "g2,s3")) && true, await ids());
    t.ok("and doesn't ask about the kept one again",
      (await p.getByText(/on this device to your account\?/).count()) === 0);

    await p.goto(t.base + "/account");
    await p.getByRole("button", { name: "Delete account" }).click();
    const confirm = p.getByRole("alertdialog");
    await confirm.waitFor();
    await t.shot(p, "delete-confirm");
    await confirm.getByRole("button", { name: "Delete account" }).click();
    await p.waitForURL(/accountDeleted=1/, { timeout: 10000 }).catch(() => {});
    await signInLink(p).waitFor({ timeout: 10000 });
    t.ok("delete: the user, profile, problems and photos are gone",
      fake.users.size === 0 && fake.profiles.size === 0 && fake.rowsOf(uid).length === 0 && fake.objectsOf(uid).length === 0,
      { users: fake.users.size, profiles: fake.profiles.size, rows: fake.rowsOf(uid).length, objects: fake.objectsOf(uid) });
    t.ok("delete: this device keeps only what was never the account's",
      (await until(async () => (await ids()) === "g2")) && true, await ids());
    t.ok("delete: signed out", (await authCookies(c)).length === 0, await authCookies(c));
    t.ok("no page errors", st.pageErrors.length === 0, st.pageErrors);
  });
}

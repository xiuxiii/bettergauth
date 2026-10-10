# Deploying (so friends can test it)

The app is a standard Next.js App Router project. **Vercel** is the natural host:
it runs the Node server routes, keeps `ANTHROPIC_API_KEY` server-side, and gives
you a public URL in a few clicks.

## Deploy to Vercel

1. Push the repo to GitHub (already done).
2. Go to [vercel.com](https://vercel.com) → **Add New… → Project** → import this
   repo. Framework auto-detects as Next.js; no build config needed.
3. Before the first deploy, add an **Environment Variable** (Project → Settings →
   Environment Variables, scope **Production** + **Preview**):
   - `ANTHROPIC_API_KEY` = `sk-ant-...`  (this is a **server** variable — do NOT
     prefix it with `NEXT_PUBLIC_`, or it would ship to the browser)
   - optional `ANTHROPIC_MODEL` = `claude-opus-5`
4. Deploy. When it's up, open `https://<your-app>.vercel.app/api/health` — it
   should show `{"ok":true}` (add `?code=<DEBUG_CODE>` for which provider and model).
5. Share the URL. Friends run through setup, then upload a problem.

Redeploys pick up new commits automatically. If you change an env var, trigger a
redeploy (env is read at server start).

## ⚠️ Cost & abuse (read this before sharing widely)

A public URL with your key means **every visitor spends your Anthropic credits** —
each analyze / tutor / check / practice call is a real API request. For a handful
of friends that's fine and cheap. If the link leaks or gets scraped, it isn't.

Cost controls that are already in place:

- **Cheaper model by default:** `claude-sonnet-5` (~2.5× cheaper than Opus).
  Override with `ANTHROPIC_MODEL=claude-opus-5` if you want more headroom.
- **Prompt caching** on the big tutoring system prompt, short output caps, and
  reduced reasoning effort — so each turn costs a fraction of what it did.

Before sharing beyond people you trust:

- **Turn on the access gate.** Set an `ACCESS_CODE` env var (Vercel → Settings →
  Environment Variables, from your phone is fine) and redeploy. Visitors then hit
  a one-field unlock page and must enter the code before anything calls the API.
  Leave it unset and the gate is off. It's a shared code, no accounts/database —
  give friends the code, rotate it by changing the env var.
- **Or give each person their own code with an expiry date.** Set
  `ACCESS_CODES` to a list of `code:date` pairs, comma- or line-separated:

  ```
  ACCESS_CODES=maya2026:2026-10-31, studygroup:2026-12-20, teacher:never
  ```

  A date means the code works through the end of that day (UTC); a full ISO
  time like `2026-10-31T17:00:00Z` also works, and `never` never expires. Edit
  the list and redeploy to add a code, cancel one (delete its line) or extend
  one (change its date). Those apply to people already logged in too: a
  cancelled or expired code stops working on their next tap, and they see
  "your access code expired". Set **`ACCESS_SECRET`** as well (any long random
  string): without it the cookies are signed with a key made from the codes, so
  every edit to the list logs everyone out. It also keys the scrambled IP
  codes the rate limits use, so set it even with a single `ACCESS_CODE`. `ACCESS_CODE` keeps working
  alongside the list as a code that never expires. If the list has a typo so
  that no entry parses, the gate stays closed — it never silently opens.
- **Make the daily cap real.** Each IP gets 150 AI calls a day
  (`RATE_LIMIT_PER_DAY`), but on Vercel those counts live in each server
  instance's memory until you add a shared store: Vercel → your project →
  Storage → Create / Connect → **Upstash for Redis** (the free plan is plenty),
  connect it to the project, then redeploy. It sets `KV_REST_API_URL` and
  `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` / `_TOKEN`), and the app
  picks them up. Check with `/api/health?code=<DEBUG_CODE>`: it should say
  `"rateLimitStore":"redis"`. If Redis ever goes down, the app keeps working on
  per-instance counts rather than locking everyone out.
- **The owner page.** Set `DEBUG_CODE` (any long random string) and
  `EVAL_BYPASS_TOKEN` (another one) in Vercel, redeploy, unlock the app, then
  open `/owner?code=<DEBUG_CODE>`. It shows what's configured (with a warning
  if Upstash isn't connected), the last 14 days of usage, and buttons that run
  the evals on the live app: box placement and checking work, on each tutor.
  A run takes a few minutes; tap **Copy results** and paste it to your
  developer. Without `EVAL_BYPASS_TOKEN` the runs on the tutor that isn't the
  default stay greyed out: the app then ignores which tutor a run asks for.
- **See how it's being used.** With Upstash connected, open
  `/api/usage?code=<DEBUG_CODE>` (while logged in past the access gate). It
  shows, per day: how many devices, sessions (photo or typed), checks and
  their verdicts, hint/explain/go-deeper turns, solves, practice, which tutor
  ran, average response times, errors, and how often the limits were hit.
  Anonymous by design: no problem text, photos or IP addresses are stored.
  Kept 90 days.
- **Watch spend** in the Anthropic and DeepSeek consoles and set a monthly
  limit in each. That is the hard backstop; the app shows "The tutor is taking
  a break" when one is hit.

## Accounts (optional): sign-in and history on every device

Until these steps are done, MindGap has no accounts and keeps everything on
the student's device. After them, students can sign in with Google or an
emailed link, and their problems follow them to every device. Each value
below says whether it's a **secret** (turn Vercel's *Sensitive* on, never
share it) or **config** (safe to show anyone).

1. **Create the database.** Vercel → your project → **Storage** → Create
   Database → **Supabase** → free plan, a region near your students → connect
   it to this project, all environments. Vercel adds:
   - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or
     `…_PUBLISHABLE_KEY`): **config**. Public by design; the database's rules
     are what keep each student's data private.
   - `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`): **secret**.
     Server-only; it records the 13+ check and deletes accounts.
2. **Create the tables.** Open the Supabase dashboard (Vercel → Storage →
   your database → *Open in Supabase*) → **SQL Editor** → paste all of
   `supabase/migrations/0001_accounts.sql` → **Run**. It's safe to run again.
3. **Tell Supabase where MindGap lives.** Supabase → **Authentication → URL
   Configuration**: *Site URL* `https://<your-app>.vercel.app`, and under
   *Redirect URLs* add `https://<your-app>.vercel.app/**`.
4. **Make the email link work on phones.** Supabase → **Authentication →
   Email Templates** → *Magic Link* (and *Confirm signup*): change the link to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`.
   Without this, a link opened in the mail app's own browser fails.
5. **Google sign-in.** In Google Cloud Console → APIs & Services →
   Credentials → *Create OAuth client ID* (Web application). Authorized
   redirect URI: the callback URL Supabase shows under **Authentication →
   Providers → Google**. Paste the client ID (**config**) and client secret
   (**secret**) into that Supabase page and enable Google. These live in
   Supabase, not in Vercel.
6. **Send emails properly.** Supabase's built-in email only sends a few an
   hour, fine for testing. For real use, make a free [Resend](https://resend.com)
   account and enter it under Supabase → **Authentication → SMTP Settings**.
   Its API key is a **secret** (stored in Supabase).
7. **Redeploy** (Deployments → ⋯ → Redeploy). Then on your phone: tap
   **Sign in** on home, continue with Google, confirm your age, solve a
   problem; sign in on a laptop and it's there.

To delete everything a student saved: they use Account → Delete account. In
an emergency, delete the user in Supabase → Authentication → Users (their
rows go with it; photos are in Storage → `photos/<user id>/`).

## Debugging from your phone

If something errors, set these env vars in Vercel (Settings → Environment
Variables), redeploy, and reproduce — then turn them off again:

- `DEBUG_ERRORS=1` — API error responses include the real underlying cause
  (message + status), so you see it in the browser instead of the generic
  message. (Exposes error internals — leave off normally.)
- `DEBUG_TOKENS=1` — logs per-call token usage and cache hits to the Vercel
  function logs (confirms prompt caching is working: `cache_read` > 0 on repeat
  turns of the same problem).

## Local vs. hosted

- Local (`npm run dev` / `start`) reads `.env.local` — good for solo testing.
- Hosted (Vercel) reads the dashboard env vars — good for sharing.
Both use the exact same code path; `/api/health?code=<DEBUG_CODE>` tells you
which key each is using.

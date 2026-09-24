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
   should show `{"provider":"anthropic","keyDetected":true,…}`.
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
  every edit to the list logs everyone out. `ACCESS_CODE` keeps working
  alongside the list as a code that never expires. If the list has a typo so
  that no entry parses, the gate stays closed — it never silently opens.
- **Watch spend** in the Anthropic console and set a billing limit there.

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
Both use the exact same code path; `/api/health` tells you which key each is
using.

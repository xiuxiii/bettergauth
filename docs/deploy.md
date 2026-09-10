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
- **Watch spend** in the Anthropic console and set a billing limit there.

## Local vs. hosted

- Local (`npm run dev` / `start`) reads `.env.local` — good for solo testing.
- Hosted (Vercel) reads the dashboard env vars — good for sharing.
Both use the exact same code path; `/api/health` tells you which key each is
using.

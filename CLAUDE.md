# MindGap

Mobile-first AI STEM tutor. A student photographs a problem; the app diagnoses the
first point where *their* reasoning diverges rather than handing back an answer.
Next.js 15 (App Router) + TypeScript + Tailwind, deployed on Vercel.

## Commands

```bash
npm run dev      # local dev
npm run build    # production build (run before every push)
npm run lint
npx tsc --noEmit # typecheck
```

There are no tests. `npx tsc --noEmit && npm run build` is the verification gate.

## Environment

| Var | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Required. Without it the provider reports `provider: "none"` at `/api/health`. |
| `ANTHROPIC_MODEL` | Overrides the `claude-sonnet-5` default. |
| `ACCESS_CODE` | Shared-access gate. **Unset = gate disabled**, so local dev just works. |
| `RATE_LIMIT_PER_MIN` | Per-IP fixed window, default 30. |
| `DEBUG_ERRORS` | Surfaces the underlying error detail to the client. Off in normal use. |
| `DEBUG_TOKENS` | Logs per-call token usage, including whether prompt caching is hitting. |
| `AI_PROVIDER` | Defaults to `anthropic`, the only implemented provider. Any other value throws at startup. |

Vercel applies env vars **at build time** — after adding one, redeploy or it won't
be picked up.

---

## Gotchas

These each cost real time. Read before repeating them.

### Never use `pkill -f` to stop a dev server — it kills your own shell

`pkill -f` matches full command lines, *including the argv of the shell running it*.
`pkill -f "next-server"` finds `next-server` in its own command line and kills the
shell. The call dies with exit 144 and **every command after it on that line is
silently lost** — this ate a `git commit` more than once.

The `[n]ext-server` bracket trick only works if the bare string appears exactly
once in the whole command; a later `echo` or `pgrep` containing it re-breaks it.

Kill by port instead:

```bash
fuser -k 3100/tcp        # verified: server dies, shell survives
lsof -ti:3100 | xargs -r kill -9   # if fuser is unavailable
```

### Delete a route → `rm -rf .next` before typechecking

Next leaves generated types behind. After removing e.g. `app/dev-preview/`,
`npx tsc --noEmit` fails with:

```
.next/types/app/dev-preview/page.ts(2,24): error TS2307: Cannot find module ...
```

The source file is genuinely gone; the stale type isn't. `rm -rf .next` clears it.
Don't go hunting for a real type error.

### Vercel build logs are not readable from here

The session's Vercel token can list deployments but returns **403** on deployment
events. To diagnose a failed build, check out the failing SHA and build it locally
instead of trying to read logs.

### The deployed URL is not reachable from this container

Fetching the live Vercel URL returns `EGRESS_BLOCKED`. Verification of deployed
behaviour has to come from the user, or from a local `npm run start`.

---

## Things that are the way they are on purpose

**Images are normalized client-side, and the size is not arbitrary.**
`lib/image.ts` caps the long edge at 2200px / JPEG 0.85. Sonnet 5 is on the
high-resolution vision tier: 2576px long edge **and** 4784 visual tokens, a token
being a 28x28 patch. For the 4:3 and 3:4 shapes phone cameras produce the token cap
binds first, around 2240px, so 2200 is the most that survives without the server
re-downscaling it. Raising it spends upload bytes on pixels the model never sees.

**Every image path must go through `fileToNormalizedJpeg`.**
A raw phone photo as a data URL is ~7.8MB of base64, over Vercel's 4.5MB request
limit. The rejection arrives as plain-text `Request Entity Too Large`, not JSON.

**Never build a client error message with `(await res.json())?.error`.**
On a non-JSON body that parse throws, and the SyntaxError *replaces* the real
failure — that's where `Unexpected token 'R', "Request En"...` came from. Use
`readApiError` in `lib/apiClient.ts`, which handles 413/429/401/5xx.

**Captures are never auto-cropped.** `components/QuestionCropper.tsx` asks the model
to box each question and hands the student a draggable box. The Otsu ink-bounding-box
heuristic in `lib/image.ts` survives *only* as that cropper's offline fallback, where
it seeds an editable box. It must never decide a crop on its own — it was wrong often
enough that silent cropping was the bug.

**Tinted surfaces use CSS variables, not fixed hex.** The `brand`/`danger`/`warn`/
`success` tint steps (50/100/200) and on-tint text steps (700/800/900) are theme
variables so they flip in dark mode; the mid brand steps (300-600) stay fixed indigo
so buttons keep the brand colour. Adding a literal hex tint will render as a glaring
white slab on the dark theme.

**The tutor's formatting is prompt-enforced.** `SYSTEM_INSTRUCTIONS` in
`lib/tutor/engine.ts` and `STYLE_NOTE` in `lib/ai/anthropicProvider.ts` ask for short
blank-line-separated paragraphs, `## ` section labels, and lists. `components/RichText.tsx`
is the renderer that turns them into real blocks. Change one and check the other, or
markdown will leak into the UI as literal dashes.

## Git

Work on `claude/ai-stem-tutor-app-6vpyfh`; push with `git push -u origin <branch>`.
Pushes auto-deploy to Vercel. Don't open a PR unless asked.

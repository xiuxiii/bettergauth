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
| `DETECTION_MODEL` | Question detection only. Unset = same as `ANTHROPIC_MODEL`. Exists to A/B a faster model (e.g. `claude-haiku-4-5`) on the box-finding call without touching tutoring. |
| `ACCESS_CODE` | Shared-access gate, a code that never expires. **Gate is off only when this AND `ACCESS_CODES` are unset**, so local dev just works. |
| `ACCESS_CODES` | Per-person codes with expiries: `maya:2026-10-31, class:never` (date = through end of day UTC, or ISO time, or `never`). Expiry is read from the list on every request, so cancelling/extending applies to people already in. Nothing parses → gate stays **closed**, never open. |
| `ACCESS_SECRET` | Key for the access cookie, which names a code by an HMAC id and never contains it (`lib/accessToken.ts`). Unset = the key is `ACCESS_CODE`, else derived from the list — so **set it when using `ACCESS_CODES`**, or every list edit logs everyone out. |
| `RATE_LIMIT_PER_MIN` | Per-IP fixed window, default 30. A burst brake. |
| `RATE_LIMIT_PER_DAY` | Per-IP 24h cap, default 150 — the real spend ceiling. Counts only admitted requests. In memory per warm instance for now; `lib/rateLimit.ts` has the TODO for Upstash/Vercel KV. |
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

**Detection and analysis get different image sizes, on purpose.** `MAX_DIM` (2200)
is for analysis, which has to read handwriting. `DETECT_MAX_DIM` (1600) is for
question detection, which only has to find boxes and read printed numbers — at 2200
it was paying 4661 visual tokens for a layout task, versus 2494 at 1600. The boxes
come back in the pixel space of the image actually sent, so `imageForDetection`
returns its own width/height: sending the preview's 2200px dimensions alongside a
1600px image would scale every box by 0.73 and land them on the wrong questions.

**Every image path must go through `fileToNormalizedJpeg`.**
A raw phone photo as a data URL is ~7.8MB of base64, over Vercel's 4.5MB request
limit. The rejection arrives as plain-text `Request Entity Too Large`, not JSON.

**Never build a client error message with `(await res.json())?.error`.**
On a non-JSON body that parse throws, and the SyntaxError *replaces* the real
failure — that's where `Unexpected token 'R', "Request En"...` came from. Use
`readApiError` in `lib/apiClient.ts`, which handles 413/429/401/5xx.

**Client API calls go through `apiFetch` (`lib/apiClient.ts`).** When the
connection drops before any response, `fetch` rejects with the browser's own
wording — "Failed to fetch", "Load failed" — and that went raw onto the error card.
`apiFetch` tags it as a `NetworkError` whose message is human. Don't detect this
afterwards by `instanceof TypeError`: a plain code bug is also a TypeError, and it
would be disguised as "check your connection".

**The not-a-question gate fails open.** `hasStemContent` is asked of detection
(cheap, before the student confirms) and again of analysis (for a quick tap that
beats detection). Only an explicit `false` blocks; a missing field never turns a
real problem away, and the cropper overlay keeps a "Use this photo anyway" link
for a faint page misread as empty.

**A photo with working starts the check alongside the analysis, not after.**
Detection marks each question `hasWorking`; if the chosen one has it, the cropper
passes a hint (`WORK_HINT_KEY`) and `runAnalysis` fires `/api/check-work` in
parallel with `/api/analyze`, sending a placeholder problem (`PROBLEM_FROM_PHOTO`)
since the check reads the printed question off the same photo. The analysis
still decides: no work, or no problem at all, aborts the early check and ignores
it; a failed early check retries through the normal path with the real extracted
problem. Never in Ask mode. Measured with the live timings (analyze ~3.9s, check
~7.1s): 12.0s to feedback sequentially, 8.0s in parallel. A wrong `hasWorking`
costs one wasted check call, which is the trade.

**Tutor turns read `prefsRef`, not the `prefs` state.** The opening turns are
fired from inside `runAnalysis`, a callback created once on mount, so reading
state there gets the first render's defaults. Measured: with plain state, Ask
mode's first request carried `grade: null` and no curriculum.

**Captures are never auto-cropped.** `components/QuestionCropper.tsx` asks the model
to box each question and hands the student a draggable box. The Otsu ink-bounding-box
heuristic in `lib/image.ts` survives *only* as that cropper's offline fallback, where
it seeds an editable box. It must never decide a crop on its own — it was wrong often
enough that silent cropping was the bug.

**History lives in IndexedDB as Blobs, never localStorage.** Measured: a
normalized worksheet photo is ~367KB as JPEG, ~489KB as a base64 data URL, so
localStorage's ~5MB quota holds about ten — the whole quota, shared with
preferences. Photos sit in their own object store and each record carries a 240px
thumbnail inline (~3KB, 60x smaller), so listing the history never reads the
photos. Every storage call is guarded: blocked site data must degrade to "no
history", never throw. `syncedAt` on each record is the unused hook for adding a
backend later.

**The theme is resolved before first paint, by an inline script.** `data-theme`
on `<html>` selects the dark variable block in `globals.css` — there is no
`prefers-color-scheme` media query any more, because THEME_INIT_SCRIPT
(`lib/theme.ts`) resolves "system" to a concrete value in `<head>`. That keeps
ONE dark block instead of two that drift. Theme must NOT move into
`lib/preferences.ts`: those load in a `useEffect` after hydration, far too late
to colour the first frame, and the result is a dark flash for light-mode users.
Tailwind's `darkMode` points at the same attribute, so `dark:` utilities follow
the toggle rather than the OS.

**Tinted surfaces use CSS variables, not fixed hex.** The `brand`/`danger`/`warn`/
`success` tint steps (50/100/200) and on-tint text steps (700/800/900) are theme
variables so they flip in dark mode; the mid brand steps (300-600) stay fixed indigo
so buttons keep the brand colour. Adding a literal hex tint will render as a glaring
white slab on the dark theme.

The flip cuts the other way for **solid button fills**: never use a 700 step (or
`danger-600`) as a fill behind white text. `brand-700` becomes #A2ACF6 in dark
mode, which put white button text at 2.15:1 on every hover and tap; `danger-600`/
`-700` become pale salmon (2.48:1 at rest, 1.79:1 on hover). Solid fills use the
fixed tokens: `bg-brand-600` at rest, `hover:`/`active:bg-accent-deep` (#3F44BE,
7.55:1); destructive buttons `bg-danger-solid` / `hover:bg-danger-deep` (5.55:1 /
7.36:1). Those are the old light-mode values, so light mode is unchanged. Keep the
700 steps for on-tint TEXT only.

**The tutor's formatting is prompt-enforced.** `SYSTEM_INSTRUCTIONS` in
`lib/tutor/engine.ts` and `STYLE_NOTE` in `lib/ai/anthropicProvider.ts` ask for short
blank-line-separated paragraphs, `## ` section labels, and lists. `components/RichText.tsx`
is the renderer that turns them into real blocks. Change one and check the other, or
markdown will leak into the UI as literal dashes.

## Git

Work on `claude/ai-stem-tutor-app-6vpyfh`; push with `git push -u origin <branch>`.
Pushes auto-deploy to Vercel. Don't open a PR unless asked.

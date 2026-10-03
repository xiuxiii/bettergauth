# MindGap

A mobile-first web app where a high-school student snaps a photo of a STEM
problem and gets a tutor that focuses on **conceptual understanding**, not
step-by-step hand-holding. It hands over one small piece at a time so the student
fills the gap themselves, adapts to what they demonstrate, and gives a full
worked solution on request.

## Quick start

```bash
npm install
# .env.local:  DEEPSEEK_API_KEY=sk-...  and/or  ANTHROPIC_API_KEY=sk-ant-...
npm run dev        # http://localhost:3000
# or: npm run build && npm run start
```

Confirm the provider is live at `http://localhost:3000/api/health` →
`{"provider":"deepseek","keyDetected":true,…}` (or `"anthropic"`). Restart the server after
changing env (env is read at boot). See `.env.example` and
`docs/ai-provider-integration.md`.

## What's built

- **Settings** (`app/settings/page.tsx`, `components/SettingsView.tsx`) —
  grouped rows (Tutoring, About you, App) that save as they change: help
  style, focus, grade, curriculum, appearance, and the DeepSeek / Claude switch
  when both keys are set and `TUTOR_SWITCH=on`. First-run visitors get the same questions as the
  welcome tour (`/welcome`). Preferences are stored in `localStorage` and folded
  into the tutor's system prompt. No subject picker — the model detects the
  subject. `/setup` redirects here.
- **Home** (`app/page.tsx`) — "Snap a problem" / "Upload a photo", or type or
  paste a problem (sent to `/api/analyze` as text). Below: recent sessions and
  the concepts to work on, each with "Practice this". Both photo paths open the
  **question cropper** (`components/QuestionCropper.tsx`): the questions on the
  page are located (`/api/detect-questions` → `AIProvider.detectQuestions`, with
  a local ink-bounding-box fallback), the most likely one is boxed, and the
  student can switch between detected questions, adjust the box, and confirm.
  The box is seeded instantly from a local ink bounding box and the model's
  detection refines it in the background, so the screen is usable from the
  first frame. An "Ask a specific question" switch there turns the capture into
  Ask mode. The confirmed crop then enters the normal analysis flow.
- **Workspace** (`components/TutorWorkspace.tsx`) — shows the uploaded image, the
  detected problem, subject, and a safe label for the concept (the key idea
  stays hidden until the gap is closed), then runs the session. The session popover (`SessionToggles`) flips help style and focus (and the
  tutor, when `TUTOR_SWITCH=on`) mid-problem, from the next request on. Loading / error / empty states throughout.
- **Chunked tutoring** — conceptual turns deliver ONE small piece, then a
  **Continue** button fetches the next. Free-text follow-ups are always
  available. The action bar shows at most three chips picked by the session's
  stage (Go deeper in every stage), with the rest, including **Show
  solution**, under **More**. Each is a `TutorAction` signal to the one
  `tutor()` engine.
- **Structured solution** (`components/SolutionCard.tsx`) — Problem understanding
  → Key concept → Reasoning → Solution → Final answer → Important takeaway.
- **Check My Work** (`components/AttemptComposer.tsx`, `WorkCheckCard.tsx`) —
  photograph an attempt; the tutor finds the **first meaningful error** and
  reveals it a tap at a time: the flagged line and a nudge, then the fix, then
  the rest of the way (the only place the final answer appears). **Try again**
  re-checks just that step, typed or photographed. Via
  `AIProvider.checkWorkStream` (`/api/check-work`, streamed NDJSON).
- **Practice** (`components/PracticeCard.tsx`) — a fresh problem on the same
  concept with different numbers; the student solves it independently (solution
  withheld until submit), then it's scored across five axes. Via
  `AIProvider.generatePractice` / `evaluatePractice`.

## Architecture

```
UI (React components)  ─►  API routes (server)  ─►  AI provider abstraction
  never sees keys           only place that            AnthropicProvider
                            touches the provider        (swappable interface)
```

| Layer | Location | Responsibility |
| --- | --- | --- |
| UI | `components/`, `app/` | Rendering + interaction. Talks to the server via `fetch`; only consumes domain types. |
| Tutoring logic | `lib/tutor/` | Domain types (`types.ts`) and the engine/system prompt (`engine.ts`). |
| AI provider | `lib/ai/` | `AIProvider` interface, `AnthropicProvider`, and a server-only `getProvider()` factory. |
| Server boundary | `app/api/*` | The only code that constructs/calls a provider, so **keys never reach the client**. |

### Data flow

1. Home reads the image to a data URL (`sessionStorage`), routes to `/workspace`.
2. Workspace `POST /api/analyze` → `ProblemAnalysis` (text, subject, topic,
   concept).
3. Each tutor turn `POST /api/tutor` with the problem, history, an `action`
   (`ask` / `continue` / `hint` / `explain` / `go_deeper` / `show_solution` /
   `similar_problem`) and the student's `preferences` → a `TutorTurn` (message +
   optional solution / similar problem + `hasMore`).

The provider (`lib/ai/anthropicProvider.ts`) maps the model's Zod-validated
structured output into the domain types — nothing model-specific reaches the UI.

## Using / configuring the model

The real provider is implemented in `lib/ai/anthropicProvider.ts` (Anthropic SDK
+ Zod structured outputs). Config is env-only:

- `DEEPSEEK_API_KEY` — DeepSeek (`lib/ai/deepseekProvider.ts`), the cheaper
  default when set. See `docs/ai-provider-integration.md`.
- `ANTHROPIC_API_KEY` — Claude; required unless DeepSeek is set, and the photo
  backup when both are. Server-side only.
- `ANTHROPIC_MODEL` — optional, defaults to `claude-sonnet-5` (cheaper; set
  `claude-opus-5` for more headroom).
- `DETECTION_MODEL` — optional, question detection only; unset means the same
  model as above.
- `ACCESS_CODE` — optional shared code that gates the app (protects your API
  credits on a public URL). Unset = no gate. See `docs/deploy.md`.

The full env list (rate limiting, debug flags) is in `.env.example` and the
table in `CLAUDE.md`. Full schema:
**`docs/ai-provider-integration.md`**. Deploying so
others can test it: **`docs/deploy.md`**.

## Not included (by design)

No authentication, payments, database, or analytics. Preferences live in the
browser's `localStorage`.

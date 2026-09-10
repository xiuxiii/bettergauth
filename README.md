# Aria — AI STEM Tutor

A mobile-first web app where a high-school student snaps a photo of a STEM
problem and gets a tutor that focuses on **conceptual understanding**, not
step-by-step hand-holding. It hands over one small piece at a time so the student
fills the gap themselves, adapts to what they demonstrate, and gives a full
worked solution on request.

Runs on a real **Claude vision model**. Needs an Anthropic API key.

## Quick start

```bash
npm install
# .env.local:  ANTHROPIC_API_KEY=sk-ant-...   (required)
npm run dev        # http://localhost:3000
# or: npm run build && npm run start
```

Confirm the provider is live at `http://localhost:3000/api/health` →
`{"provider":"anthropic","keyDetected":true,…}`. Restart the server after
changing env (env is read at boot). See `.env.example` and
`docs/ai-provider-integration.md`.

## What's built

- **Setup** (`app/setup/page.tsx`) — a first-run page that captures light
  preferences (grade for loose calibration, hints-vs-direct, goal). Stored in
  `localStorage` and folded into the tutor's system prompt. No subject picker —
  the model detects the subject.
- **Home** (`app/page.tsx`) — "Take a photo" / "Upload problem".
- **Workspace** (`components/TutorWorkspace.tsx`) — shows the uploaded image, the
  detected problem, subject/topic, and the identified concept, then runs the
  session. In-session toggles (`SessionToggles`) flip help style and goal
  mid-problem. Loading / error / empty states throughout.
- **Chunked tutoring** — conceptual turns deliver ONE small piece, then a
  **Continue** button fetches the next. Free-text follow-ups are always
  available. The assistance ladder (**Hint → Explain why → Go deeper → Show
  solution**, plus **Try a similar problem**) are `TutorAction` signals to the
  one `tutor()` engine.
- **Structured solution** (`components/SolutionCard.tsx`) — Problem understanding
  → Key concept → Reasoning → Solution → Final answer → Important takeaway.
- **Check My Work** (`components/AttemptComposer.tsx`, `WorkCheckCard.tsx`) —
  type or photograph an attempt; the tutor finds the **first meaningful error**,
  classifies it, and (when the concept is right) keeps the fix to one line
  instead of a lecture. Via `AIProvider.checkWork` (`/api/check-work`).
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
| Tutoring logic | `lib/tutor/` | Domain types (`types.ts`), the engine/system prompt (`engine.ts`), and the state design (`state.ts`). |
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

- `ANTHROPIC_API_KEY` — required, server-side only.
- `ANTHROPIC_MODEL` — optional, defaults to `claude-opus-5`.

Full schema and tuning notes: **`docs/ai-provider-integration.md`**. Deploying so
others can test it: **`docs/deploy.md`**.

## Not included (by design)

No authentication, payments, database, or analytics. Preferences live in the
browser's `localStorage`.

# Aria — AI STEM Tutor (MVP prototype)

A mobile-first web app where a high-school student snaps a photo of a STEM
problem and gets a tutor that focuses on **conceptual understanding**, not
step-by-step hand-holding. It adapts its depth to what the student demonstrates,
explains directly when that's faster than asking questions, and gives a full
worked solution on request.

> This prototype runs entirely on a **mock AI service** — no API key, no network
> model calls. The whole UI and interaction flow are exercisable today, and a
> real model can be dropped in behind a single interface later.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
# or: npm run build && npm run start
```

No environment variables are required. `AI_PROVIDER` defaults to `mock`
(see `.env.example`).

## What's built

- **Home** (`app/page.tsx`) — logo placeholder, "Take a photo" (camera capture
  on mobile) and "Upload problem", clean mobile-first layout.
- **Workspace** (`components/TutorWorkspace.tsx`) — shows the uploaded image, the
  detected problem, and the detected subject/topic, then runs the tutoring
  session. Includes loading, error (with retry), and empty states.
- **Tutor interface** — chat between student and tutor, LaTeX math via KaTeX,
  free-text follow-ups, and buttons for **Hint**, **Explain this**,
  **Show solution**, and **Try a similar problem**.
- **Structured solution** (`components/SolutionCard.tsx`) — Problem understanding
  → Key concept → Reasoning → Solution → Final answer → Important takeaway. Shown
  only when the student asks for it.

## Architecture

Three layers, deliberately kept from leaking into each other:

```
UI (React components)  ─►  API routes (server)  ─►  AI provider abstraction
  never sees keys           only place that            swappable; mock now,
                            touches the provider        real model later
```

| Layer | Location | Responsibility |
| --- | --- | --- |
| UI | `components/`, `app/page.tsx`, `app/workspace/` | Rendering + interaction only. Talks to the server via `fetch`. |
| Tutoring logic | `lib/tutor/` | Domain types and the **teaching philosophy** (`philosophy.ts`) — the "how we teach" contract, model-independent. |
| AI provider | `lib/ai/` | `AIProvider` interface, `MockProvider`, and a server-only `getProvider()` factory. |
| Server boundary | `app/api/analyze`, `app/api/tutor` | The only code that constructs/calls a provider, so **keys never reach the client**. |

### Data flow

1. Home reads the image to a data URL, stores it in `sessionStorage`, routes to
   `/workspace`.
2. Workspace `POST /api/analyze` → `ProblemAnalysis` (detected text, subject,
   topic).
3. Each tutor turn `POST /api/tutor` with the problem, conversation history, and
   an action (`ask` / `hint` / `explain` / `show_solution` / `similar_problem`)
   → a `TutorTurn` (message + optional structured solution / similar problem).

### The mock provider

`lib/ai/mockProvider.ts` returns realistic, structured content for three seeded
problems (physics energy conservation, a quadratic, and stoichiometry) and picks
one deterministically from the image. It mirrors the philosophy: a concept-first
opener, brief hints, direct explanations, a full structured solution on request,
and **adaptive** free-text replies that branch on an understanding estimate
(`lib/tutor/philosophy.ts`).

## Swapping in a real model later

1. Implement `AIProvider` in e.g. `lib/ai/anthropicProvider.ts`, reading its key
   from `process.env` inside the constructor (server-only).
2. Add a `case` in `getProvider()` (`lib/ai/provider.ts`) keyed on `AI_PROVIDER`.
3. Set `AI_PROVIDER` and the key in `.env`.

No UI or route changes are required — `SYSTEM_PROMPT` in `philosophy.ts` is ready
to pass to the model.

## Not included (by design)

No authentication, payments, database, or analytics — this is a focused
prototype of the tutoring experience.

## Next logical step

Wire up a real vision-capable model behind the existing `AIProvider` interface:
real OCR/classification in `analyzeProblem`, and streaming tutor turns driven by
`SYSTEM_PROMPT` plus the conversation history in `tutor`. Everything else — the
UI, the action model, the structured-solution contract — stays as-is.

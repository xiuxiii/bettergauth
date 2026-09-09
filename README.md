# Aria — AI STEM Tutor (MVP prototype)

A mobile-first web app where a high-school student snaps a photo of a STEM
problem and gets a tutor that focuses on **conceptual understanding**, not
step-by-step hand-holding. It adapts its depth to what the student demonstrates,
explains directly when that's faster than asking questions, and gives a full
worked solution on request.

> Set `ANTHROPIC_API_KEY` and it runs on the **real Claude vision model**; with
> no key it falls back to an offline **mock** so the whole UI is still
> exercisable. Both sit behind one provider interface — see
> [Using the real Claude vision model](#using-the-real-claude-vision-model).

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
# or: npm run build && npm run start
```

No environment variables are required. `AI_PROVIDER` defaults to `mock`
(see `.env.example`).

## Evaluating the tutor

```bash
npm run eval:tutor
```

Runs 25 STEM scenarios (`test/scenarios.mjs`) against the real classifier and a
mirror of the mock's conversational logic, and reports where the tutor diverges
from the philosophy. It's the acceptance test for a real provider — see
`docs/tutoring-eval.md` for the current findings (the default chat path fails
most scenarios; the buttons, check-work, and practice pass).

## What's built

- **Home** (`app/page.tsx`) — logo placeholder, "Take a photo" (camera capture
  on mobile) and "Upload problem", clean mobile-first layout.
- **Workspace** (`components/TutorWorkspace.tsx`) — shows the uploaded image, the
  detected problem, and the detected subject/topic, then runs the tutoring
  session. Includes loading, error (with retry), and empty states.
- **Tutor interface** — chat between student and tutor, LaTeX math via KaTeX,
  free-text follow-ups (always available — the default), and a lightweight
  **level-of-assistance ladder**: **Hint → Explain why → Go deeper → Show
  solution**, plus **Try a similar problem**. These aren't separate systems —
  each is just a `TutorAction` signal to the one `tutor()` engine (`go_deeper`
  raises the depth on the current concept), so they map straight onto a real
  provider later.
- **Structured solution** (`components/SolutionCard.tsx`) — Problem understanding
  → Key concept → Reasoning → Solution → Final answer → Important takeaway. Shown
  only when the student asks for it.
- **Check My Work** (`components/AttemptComposer.tsx`, `WorkCheckCard.tsx`) — the
  student types or photographs their attempt; the tutor finds the **first
  meaningful error** (not just a wrong final answer), classifies it (conceptual /
  wrong model / setup / procedural / arithmetic / units), and shows how to
  continue. Trivial slips are styled quietly and flagged "concept is right", so a
  correct idea with a multiplication error gets a one-line fix, not a lecture;
  a wrong model gets a prominent explanation of *why* it doesn't apply. Diagnosis
  runs through `AIProvider.checkWork` (`/api/check-work`); the mock covers correct,
  concept-right-but-arithmetic, wrong-equation, wrong-assumption, chemistry- and
  algebra-misconception, and partially-correct scenarios (see
  `lib/ai/mockProvider.ts`; type `scenario:<id>` in an attempt to force one).
- **Practice — "I'm ready, give me one like this"** (`components/PracticeCard.tsx`)
  — generates a fresh problem on the *same concept* with changed numbers/context
  (memorization is useless) at matching or slightly higher difficulty. The
  solution is withheld until the student submits, so they solve independently;
  then the attempt is evaluated across five axes (concept selection, reasoning,
  setup, execution, final answer) with concise feedback on the single most
  important issue, and the worked solution is revealed. Generation and evaluation
  run through `AIProvider.generatePractice` / `evaluatePractice`
  (`/api/practice/generate`, `/api/practice/evaluate`); the mock keeps a couple of
  variants per concept (not a database) and infers the outcome from the attempt
  (`outcome:<id>` forces one). The solution is never sent to the client before
  submission.

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

## Using the real Claude vision model

The real provider is **implemented** (`lib/ai/anthropicProvider.ts`, using the
Anthropic SDK + Zod-validated structured outputs). To go live, add one env var:

```bash
# .env.local
ANTHROPIC_API_KEY=sk-ant-...     # that's it — the provider auto-detects
# ANTHROPIC_MODEL=claude-opus-5  # optional, this is the default
```

With no key set it falls back to the offline mock. No UI or route changes are
involved — the frontend only consumes the domain types in `lib/tutor/types.ts`,
and the provider maps the model output into them. Full schema and tuning notes:
**`docs/ai-provider-integration.md`**.

## Not included (by design)

No authentication, payments, database, or analytics — this is a focused
prototype of the tutoring experience.

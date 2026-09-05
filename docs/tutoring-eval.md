# Tutoring engine evaluation

A scenario suite and a runnable harness that hold the tutor to the product
philosophy (`docs/tutoring-engine.md`): **maximize learning per minute**, be
concept-first, don't patronize, don't withhold, and don't interrogate a student
who already understands.

- **Suite:** `test/scenarios.mjs` — 25 high-school scenarios across mathematics,
  physics, and chemistry, covering all ten required edge cases. Each carries the
  problem, the student's assumed knowledge, their response, what the ideal tutor
  should recognize, the ideal response, what the tutor must *not* say, the ideal
  move (`explain` / `ask` / `hint` / `correct` / `move_on`, plus `solve` and
  `redirect` for two cases the five don't cover), and why.
- **Harness:** `test/eval.mjs` (run `npm run eval:tutor`). It exercises the
  **real** classifier (`estimateUnderstanding`, imported from source) and a
  faithful mirror of `MockProvider.respondToStudent`'s branch selection, so the
  verdicts reflect shipping code. Explicit-control, check-work, and practice
  channels are marked as separate subsystems, not the conversational engine.

## Headline result

```
PASS 8   WEAK 4   FAIL 13   (of 25)
Conversational free-form ("ask") path:  13/19 FAIL the philosophy
Understanding classifier:               12/21 labelled turns misclassified
```

The split is the story: **every explicit control, check-work, and practice
scenario passes; the default free-form chat path fails most scenarios.** The
buttons and the diagnosis subsystems are fine. The tutor's *conversation* — the
thing the product is actually about — is where it breaks.

Two root causes explain nearly every failure:

1. **`estimateUnderstanding` conflates confidence with correctness.** It is a
   keyword heuristic: a confident tone (`because`, `so`, `conserv`, length > 40)
   scores **high**; the words `why` / `how come` / `what does` force **low**.
   Correctness is never assessed. So a fluent misconception reads as mastery.
2. **`respondToStudent` has four canned branches** keyed only on that level plus
   two regexes, and returns text templated to the *problem*, not to the
   *student's words*. It cannot detect an error, honor a typed request, handle an
   off-topic turn, or change across turns.

## Findings by failure mode

### Inconsistent / actively misleading — affirms misconceptions (most serious)
`AFFIRMS_ERROR` ×3: **M6, P4, C5.**
A confident wrong or partially-wrong statement scores **high**, so the tutor
replies *"Exactly — that's the right principle, you're set up well."*
- **P4** ("energy is conserved… and since it's heavier it gets more speed") — the
  mass misconception is **ratified**.
- **C5** ("since O₂ is in excess we get a bit more than 4 mol") — the excess
  misconception is **ratified**.
- **M6** (right roots, wrong reason "√ can be negative") — the wrong reasoning
  passes as correct.
This is the worst class: the tutor doesn't just miss the error, it *endorses* it.

### Insufficiently explanatory — misses the error
`MISSES_ERROR` ×4: **M2, P3, P9, C1.**
A confidently-stated misconception that *doesn't* trip the length/keyword test
scores **medium**, yielding a generic nudge ("what do you get when you apply
that?") that never names the problem. The student's "heavier falls faster" (P3),
"normal force = weight" (P9), and "equilibrium has stopped" (C1) all sail past.

### Withholds a requested answer — anti-philosophy
`WITHHOLDS_ON_REQUEST` ×1: **M4.** A student who *types* "just give me the answer"
gets a nudge, not the solution. The brief is explicit: never withhold a requested
solution. (The **Show solution** button does the right thing — P5 — but the
free-form request doesn't route to it.)

### Patronizing / inefficient — nudging a student who's done
`REDUNDANT_NUDGE` ×4: **M1, P1, C4, P8.**
A complete, correct solution scores **high**, and the tutor still appends "push it
to the final number" — to a student who already produced the final number. **P8**
(repeated mastery) shows the compounding cost: three fluent turns get two generic
nudges then an affirmation, never once just moving on. *This is the case that
matters most for the "don't optimize for interaction" instruction: the fix is to
say **less**, not more.*

### Nudge instead of explaining a terminology question
`NUDGE_INSTEAD_OF_EXPLAIN` ×2: **M5, C2.** "What's the difference between a root
and a factor?" and "Is a mole the same as a molecule?" are direct requests for a
definition. They score **medium** (no `why`) and get a compute-nudge instead of
the one-sentence explanation that would unblock them.

### No memory — repeats a failed explanation
`NO_MEMORY_REPETITION` ×1: **C3.** A student who says "I don't get it" three times
receives the **identical** canned explanation three times. The engine is stateless
across turns, so a repeatedly-failing student gets repetition where they need a
different representation (an analogy, a micro-example).

### No scope handling
`NO_SCOPE_HANDLING` ×1: **P7.** "When's my physics test?" is answered as though it
were about the ramp ("the thing that matters here is conservation of energy…").

### Overly generic even when it passes
`OK_BUT_GENERIC` ×2: **C6, G1** pass because a genuine "why" correctly routes to an
explanation — but the explanation is the problem's canned paragraph, identical
regardless of what the student asked. It happens to fit here; it would not fit a
narrower "why."

## The classifier, quantified

12 of 21 labelled turns are misclassified. The pattern is systematic, not random:

| Student really… | Tone | `estimateUnderstanding` | Consequence |
| --- | --- | --- | --- |
| holds a misconception | confident, long | **high** | affirmed (P4, C5, M6→) |
| holds a misconception | flat | **medium** | generic nudge (P3, P9, C1) |
| has genuinely mastered it | confident but short | **medium** | nudged, not moved-on (P8 turns 1–2) |
| asks a definition | no "why" | **medium** | nudged, not explained (M5, C2) |

Confidence is being read as understanding. For a tutor whose whole job is to find
the conceptual bottleneck, that is the wrong primitive.

## What already works (keep it)

- **Explicit assistance controls** (P5, P6, G2, G3): hint / explain / go_deeper /
  show_solution / try_similar do exactly what they say — the assistance ladder is
  sound.
- **Check-my-work** (M3, P10): the keyword diagnosis correctly calls a
  concept-right arithmetic slip *arithmetic/minor* and keeps the focus off the
  concept — the philosophy in action.
- **Direct "why" → explanation** (C6, G1): the one conversational branch that
  matches the philosophy.

The lesson: the mock is a competent *stub for structured, button-driven* flows and
a poor *conversational* tutor. That is expected — it is a mock — but the suite now
pins down exactly which behaviors are merely limited (generic text) versus
actively wrong (affirming misconceptions, withholding on request).

## Recommendations — optimize for learning efficiency, not interaction

Ordered by harm. These are the acceptance criteria for the real provider; a couple
are cheap enough to harden the mock too. Note that **three of the top four ask for
*less* or *different* interaction, not more** — the engine's problem is misdirected
effort, not insufficient effort.

1. **Separate correctness from confidence.** Never affirm on "high" without a
   correctness check. A real model infers correctness directly; the mock should at
   minimum not emit "Exactly — right principle" unless the answer matches. Fixes
   the entire `AFFIRMS_ERROR` class (the most damaging).
2. **Honor explicit textual requests.** Detect "give me the answer / just tell me"
   in the ask path and route to the full solution, exactly as the button does
   (M4). Withholding is a philosophy violation, not a safeguard.
3. **Add cross-turn state.** The engine design already specifies `TutorState`
   (`lib/tutor/state.ts`): track per-concept understanding and prior moves so a
   repeatedly-failing student gets a *new* representation (C3) and a repeatedly-
   mastering student gets moved on or levelled up (P8).
4. **Stop the reflexive trailing nudge.** On demonstrated mastery, confirm and
   stop (or offer an extension). Cut "push it to the final number" when the number
   is already there (M1, P1, C4).
5. **Answer terminology and "why" questions directly, addressing the actual
   words** — not a problem-level canned paragraph (M5, C2, and the generic-but-
   passing C6/G1).
6. **Add a light scope guard** so off-topic turns are handled honestly (P7).

All six are precisely what `SYSTEM_INSTRUCTIONS` + `TutorState` in
`lib/tutor/engine.ts` / `state.ts` were designed to drive. This suite is the
regression test that will tell us the real provider actually does them: re-run
`npm run eval:tutor` against it once a real `AIProvider` is wired in, and the
FAIL count on the `ask` path is the score to drive to zero.

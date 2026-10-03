# Connecting a real vision-capable AI model

The app runs on a real vision-capable model behind one provider interface. This
document is the exact request/response schema and the integration/config notes.

## The boundary (why the frontend is safe)

```
React components ──► /api/* routes ──► AIProvider ──► AnthropicProvider
  domain types only    domain types       the ONLY place that
                                           touches a model/keys
```

- The frontend and API routes only ever read the **domain types** in
  `lib/tutor/types.ts` (`ProblemAnalysis`, `TutorTurn`, `WorkCheck`,
  `PracticeProblem`, `PracticeEvaluation`). They never see a model's raw output.
- A provider's job is to call the model and **map its raw response into those
  domain types**. That mapping lives entirely in `lib/ai/`. So no model-specific
  format can leak to the client, and changing models never touches the UI.
- `lib/ai/provider.ts` is the single factory; it is `server-only`, so keys read
  there can never be bundled into client code.

## The interface (every capability)

`AIProvider` (`lib/ai/types.ts`) — each method takes one typed request and
returns one typed domain object:

| Capability (from the brief) | Method | Request | Response |
| --- | --- | --- | --- |
| Image input · locate each question on a page (capture-time crop) | `detectQuestions` | `DetectQuestionsRequest` | `QuestionDetection` |
| Image input · problem extraction · subject/topic classification · concept identification | `analyzeProblem` | `AnalyzeRequest` | `ProblemAnalysis` |
| Tutoring responses · follow-up questions | `tutor` | `TutorRequest` | `TutorTurn` |
| Student attempt analysis (Check My Work) | `checkWork` | `CheckWorkRequest` | `WorkCheck` |
| Similar-problem generation | `generatePractice` | `GeneratePracticeRequest` | `PracticeProblem` |
| Practice attempt evaluation | `evaluatePractice` | `EvaluatePracticeRequest` | `PracticeEvaluation` |

## Exact I/O schema

All types are defined in `lib/tutor/types.ts` — that file is the source of truth.
Summarized here field-by-field.

### Image input
Images travel as a **data URL**: `data:<mediaType>;base64,<data>` (e.g.
`data:image/png;base64,iVBOR...`). Both `analyzeProblem` and the attempt objects
carry one. A real provider splits it with `dataUrlToImagePart()`
(`lib/ai/anthropicProvider.ts`) into `{ mediaType, data }` and builds an image
content block. No other image handling is required.

### `detectQuestions(DetectQuestionsRequest) → QuestionDetection`
```
DetectQuestionsRequest { imageDataUrl: string }   // the full photographed page
QuestionDetection {
  questions: { label: string,                     // "Question 5", "3(b)", …
               rect: { x, y, w, h } }[]           // normalised 0..1 image coords
  primaryIndex: number                            // the most likely intended one
}
```
Backs the capture-time cropper (`components/QuestionCropper.tsx`): the student
sees the detected question boxed on the photo, can switch between detected
questions or adjust the box, then the crop goes to `analyzeProblem`. If this
call fails, the client falls back to a local ink bounding box, so it is never on
the critical path.

### `analyzeProblem(AnalyzeRequest) → ProblemAnalysis`
```
AnalyzeRequest  { imageDataUrl: string }        // the (cropped) problem photo
ProblemAnalysis {
  problemText: string        // extracted problem (OCR)
  subject:     "Physics" | "Chemistry" | "Biology" | "Mathematics" | "Unknown"
  topic:       string        // e.g. "Conservation of mechanical energy"
  concept:     string
  confidence:  number        // 0..1
}
```

### `tutor(TutorRequest) → TutorTurn`
```
TutorRequest {
  problem:  ProblemAnalysis
  history:  ChatMessage[]     // { id, role: "student"|"tutor", content, createdAt }
  action:   "ask" | "hint" | "explain" | "go_deeper" | "show_solution" | "similar_problem"
  studentText?: string        // present for "ask" (free-form + follow-ups)
}
TutorTurn {
  message: string             // may contain $inline$ / $$block$$ LaTeX
  solution?: StructuredSolution   // only for "show_solution"
  similarProblem?: string         // only for "similar_problem"
}
StructuredSolution { understanding, keyConcept, reasoning, solution, finalAnswer, takeaway }  // all string
```
The action is the student's level-of-assistance signal; `go_deeper` means raise
depth on the current concept. Use `SYSTEM_INSTRUCTIONS` (`lib/tutor/engine.ts`)
as the system prompt so the model follows the tutoring philosophy.

### `checkWork(CheckWorkRequest) → WorkCheck`
```
CheckWorkRequest { problem: ProblemAnalysis, attempt: StudentAttempt }
StudentAttempt   { text?: string, imageDataUrl?: string }   // typed and/or photo
```
Instruct the model to find the **first meaningful error** and classify it.

### `generatePractice(GeneratePracticeRequest) → PracticeProblem`
```
GeneratePracticeRequest { problem: ProblemAnalysis }
PracticeProblem {
  problemText, subject, topic, concept: string
  difficulty: "same" | "slightly_harder"
}
```
Same concept, changed numbers/context, matching or slightly harder. **Do not
include a solution** — the student solves it first.

### `evaluatePractice(EvaluatePracticeRequest) → PracticeEvaluation`
```
EvaluatePracticeRequest { practice: PracticeProblem, attempt: StudentAttempt }  // empty attempt = "just show me the solution"
PracticeEvaluation {
  verdict: "correct" | "partially_correct" | "incorrect"
  rubric: { axis: "concept_selection"|"reasoning"|"setup"|"execution"|"final_answer",
            status: "correct"|"minor_issue"|"incorrect"|"not_shown", note: string }[]  // all five axes
  focus: string                 // the single most important issue
  summary: string
  solution: StructuredSolution   // revealed now, after submission
}
```

## How each maps to a Claude call

Default model: **`claude-sonnet-5`** (vision-capable; cheaper than Opus). Pattern for every method:

1. **System prompt** — `SYSTEM_INSTRUCTIONS` (`lib/tutor/engine.ts`) for
   tutoring; a short task-specific system prompt for every other call.
2. **User content** — the text, plus for image inputs an image block:
   `{ type: "image", source: { type: "base64", media_type, data } }` built from
   the data URL.
3. **Structured output** — constrain the response to the exact domain shape with
   Structured Outputs: `output_config: { format: { type: "json_schema", schema } }`
   (or `client.messages.parse({...})`) using a JSON/Zod schema that mirrors the
   return type. Then validate and return it as the domain type.
4. **Errors** — on refusal or failure, throw. The API routes already translate a
   thrown error into a 4xx/5xx; the client shows its existing error states.

Notes: use streaming (`.stream()` + `.finalMessage()`) if you raise `max_tokens`
high; keep `SYSTEM_INSTRUCTIONS` stable to benefit from prompt caching.

## Status: implemented

The real provider is **implemented and wired**, not a stub:

- **`lib/ai/anthropicProvider.ts`** — the `AnthropicProvider` class. Every method
  makes a real Claude call and validates the response against a Zod schema
  mirroring the domain type (`client.messages.parse` + `zodOutputFormat`), so
  only validated domain objects leave this module. `analyzeProblem`, `checkWork`,
  and `evaluatePractice` send the image as a base64 vision block.
- **`lib/ai/provider.ts`** — constructs this provider from env.
- Dependencies: `@anthropic-ai/sdk` and `zod`.

## What you must provide to run it

- **`ANTHROPIC_API_KEY`** — your Anthropic API key (`sk-ant-...`). Required
  unless `DEEPSEEK_API_KEY` is set (see the DeepSeek section below).
  Server-side only; never sent to the client.
- **`ANTHROPIC_MODEL`** *(optional)* — defaults to `claude-sonnet-5`. Override to
  pin a different vision-capable model (e.g. `claude-opus-5`).

No authentication, database, payment, or
other infrastructure is required or added. Confirm it's live at `/api/health`.

## DeepSeek (the default when its key is set)

`lib/ai/deepseekProvider.ts` implements the same `AIProvider` contract on
DeepSeek, which costs a fraction of Claude. Configuration:

- **`DEEPSEEK_API_KEY`**: when set, DeepSeek is the default provider.
- **`DEEPSEEK_MODEL`** *(optional)*: defaults to `deepseek-flash`, which accepts
  photos. (`deepseek-chat` / `deepseek-reasoner` were retired in July 2026.)
- **`DEEPSEEK_BASE_URL`** *(optional)*: defaults to `https://api.deepseek.com`.
- **`DEEPSEEK_VISION=off`** *(optional)*: send every photo straight to Claude.
- **`AI_PROVIDER`** *(optional)*: force the default to `deepseek` or `anthropic`.

How it works:

- **Same prompts, same validation.** Schemas, system prompts and per-call text
  live in `lib/ai/shared.ts` and are used by both providers.
- **Chat Completions, not the Anthropic-compatible endpoint.** DeepSeek also
  serves `/anthropic`, but every Claude call here depends on structured outputs
  (`messages.parse` + `output_config.format`), which that endpoint doesn't
  document. So DeepSeek gets JSON mode with the schema in the prompt, is
  validated with the same Zod schemas, and gets one repair round on a miss.
- **Photos.** `deepseek-flash` reads them. If DeepSeek rejects one, or twice
  returns unusable output for it, that single call is re-run on Claude when
  `ANTHROPIC_API_KEY` is set; otherwise the student gets a 422 asking them to
  type the problem. Auth, balance (402) and rate-limit errors never fall back.
- **The switch.** Settings and the session popover have a DeepSeek / Claude
  choice (shown only when both keys are set and `TUTOR_SWITCH=on`), saved in the
  browser and sent as the `x-ai-provider` header on every AI call. The server
  honours it only for a provider whose key is set, and only when
  `TUTOR_SWITCH=on` (or on an eval request).
- Run `npm run eval` against both
  providers; the false "you're wrong" rate must stay at 0.

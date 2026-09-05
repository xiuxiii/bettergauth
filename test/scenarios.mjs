// Comprehensive scenario suite for the tutoring engine.
//
// 24 high-school STEM scenarios across mathematics, physics, and chemistry,
// covering the ten required edge cases. Each scenario is written to be checked
// against BOTH the current mock and a future real provider (see test/eval.mjs),
// and to read as documentation on its own.
//
// `channel` says which engine entry the scenario exercises:
//   "ask"                 — a free-form conversational turn (the default path;
//                           handled by MockProvider.tutor -> respondToStudent)
//   "action:<name>"       — an explicit assistance button (hint / explain /
//                           go_deeper / show_solution / similar)
//   "check_work"          — a submitted attempt (MockProvider.checkWork)
//   "practice"            — a practice submission (MockProvider.evaluatePractice)
//
// `idealMove` is one of: explain | ask | hint | correct | move_on | solve |
//   redirect. The first five are the moves named in the product brief; `solve`
//   (give the full worked solution) and `redirect` (handle an off-topic turn)
//   are added because two edge cases fall outside the five.
//
// `idealUnderstanding` (ask turns only) is what a competent classifier SHOULD
//   infer about the student's grasp of the *target concept* — used to test the
//   engine's estimateUnderstanding heuristic. It is deliberately "low" for
//   confident-sounding misconceptions.

/**
 * @typedef {Object} Scenario
 * @property {string} id
 * @property {"Mathematics"|"Physics"|"Chemistry"} subject
 * @property {string} edge            Which required edge case (or "").
 * @property {string} problem
 * @property {string} assumedKnowledge
 * @property {string} [studentResponse]
 * @property {string[]} [turns]       For multi-turn scenarios.
 * @property {"ask"|"action:hint"|"action:explain"|"action:go_deeper"|"action:show_solution"|"action:similar"|"check_work"|"practice"} channel
 * @property {string} recognize       What the ideal tutor should recognize.
 * @property {string} idealResponse
 * @property {string} shouldNotSay
 * @property {"explain"|"ask"|"hint"|"correct"|"move_on"|"solve"|"redirect"} idealMove
 * @property {string} why
 * @property {("low"|"medium"|"high"|null)} [idealUnderstanding]
 */

/** @type {Scenario[]} */
export const SCENARIOS = [
  // ---------------------------------------------------------------- Mathematics
  {
    id: "M1",
    subject: "Mathematics",
    edge: "already understands the basic concept",
    problem: "Solve for x: 2x² − 8x + 6 = 0.",
    assumedKnowledge: "Factoring, the zero-product property.",
    studentResponse:
      "Divide by 2 to get x²−4x+3=0, which factors as (x−1)(x−3)=0, so x=1 or x=3.",
    channel: "ask",
    recognize: "A complete, fluent, correct solution — nothing is missing.",
    idealResponse:
      "Confirm in one line ('exactly right'), and optionally offer a harder variant or the sum/product check.",
    shouldNotSay:
      "Re-explain the zero-product property, or ask 'what happens when you set each factor to zero?'.",
    idealMove: "move_on",
    why: "Mastery is demonstrated; any further questioning wastes the student's time.",
    idealUnderstanding: "high",
  },
  {
    id: "M2",
    subject: "Mathematics",
    edge: "subtle misconception",
    problem: "Solve for x: x² = 5x.",
    assumedKnowledge: "Basic algebra, solving linear equations.",
    studentResponse: "Divide both sides by x, so x = 5.",
    channel: "ask",
    recognize:
      "Dividing by x silently assumes x≠0 and drops the root x=0 — a real conceptual slip stated confidently.",
    idealResponse:
      "Briefly: dividing by x can lose a solution; move everything to one side and factor: x(x−5)=0 → x=0 or x=5.",
    shouldNotSay:
      "'Great, x=5!' (affirming an incomplete answer) or a long lecture on domains.",
    idealMove: "correct",
    why: "A confident tone hides a lost solution; a one-line correction fixes the idea without a lecture.",
    idealUnderstanding: "low",
  },
  {
    id: "M3",
    subject: "Mathematics",
    edge: "trivial arithmetic mistake",
    problem: "Solve for x: 3x − 7 = 8.",
    assumedKnowledge: "Isolating a variable.",
    studentResponse: "3x = 1, so x = 1/3.",
    channel: "check_work",
    recognize:
      "The method is right; they subtracted 7 instead of adding it — a pure arithmetic slip.",
    idealResponse:
      "'You subtracted 7 instead of adding — 3x = 15, so x = 5.' Then move on.",
    shouldNotSay:
      "A lecture on inverse operations, or breaking 'add 7 to both sides' into sub-steps.",
    idealMove: "correct",
    why: "A trivial slip deserves a one-clause fix, never a lesson.",
    idealUnderstanding: null,
  },
  {
    id: "M4",
    subject: "Mathematics",
    edge: "asks for the answer immediately",
    problem: "Solve for x: 2x² − 8x + 6 = 0.",
    assumedKnowledge: "Unknown — no work shown.",
    studentResponse: "just give me the answer.",
    channel: "ask",
    recognize: "An explicit request for the solution, typed as a normal message.",
    idealResponse:
      "Give the full worked solution, concept first (common factor → factor → x=1 or 3); optionally offer to check understanding after.",
    shouldNotSay:
      "'What do you think the first step is?' or any move that withholds the answer to force a Socratic path.",
    idealMove: "solve",
    why: "The brief says never withhold a requested solution; honoring the request is the efficient move.",
    idealUnderstanding: null,
  },
  {
    id: "M5",
    subject: "Mathematics",
    edge: "misunderstands terminology",
    problem: "Solve x² − 4x + 3 = 0 by factoring.",
    assumedKnowledge: "Has seen factoring but is shaky on vocabulary.",
    studentResponse: "Wait, what's the difference between a root and a factor? Aren't they the same thing?",
    channel: "ask",
    recognize: "A terminology gap: factor vs. root, not a computational block.",
    idealResponse:
      "One or two sentences: a factor is (x−1); a root is the value x=1 that makes it zero. The root is what makes the factor vanish.",
    shouldNotSay:
      "Ignore the question and nudge them to keep computing.",
    idealMove: "explain",
    why: "A direct, short definition is faster and clearer than any question here.",
    idealUnderstanding: "low",
  },
  {
    id: "M6",
    subject: "Mathematics",
    edge: "partially correct explanation",
    problem: "Solve x² − 4x + 3 = 0 with the quadratic formula.",
    assumedKnowledge: "Knows the quadratic formula.",
    studentResponse:
      "Discriminant is 16−12=4, so x=(4±2)/2, giving x=3 or x=1. The ± is there because square roots can be negative.",
    channel: "ask",
    recognize:
      "The answer and computation are correct, but the stated reason ('square roots can be negative') is a subtle misconception — √ denotes the nonnegative root; the ± comes from the derivation.",
    idealResponse:
      "Affirm the correct roots, then fix just the reasoning: √ is nonnegative by definition; the ± is built into the formula from completing the square.",
    shouldNotSay:
      "Re-derive the whole formula, or let the wrong reasoning pass unremarked.",
    idealMove: "correct",
    why: "Right answer, wrong 'why' — correct the idea briefly without discarding what they got right.",
    idealUnderstanding: "medium",
  },

  // -------------------------------------------------------------------- Physics
  {
    id: "P1",
    subject: "Physics",
    edge: "already understands the basic concept",
    problem:
      "A 2.0 kg block is released from rest at the top of a frictionless ramp of height 1.5 m. Find its speed at the bottom.",
    assumedKnowledge: "Energy conservation, kinetic and potential energy.",
    studentResponse:
      "Energy's conserved since it's frictionless, so mgh = ½mv², v = √(2gh) = 5.4 m/s, and the mass cancels.",
    channel: "ask",
    recognize: "A complete, correct, well-justified solution including the mass-cancels insight.",
    idealResponse: "Confirm briefly; optionally ask what changes qualitatively if friction is added.",
    shouldNotSay: "Re-explain energy conservation or ask them to identify the given values.",
    idealMove: "move_on",
    why: "They've shown full command; more explanation is pure overhead.",
    idealUnderstanding: "high",
  },
  {
    id: "P2",
    subject: "Physics",
    edge: "uses a correct method but cannot explain why",
    problem:
      "A 2.0 kg block slides from rest down a frictionless ramp of height 1.5 m. Find its speed at the bottom.",
    assumedKnowledge: "Can plug into formulas; shaky on concepts.",
    studentResponse:
      "I set mgh = ½mv² and got 5.4 m/s, but I don't actually get why those two are equal.",
    channel: "ask",
    recognize:
      "Procedural fluency with a genuine conceptual gap — they can compute but not justify.",
    idealResponse:
      "Explain the why directly: with no friction the only force doing work is gravity, so all the potential energy mgh converts to kinetic ½mv²; energy just changes form.",
    shouldNotSay: "'You got the right answer, move on' — the gap is the whole point here.",
    idealMove: "explain",
    why: "The bottleneck is conceptual; a direct explanation is the efficient fix, not a question.",
    idealUnderstanding: "low",
  },
  {
    id: "P3",
    subject: "Physics",
    edge: "subtle misconception",
    problem:
      "A 2.0 kg block slides from rest down a frictionless ramp of height 1.5 m. Find its speed at the bottom.",
    assumedKnowledge: "Knows F=ma and 'heavier = more force'.",
    studentResponse:
      "The 2 kg matters here — a heavier block will be moving faster at the bottom.",
    channel: "ask",
    recognize:
      "The classic 'heavier falls faster' misconception; in mgh=½mv² the mass cancels, so speed is mass-independent.",
    idealResponse:
      "Correct it directly: mass cancels, so every block reaches the same speed down the same frictionless drop; show m dropping out of the equation.",
    shouldNotSay:
      "'Exactly — you're set up well' or any affirmation of the wrong claim.",
    idealMove: "correct",
    why: "A confident misconception must be named and corrected, not rewarded.",
    idealUnderstanding: "low",
  },
  {
    id: "P4",
    subject: "Physics",
    edge: "partially correct explanation",
    problem:
      "A 2.0 kg block slides from rest down a frictionless ramp of height 1.5 m. Find its speed at the bottom.",
    assumedKnowledge: "Knows energy conservation loosely.",
    studentResponse:
      "Energy is conserved so the potential energy turns into kinetic, and since it's heavier it gets more KE and so more speed.",
    channel: "ask",
    recognize:
      "Right principle (PE→KE) with an embedded mass misconception — a partially correct explanation.",
    idealResponse:
      "Affirm the conservation half, then correct just the mass claim: KE is larger for larger mass, but v isn't, because ½mv²=mgh makes v depend only on h.",
    shouldNotSay: "'Exactly right!' — that ratifies the misconception inside a mostly-correct statement.",
    idealMove: "correct",
    why: "Keep what's right, surgically fix what's wrong — maximum understanding per sentence.",
    idealUnderstanding: "low",
  },
  {
    id: "P5",
    subject: "Physics",
    edge: "asks for the answer immediately",
    problem:
      "A 2.0 kg block slides from rest down a frictionless ramp of height 1.5 m. Find its speed at the bottom.",
    assumedKnowledge: "Unknown.",
    studentResponse: "(presses 'Show solution')",
    channel: "action:show_solution",
    recognize: "An explicit request for the full solution via the control.",
    idealResponse: "Give the six-part structured solution, concept first.",
    shouldNotSay: "Withhold or gate it behind a question.",
    idealMove: "solve",
    why: "Explicit request; the structured solution is exactly right. (Positive control.)",
    idealUnderstanding: null,
  },
  {
    id: "P6",
    subject: "Physics",
    edge: "",
    problem:
      "A 2.0 kg block slides from rest down a frictionless ramp of height 1.5 m. Find its speed at the bottom.",
    assumedKnowledge: "Wants to keep ownership of the solve.",
    studentResponse: "(presses 'Hint')",
    channel: "action:hint",
    recognize: "A request for a minimal nudge, not the answer.",
    idealResponse: "One nudge toward the next step (set top PE equal to bottom KE); then stop.",
    shouldNotSay: "The full method dressed up as a hint.",
    idealMove: "hint",
    why: "Honor the requested assistance level exactly. (Positive control.)",
    idealUnderstanding: null,
  },
  {
    id: "P7",
    subject: "Physics",
    edge: "asks an unrelated question",
    problem:
      "A 2.0 kg block slides from rest down a frictionless ramp of height 1.5 m. Find its speed at the bottom.",
    assumedKnowledge: "N/A.",
    studentResponse: "btw do you happen to know when my physics test is?",
    channel: "ask",
    recognize: "An off-topic question the tutor has no basis to answer.",
    idealResponse:
      "Briefly say you don't have that, and offer to keep going on the problem.",
    shouldNotSay:
      "Answer as if it were about the problem ('the thing that matters here is conservation of energy…').",
    idealMove: "redirect",
    why: "Pretending an unrelated turn is on-topic is both wrong and disorienting.",
    idealUnderstanding: null,
  },
  {
    id: "P8",
    subject: "Physics",
    edge: "repeatedly demonstrates mastery",
    problem:
      "A 2.0 kg block slides from rest down a frictionless ramp of height 1.5 m. Find its speed at the bottom.",
    assumedKnowledge: "Strong; solving fluently.",
    turns: [
      "Energy's conserved, so mgh = ½mv².",
      "Right, so v = √(2gh).",
      "That's 5.4 m/s, and the mass cancels so it's independent of the 2 kg.",
    ],
    channel: "ask",
    recognize:
      "Escalating, consistent mastery across turns — the student needs less from the tutor, not the same each time.",
    idealResponse:
      "After the first confirmation, stop affirming and either move on or raise the difficulty (add friction, a curved ramp).",
    shouldNotSay:
      "The same 'Exactly — push it to the final number' every turn.",
    idealMove: "move_on",
    why: "Repeating identical praise to a mastering student is inefficient and slightly patronizing.",
    idealUnderstanding: "high",
  },
  {
    id: "P9",
    subject: "Physics",
    edge: "misunderstands terminology",
    problem: "A book rests on a table. Compare the normal force and the book's weight.",
    assumedKnowledge: "Has heard 'normal force' and 'weight'.",
    studentResponse: "Isn't the normal force just the weight? Same thing, right?",
    channel: "ask",
    recognize:
      "Conflates two distinct concepts that happen to be equal in this special case.",
    idealResponse:
      "They're equal here only because nothing else pushes vertically; normal force is the surface's push (it changes on an incline or in a lift), weight is mg.",
    shouldNotSay: "Just 'yes' — that cements the misconception.",
    idealMove: "correct",
    why: "A terminology conflation needs a crisp distinction, not agreement.",
    idealUnderstanding: "low",
  },
  {
    id: "P10",
    subject: "Physics",
    edge: "trivial arithmetic mistake",
    problem:
      "A 2.0 kg block slides from rest down a frictionless ramp of height 1.5 m. Find its speed at the bottom.",
    assumedKnowledge: "Solid on the physics.",
    studentResponse: "v = √(2·9.8·1.5) = √29.4 = 5.9 m/s",
    channel: "check_work",
    recognize: "Physics and setup are correct; only the final square root is miscomputed.",
    idealResponse: "'The physics is right — √29.4 ≈ 5.4, not 5.9.' One line, then done.",
    shouldNotSay: "Re-explain energy conservation because the final number is wrong.",
    idealMove: "correct",
    why: "Never turn a correct-concept arithmetic slip into a concept lesson.",
    idealUnderstanding: null,
  },

  // ------------------------------------------------------------------ Chemistry
  {
    id: "C1",
    subject: "Chemistry",
    edge: "subtle misconception",
    problem: "For N₂ + 3H₂ ⇌ 2NH₃ at equilibrium, describe what is happening.",
    assumedKnowledge: "Has met 'equilibrium' as a word.",
    studentResponse: "At equilibrium the reaction has stopped.",
    channel: "ask",
    recognize:
      "The 'equilibrium = stopped' misconception; the forward and reverse rates are equal and nonzero (dynamic equilibrium).",
    idealResponse:
      "Correct it: equilibrium is dynamic — both directions keep going at equal rates, so concentrations hold constant while nothing actually halts.",
    shouldNotSay: "A vague nudge that leaves the misconception intact.",
    idealMove: "correct",
    why: "A foundational misconception blocks everything downstream; name and fix it.",
    idealUnderstanding: "low",
  },
  {
    id: "C2",
    subject: "Chemistry",
    edge: "misunderstands terminology",
    problem: "How many moles of H₂O form from 4.0 mol H₂ and excess O₂ (2H₂ + O₂ → 2H₂O)?",
    assumedKnowledge: "Early on moles.",
    studentResponse: "Is a mole the same as a molecule?",
    channel: "ask",
    recognize: "Mole vs. molecule terminology gap.",
    idealResponse:
      "A mole is a count — 6.02×10²³ of something (here, molecules). One molecule is a single particle; a mole is that huge, fixed number of them.",
    shouldNotSay: "Push ahead into the ratio without resolving the vocabulary.",
    idealMove: "explain",
    why: "A short direct definition unblocks the rest of the problem immediately.",
    idealUnderstanding: "low",
  },
  {
    id: "C3",
    subject: "Chemistry",
    edge: "repeatedly fails to understand the same concept",
    problem: "How many moles of H₂O form from 4.0 mol H₂ and excess O₂ (2H₂ + O₂ → 2H₂O)?",
    assumedKnowledge: "Struggles with mole ratios.",
    turns: [
      "I don't get it.",
      "I'm still confused why it isn't 2 mol.",
      "I really don't understand the ratio thing.",
    ],
    channel: "ask",
    recognize:
      "A persistent block on the SAME concept — repeating the same explanation won't work; a different representation is needed.",
    idealResponse:
      "Switch tactics: a concrete analogy or worked micro-example (e.g. a recipe: 2 eggs make 2 pancakes, so 4 eggs make 4), not the same paragraph again.",
    shouldNotSay: "The identical explanation repeated verbatim each time.",
    idealMove: "explain",
    why: "Repetition that already failed is wasted time; adapt the representation.",
    idealUnderstanding: "low",
  },
  {
    id: "C4",
    subject: "Chemistry",
    edge: "already understands the basic concept",
    problem: "How many moles of H₂O form from 4.0 mol H₂ and excess O₂ (2H₂ + O₂ → 2H₂O)?",
    assumedKnowledge: "Comfortable with limiting reactant + ratios.",
    studentResponse:
      "H₂ is limiting since O₂ is in excess, and the H₂:H₂O ratio is 2:2 = 1:1, so 4.0 mol H₂ gives 4.0 mol H₂O.",
    channel: "ask",
    recognize: "A complete, correct, well-reasoned answer.",
    idealResponse: "Confirm; optionally ask how much O₂ was consumed as an extension.",
    shouldNotSay: "Re-explain mole ratios or limiting reactants.",
    idealMove: "move_on",
    why: "Nothing to add; confirming and stopping respects their time.",
    idealUnderstanding: "high",
  },
  {
    id: "C5",
    subject: "Chemistry",
    edge: "partially correct explanation",
    problem: "How many moles of H₂O form from 4.0 mol H₂ and excess O₂ (2H₂ + O₂ → 2H₂O)?",
    assumedKnowledge: "Knows ratios; unclear on 'excess'.",
    studentResponse:
      "The ratio is 1:1 so 4 mol, but since O₂ is in excess we get a bit more than 4 mol H₂O.",
    channel: "ask",
    recognize:
      "Correct ratio reasoning, but the 'excess → more product' misconception is layered on top.",
    idealResponse:
      "Affirm the 1:1 ratio, then correct 'excess': it only means O₂ isn't limiting; leftover O₂ can't create extra water. Answer is exactly 4.0 mol.",
    shouldNotSay: "Affirm the whole statement, or re-teach mole ratios they already have.",
    idealMove: "correct",
    why: "Preserve the correct half; excise the misconception in one stroke.",
    idealUnderstanding: "low",
  },
  {
    id: "C6",
    subject: "Chemistry",
    edge: "",
    problem: "How many moles of H₂O form from 4.0 mol H₂ and excess O₂ (2H₂ + O₂ → 2H₂O)?",
    assumedKnowledge: "Wants the underlying reason.",
    studentResponse: "why are the coefficients mole ratios and not mass ratios?",
    channel: "ask",
    recognize: "A direct 'why' about a conceptual foundation.",
    idealResponse:
      "Explain directly: a balanced equation counts particles; coefficients are numbers of molecules, and a mole is just a fixed count, so the ratio carries to moles. Masses differ per molecule, so they don't.",
    shouldNotSay: "Bounce it back as 'what do you think?' — they asked for the reason.",
    idealMove: "explain",
    why: "A 'why' deserves the reason directly, at the right depth.",
    idealUnderstanding: "low",
  },

  // ------------------------------------------------------- Assistance controls
  {
    id: "G1",
    subject: "Physics",
    edge: "",
    problem:
      "A 2.0 kg block slides from rest down a frictionless ramp of height 1.5 m. Find its speed at the bottom.",
    assumedKnowledge: "Has the method, wants the reason.",
    studentResponse: "why does the mass cancel?",
    channel: "ask",
    recognize: "A direct 'why' about a specific step.",
    idealResponse:
      "Explain directly: m multiplies both mgh and ½mv², so it divides out — gravity pulls harder on more mass but that mass is equally harder to accelerate.",
    shouldNotSay: "Turn it back into a question instead of answering.",
    idealMove: "explain",
    why: "'Why' questions want reasons, not Socratic deflection.",
    idealUnderstanding: "low",
  },
  {
    id: "G2",
    subject: "Physics",
    edge: "",
    problem:
      "A 2.0 kg block slides from rest down a frictionless ramp of height 1.5 m. Find its speed at the bottom.",
    assumedKnowledge: "Understands the surface idea, wants depth.",
    studentResponse: "(presses 'Go deeper')",
    channel: "action:go_deeper",
    recognize: "An explicit request to raise the depth on the current concept.",
    idealResponse:
      "Build from a more fundamental idea (work, conservative forces, the work–energy theorem) and end with a check.",
    shouldNotSay: "Repeat the same surface explanation at the same depth.",
    idealMove: "explain",
    why: "'Go deeper' is a depth signal; deliver a genuinely deeper layer. (Positive control.)",
    idealUnderstanding: null,
  },
  {
    id: "G3",
    subject: "Mathematics",
    edge: "",
    problem: "Solve 3x² − 12x + 9 = 0.",
    assumedKnowledge: "Just finished the problem successfully.",
    studentResponse: "(presses 'Try similar')",
    channel: "action:similar",
    recognize: "A request for a fresh problem on the same concept.",
    idealResponse: "Offer an isomorphic problem with changed numbers to test transfer.",
    shouldNotSay: "A near-identical clone that tests memory.",
    idealMove: "ask",
    why: "Lateral practice consolidates transfer. (Positive control.)",
    idealUnderstanding: null,
  },
];

import type { AIProvider } from "@/lib/ai/types";
import type {
  CheckWorkRequest,
  EvaluatePracticeRequest,
  GeneratePracticeRequest,
  PracticeEvaluation,
  PracticeProblem,
  ProblemAnalysis,
  RubricResult,
  StructuredSolution,
  TutorRequest,
  TutorTurn,
  WorkCheck,
} from "@/lib/tutor/types";
import { estimateUnderstanding } from "@/lib/tutor/philosophy";

/**
 * A mock AI provider. It returns realistic, structured tutoring content so the
 * entire UI and interaction flow can be tested without any API key or network
 * call. It deliberately mirrors the tutoring philosophy: concept-first,
 * adaptive depth, and no trivial hand-holding.
 *
 * Swapping in a real model means writing another AIProvider implementation and
 * pointing the factory at it — no UI or route changes required.
 */

interface SampleProblem {
  analysis: ProblemAnalysis;
  solution: StructuredSolution;
  /** Concept-level opener shown when the tutoring session begins. */
  opener: string;
  hint: string;
  explain: string;
  similar: string;
}

const SAMPLES: SampleProblem[] = [
  {
    analysis: {
      problemText:
        "A 2.0 kg block is released from rest at the top of a frictionless ramp of height 1.5 m. What is the block's speed at the bottom of the ramp? (Take g = 9.8 m/s².)",
      subject: "Physics",
      topic: "Conservation of mechanical energy",
      confidence: 0.93,
    },
    opener:
      "Before any numbers, the move here is to notice **which principle applies**. The ramp is frictionless and only gravity does work, so *mechanical energy is conserved*. That single decision does most of the work.\n\nWhat energy does the block have at the top versus the bottom — and why does *frictionless* matter to that choice?",
    hint:
      "The block starts at rest, so all its energy at the top is gravitational potential energy, $E = mgh$. At the bottom the height is zero, so it's all kinetic, $E = \\tfrac12 mv^2$. Conservation means those two are equal — notice the mass will cancel.",
    explain:
      "The key idea is the **work–energy** picture. Energy isn't created or destroyed; it changes *form*. On a frictionless ramp the only force doing work is gravity, which is *conservative* — the energy it stores as height ($mgh$) is fully returned as motion ($\\tfrac12 mv^2$).\n\nIf friction were present, some energy would leak away as heat, so $\\tfrac12 mv^2 < mgh$ and you couldn't equate them directly. That's why 'frictionless' is the assumption that unlocks the clean equation.",
    solution: {
      understanding:
        "A 2.0 kg block slides from rest down a frictionless ramp of height 1.5 m. We want its speed at the bottom.",
      keyConcept:
        "Conservation of mechanical energy: with no friction, gravitational potential energy converts entirely into kinetic energy.",
      reasoning:
        "At the top the block is at rest, so its energy is purely potential, $E_i = mgh$. At the bottom (height 0) it is purely kinetic, $E_f = \\tfrac12 mv^2$. Because the ramp is frictionless, $E_i = E_f$. The mass appears on both sides and cancels, so the speed does not depend on mass.",
      solution:
        "$$mgh = \\tfrac12 mv^2 \\;\\Rightarrow\\; v = \\sqrt{2gh}$$\n\n$$v = \\sqrt{2 \\cdot 9.8 \\cdot 1.5} = \\sqrt{29.4} \\approx 5.4\\ \\text{m/s}$$",
      finalAnswer: "$v \\approx 5.4\\ \\text{m/s}$",
      takeaway:
        "When only gravity does work, skip forces and kinematics — set $mgh = \\tfrac12 mv^2$. Notice mass cancels, so every object reaches the same speed down the same frictionless drop.",
    },
    similar:
      "A child slides from rest down a frictionless slide 2.0 m tall. How fast are they moving at the bottom? (Same principle — check that you still get an answer independent of mass.)",
  },
  {
    analysis: {
      problemText:
        "Solve for x: 3x² − 12x + 9 = 0.",
      subject: "Mathematics",
      topic: "Quadratic equations",
      confidence: 0.9,
    },
    opener:
      "The concept to spot first: this is a quadratic, and every quadratic has the same toolkit — factor, complete the square, or the quadratic formula. Here every term shares a factor of 3, which makes factoring the efficient route.\n\nWhat does dividing through by 3 give you, and does the result look factorable?",
    hint:
      "Divide the whole equation by 3 first: $x^2 - 4x + 3 = 0$. Now look for two numbers that multiply to $+3$ and add to $-4$.",
    explain:
      "A quadratic $ax^2+bx+c=0$ is asking where a parabola crosses zero. Factoring rewrites it as $(x-r_1)(x-r_2)=0$, and the **zero-product property** says a product is zero only when a factor is zero — so the roots are $r_1$ and $r_2$. Simplifying by the common factor of 3 first doesn't change the roots (dividing both sides by a nonzero constant), it just makes the numbers friendlier.",
    solution: {
      understanding: "We need the values of $x$ that satisfy $3x^2 - 12x + 9 = 0$.",
      keyConcept:
        "Factor out the common constant, then use the zero-product property on the factored quadratic.",
      reasoning:
        "All coefficients are divisible by 3, so divide through: $x^2 - 4x + 3 = 0$. We need two numbers multiplying to $+3$ and summing to $-4$: those are $-1$ and $-3$.",
      solution:
        "$$3x^2 - 12x + 9 = 0 \\;\\Rightarrow\\; x^2 - 4x + 3 = 0 \\;\\Rightarrow\\; (x-1)(x-3) = 0$$\n\nSo $x - 1 = 0$ or $x - 3 = 0$.",
      finalAnswer: "$x = 1$ or $x = 3$",
      takeaway:
        "Always pull out common factors before reaching for the quadratic formula — it usually turns an ugly quadratic into a factorable one.",
    },
    similar:
      "Solve $2x^2 - 8x + 6 = 0$. Try the same first move: factor out the common constant before anything else.",
  },
  {
    analysis: {
      problemText:
        "How many moles of water are produced when 4.0 mol of H₂ reacts completely with excess O₂? (2H₂ + O₂ → 2H₂O)",
      subject: "Chemistry",
      topic: "Stoichiometry (mole ratios)",
      confidence: 0.88,
    },
    opener:
      "The heart of this is the **mole ratio** from the balanced equation, not arithmetic. The coefficients $2\\!:\\!1\\!:\\!2$ are a recipe: they tell you how amounts relate. 'Excess O₂' is also a clue about which reactant limits the reaction.\n\nGiven $2\\text{H}_2 \\to 2\\text{H}_2\\text{O}$, what ratio connects hydrogen used to water made?",
    hint:
      "Look only at the coefficients linking H₂ and H₂O: they're $2:2$, i.e. $1:1$. 'Excess O₂' means oxygen never runs out, so H₂ is the limiting reactant.",
    explain:
      "A balanced equation conserves atoms, and its coefficients are **ratios of moles**, not masses. Here 2 mol H₂ makes 2 mol H₂O, a 1-to-1 relationship. Saying O₂ is in *excess* tells you it isn't the bottleneck — the amount of product is set entirely by the limiting reactant, H₂. That's the conceptual step; the multiplication afterward is trivial.",
    solution: {
      understanding:
        "4.0 mol H₂ reacts fully with excess O₂ via $2\\text{H}_2 + \\text{O}_2 \\to 2\\text{H}_2\\text{O}$; find moles of H₂O.",
      keyConcept:
        "Use the mole ratio from the balanced equation; the limiting reactant (H₂) determines the product amount.",
      reasoning:
        "The coefficients give H₂ : H₂O = 2 : 2 = 1 : 1. Because O₂ is in excess, H₂ is limiting, so every mole of H₂ yields one mole of H₂O.",
      solution:
        "$$n_{\\text{H}_2\\text{O}} = 4.0\\ \\text{mol H}_2 \\times \\frac{2\\ \\text{mol H}_2\\text{O}}{2\\ \\text{mol H}_2} = 4.0\\ \\text{mol}$$",
      finalAnswer: "$4.0$ mol of H₂O",
      takeaway:
        "Coefficients are mole ratios. Identify the limiting reactant first, then let the ratio do the conversion.",
    },
    similar:
      "Using the same reaction, how many moles of O₂ are consumed when 4.0 mol of H₂ reacts? (Watch how the ratio changes to $2:1$.)",
  },
];

// ---------------------------------------------------------------------------
// "Check My Work" scenario bank
//
// A real provider would read the student's actual attempt (text or photo) and
// diagnose it. The mock can't parse free-form work, so it selects a realistic,
// pre-authored diagnosis from keywords in the typed attempt — enough to exercise
// every branch of the UI. Deterministic override: include "scenario:<id>" in the
// attempt text to force a specific one (used by tests and the demo).
//
// Keyed by problemText so each diagnosis is relevant to the actual problem.
// ---------------------------------------------------------------------------

interface CheckScenario {
  id: string;
  /** Lowercased substrings in the attempt that select this scenario. */
  triggers: string[];
  check: WorkCheck;
}

interface CheckBankEntry {
  scenarios: CheckScenario[];
  /** Used when no trigger matches (e.g. a photo-only attempt). */
  fallback: WorkCheck;
}

const PHYSICS_ENERGY = SAMPLES[0].analysis.problemText;
const MATH_QUADRATIC = SAMPLES[1].analysis.problemText;
const CHEM_STOICH = SAMPLES[2].analysis.problemText;

const CHECK_BANK: Record<string, CheckBankEntry> = {
  // --- Physics: frictionless ramp, v = √(2gh) ≈ 5.4 m/s ---
  [PHYSICS_ENERGY]: {
    scenarios: [
      {
        id: "correct",
        triggers: ["5.4", "5.42", "√29.4", "sqrt(29.4)"],
        check: {
          verdict: "correct",
          strengths:
            "You chose energy conservation and carried it through cleanly — and you noticed the mass cancels.",
          continueFrom:
            "Nothing to fix. To lock in the idea: why doesn't the 2.0 kg appear in the answer?",
          summary:
            "Looks correct — $v=\\sqrt{2gh}\\approx 5.4\\ \\text{m/s}$, and your reasoning is sound.",
        },
      },
      {
        id: "arithmetic",
        triggers: ["5.9", "5.8", "= 6", "6.0", "6 m/s"],
        check: {
          verdict: "error_found",
          strengths:
            "Your physics is exactly right: energy conservation, $mgh=\\tfrac12 mv^2$, and the mass correctly cancels.",
          firstError: {
            category: "arithmetic",
            severity: "minor",
            location: "the final line, evaluating $\\sqrt{2\\cdot 9.8\\cdot 1.5}$",
            explanation:
              "$2\\cdot 9.8\\cdot 1.5 = 29.4$ and $\\sqrt{29.4}\\approx 5.42$ — just a slip in the last square root.",
            correction: "Re-evaluate the final step: $v=\\sqrt{29.4}\\approx 5.4\\ \\text{m/s}$.",
            conceptCorrect: true,
          },
          continueFrom:
            "Everything up to the last line stands — only the final arithmetic needs redoing.",
          summary:
            "The physics is spot on; only the last arithmetic is off — $\\sqrt{29.4}\\approx 5.4\\ \\text{m/s}$, not $5.9$.",
        },
      },
      {
        id: "wrong_equation",
        triggers: [
          "v = u + at",
          "v=u+at",
          "v² = u²",
          "v^2 = u^2",
          "suvat",
          "kinematic",
          "a = 9.8",
          "a=9.8",
          "f = ma",
        ],
        check: {
          verdict: "error_found",
          strengths: "You correctly read this as a 'speed from a drop' problem.",
          firstError: {
            category: "model_selection",
            severity: "significant",
            location: "choosing a constant-acceleration kinematics equation with $a=g$",
            explanation:
              "On a ramp the acceleration *along the surface* is $g\\sin\\theta$, not $g$, and straight-line kinematics would also need the incline angle and the ramp length — neither is given. The model doesn't fit the information you have.",
            correction:
              "Use energy conservation, which depends only on the vertical drop $h$, not the path or angle: $mgh=\\tfrac12 mv^2 \\Rightarrow v=\\sqrt{2gh}$.",
            conceptCorrect: false,
          },
          continueFrom:
            "Switch to $mgh=\\tfrac12 mv^2$ and solve for $v$ — one line gets you there.",
          summary:
            "The issue is the method, not the arithmetic: kinematics with $a=g$ doesn't apply on a ramp. Energy conservation is the right model here.",
        },
      },
      {
        id: "wrong_assumption",
        triggers: [
          "friction",
          "energy lost",
          "lost to heat",
          "depends on mass",
          "heavier",
          "mass matters",
          "need the mass",
        ],
        check: {
          verdict: "error_found",
          strengths: "You set up energy conservation, which is the right principle.",
          firstError: {
            category: "conceptual",
            severity: "significant",
            location: "an assumption about energy loss / the role of mass",
            explanation:
              "The ramp is stated to be **frictionless**, so no mechanical energy is lost to heat — there's no friction term to subtract. And because the mass cancels in $mgh=\\tfrac12 mv^2$, the final speed doesn't depend on it at all.",
            correction:
              "Equate all the potential energy to kinetic energy: $mgh=\\tfrac12 mv^2$. The $m$ cancels, giving $v=\\sqrt{2gh}$.",
            conceptCorrect: false,
          },
          continueFrom:
            "With no energy lost, set $mgh=\\tfrac12 mv^2$ and solve for $v$.",
          summary:
            "One assumption is off: on a frictionless ramp no energy is lost, and the speed is independent of mass. Then it's just $v=\\sqrt{2gh}$.",
        },
      },
      {
        id: "partial",
        triggers: ["+ mgh", "mv^2 + mgh", "mv² + mgh", "1/2mv^2 + mgh", "potential at the bottom"],
        check: {
          verdict: "partially_correct",
          strengths:
            "Right principle (energy conservation), and you correctly identified initial potential and final kinetic energy.",
          firstError: {
            category: "setup",
            severity: "significant",
            location: "the energy equation — a leftover $mgh$ term on the right",
            explanation:
              "You wrote $mgh=\\tfrac12 mv^2 + mgh$, which puts potential energy at the *bottom* too. Taking the bottom as your reference, $h_{\\text{bottom}}=0$, so that term is zero.",
            correction: "Set the bottom at $h=0$: $mgh=\\tfrac12 mv^2$, then $v=\\sqrt{2gh}$.",
            conceptCorrect: true,
          },
          continueFrom:
            "Drop the extra $mgh$ (bottom height is 0) and finish solving for $v$.",
          summary:
            "You're most of the way there — the setup just double-counts potential energy. With the bottom at $h=0$ it's $mgh=\\tfrac12 mv^2$.",
        },
      },
    ],
    fallback: {
      verdict: "partially_correct",
      strengths:
        "The energy-conservation framing is the right place to start.",
      firstError: {
        category: "setup",
        severity: "minor",
        location: "worth double-checking your energy equation",
        explanation:
          "Make sure the top is all potential ($mgh$) and the bottom all kinetic ($\\tfrac12 mv^2$), with the bottom taken as $h=0$.",
        correction:
          "If that matches, the only step left is $v=\\sqrt{2gh}=\\sqrt{29.4}\\approx 5.4\\ \\text{m/s}$.",
        conceptCorrect: true,
      },
      continueFrom:
        "Compare your equation to $mgh=\\tfrac12 mv^2$ and re-check the final number.",
      summary:
        "The energy-conservation approach is right — check your equation matches $mgh=\\tfrac12 mv^2$ and that $v\\approx 5.4\\ \\text{m/s}$.",
    },
  },

  // --- Math: 3x² − 12x + 9 = 0, roots x = 1, 3 ---
  [MATH_QUADRATIC]: {
    scenarios: [
      {
        id: "correct",
        triggers: ["x = 1", "x=1", "x = 3", "x=3", "1 or 3", "1, 3", "roots are 1"],
        check: {
          verdict: "correct",
          strengths:
            "You factored correctly and read the roots off the factors properly.",
          continueFrom:
            "Nice. Quick check: the sum of the roots is $4$ — does that match $-b/a$ after dividing by 3?",
          summary: "Correct — $x=1$ or $x=3$.",
        },
      },
      {
        id: "algebra_misconception",
        triggers: ["x = -1", "x=-1", "x = -3", "x=-3", "-1 and -3", "-1, -3", "negative roots"],
        check: {
          verdict: "error_found",
          strengths: "Your factoring is correct: $3(x-1)(x-3)=0$.",
          firstError: {
            category: "conceptual",
            severity: "significant",
            location: "reading the roots off the factors",
            explanation:
              "From $(x-1)(x-3)=0$ you took $x=-1$ and $x=-3$. But a root is the value that makes a factor **zero**: $x-1=0$ gives $x=+1$. The sign flips relative to the number inside the factor.",
            correction:
              "Set each factor to zero: $x-1=0\\Rightarrow x=1$ and $x-3=0\\Rightarrow x=3$.",
            conceptCorrect: false,
          },
          continueFrom: "Flip the signs — the roots are $x=1$ and $x=3$.",
          summary:
            "Factoring's right, but a zero factor gives $x-1=0\\Rightarrow x=+1$: the roots are $1$ and $3$, not $-1$ and $-3$.",
        },
      },
      {
        id: "arithmetic",
        triggers: ["(x-1)(x+3)", "x+3", "-1 and 3", "1 and -3", "product -3"],
        check: {
          verdict: "error_found",
          strengths: "Right approach — divide by 3 and factor $x^2-4x+3$.",
          firstError: {
            category: "arithmetic",
            severity: "minor",
            location: "choosing the factor pair",
            explanation:
              "You need two numbers with product $+3$ and sum $-4$. The pair $-1$ and $+3$ multiplies to $-3$ — a sign slip. Both must be negative to sum to $-4$ with a positive product.",
            correction: "Use $-1$ and $-3$: $(x-1)(x-3)=0$, so $x=1$ or $x=3$.",
            conceptCorrect: true,
          },
          continueFrom: "Fix the pair to $-1,-3$ and read off the roots.",
          summary:
            "Method's right; just the factor pair — product $+3$, sum $-4$ means $-1$ and $-3$. Roots $x=1,3$.",
        },
      },
    ],
    fallback: {
      verdict: "partially_correct",
      strengths: "You're set up to factor, which is the efficient route here.",
      firstError: {
        category: "procedural",
        severity: "minor",
        location: "check your factor pair and the sign of each root",
        explanation:
          "After dividing by 3 you want two numbers with product $+3$ and sum $-4$ (that's $-1,-3$); then a zero factor gives $x=+1$ from $x-1=0$.",
        correction: "That yields $x=1$ or $x=3$.",
        conceptCorrect: true,
      },
      continueFrom:
        "Verify the pair ($-1,-3$) and that each factor set to zero gives $x=1,3$.",
      summary:
        "Good route — two numbers with product $+3$, sum $-4$ are $-1,-3$; a zero factor gives $x=1$ and $x=3$.",
    },
  },

  // --- Chemistry: 4.0 mol H₂ + excess O₂ → ? mol H₂O (answer 4.0 mol) ---
  [CHEM_STOICH]: {
    scenarios: [
      {
        id: "correct",
        triggers: ["4.0 mol", "4 mol h", "= 4 mol", "1:1", "1 : 1"],
        check: {
          verdict: "correct",
          strengths:
            "You identified H₂ as the limiting reactant and used the correct 2:2 (i.e. 1:1) mole ratio.",
          continueFrom:
            "Solid. As a check: how many moles of O₂ did that consume?",
          summary: "Correct — 4.0 mol H₂ produces 4.0 mol H₂O.",
        },
      },
      {
        id: "chem_misconception_excess",
        triggers: ["excess", "more water", "more than 4", "8 mol", "extra o2", "increase"],
        check: {
          verdict: "error_found",
          strengths:
            "You balanced the reaction and noticed that O₂ is in excess.",
          firstError: {
            category: "conceptual",
            severity: "significant",
            location: "concluding that excess O₂ makes *more* water",
            explanation:
              "'Excess' only means O₂ isn't the limiting reactant — there's more than enough of it. Extra O₂ can't push production beyond what the limiting reactant, H₂, allows; it just sits unreacted.",
            correction:
              "Let the limiting reactant H₂ set the amount: H₂ : H₂O = 2 : 2 = 1 : 1, so 4.0 mol H₂ → 4.0 mol H₂O.",
            conceptCorrect: false,
          },
          continueFrom:
            "Use H₂ (limiting) with the 1:1 ratio to get the moles of water.",
          summary:
            "The misconception is about 'excess' — it doesn't increase the product. H₂ is limiting, so 4.0 mol H₂ → 4.0 mol H₂O.",
        },
      },
      {
        id: "chem_mole_vs_mass",
        triggers: ["gram", "molar mass", "× 18", "x 18", "mass ratio", "36 g", "18 g"],
        check: {
          verdict: "error_found",
          strengths:
            "Your balanced equation and the idea of using the reaction ratio are right.",
          firstError: {
            category: "conceptual",
            severity: "significant",
            location: "using masses (grams) where the ratio needs moles",
            explanation:
              "The coefficients in a balanced equation are **mole** ratios, not mass ratios — multiplying by molar masses here mixes the two.",
            correction:
              "Stay in moles: $4.0\\ \\text{mol H}_2 \\times \\tfrac{2\\ \\text{mol H}_2\\text{O}}{2\\ \\text{mol H}_2} = 4.0\\ \\text{mol}$. Convert to grams only if the question asks for mass.",
            conceptCorrect: false,
          },
          continueFrom: "Work in moles and apply the 1:1 ratio; the answer is 4.0 mol.",
          summary:
            "Coefficients are mole ratios, not mass ratios — keep it in moles: 4.0 mol H₂ → 4.0 mol H₂O.",
        },
      },
    ],
    fallback: {
      verdict: "partially_correct",
      strengths: "You're working from the balanced equation, which is the right basis.",
      firstError: {
        category: "setup",
        severity: "minor",
        location: "check the mole ratio you used",
        explanation:
          "Confirm you linked H₂ to H₂O by their coefficients (2:2 = 1:1) and treated H₂ as limiting, since O₂ is in excess.",
        correction:
          "Then $4.0\\ \\text{mol H}_2 \\times \\tfrac{2\\ \\text{mol H}_2\\text{O}}{2\\ \\text{mol H}_2} = 4.0\\ \\text{mol H}_2\\text{O}$.",
        conceptCorrect: true,
      },
      continueFrom: "Re-check the H₂:H₂O ratio (1:1) and that H₂ is limiting.",
      summary:
        "Right basis — make sure you used the 2:2 (1:1) H₂:H₂O ratio with H₂ as the limiting reactant → 4.0 mol.",
    },
  },
};

/** Diagnose an attempt against the scenario bank for its problem. */
function diagnoseAttempt(problemText: string, attemptText: string): WorkCheck {
  const entry = CHECK_BANK[problemText] ?? CHECK_BANK[PHYSICS_ENERGY];
  const text = attemptText.toLowerCase();

  const override = text.match(/scenario:\s*([a-z_]+)/)?.[1];
  if (override) {
    const forced = entry.scenarios.find((s) => s.id === override);
    if (forced) return forced.check;
  }

  const matched = entry.scenarios.find((s) =>
    s.triggers.some((t) => text.includes(t)),
  );
  return matched?.check ?? entry.fallback;
}

// ---------------------------------------------------------------------------
// Practice mode ("I'm ready — give me one like this")
//
// A small set of variants per concept — NOT a database. Each variant tests the
// same concept with different numbers/context (so memorization is useless) at
// matching or slightly higher difficulty. A real provider would generate these;
// the mock templates them, keeping the solution server-side until evaluation.
// ---------------------------------------------------------------------------

interface PracticeVariant {
  /** Client-facing problem (no solution). */
  problem: PracticeProblem;
  /** Substrings that indicate the student reached the correct final answer. */
  answerKeywords: string[];
  /** Substrings signalling a wrong concept/model choice. */
  wrongConceptKeywords: string[];
  /** Revealed only at evaluation time. */
  solution: StructuredSolution;
}

const PRACTICE_BANK: Record<string, PracticeVariant[]> = {
  [PHYSICS_ENERGY]: [
    {
      problem: {
        problemText:
          "A 3.0 kg cart is released from rest and rolls down a frictionless track, dropping a vertical height of 2.5 m. What is its speed at the bottom? (g = 9.8 m/s².)",
        subject: "Physics",
        topic: "Conservation of mechanical energy",
        concept: "Conservation of mechanical energy",
        difficulty: "same",
      },
      answerKeywords: ["7.0", "7 m/s", "= 7", "√49", "sqrt(49)"],
      wrongConceptKeywords: ["v = u + at", "v=u+at", "suvat", "f = ma", "kinematic"],
      solution: {
        understanding:
          "A 3.0 kg cart starts from rest and drops 2.5 m down a frictionless track; find its speed at the bottom.",
        keyConcept:
          "Conservation of mechanical energy — with no friction, all gravitational PE becomes KE.",
        reasoning:
          "Starting at rest, the energy is all potential, $mgh$; at the bottom it's all kinetic, $\\tfrac12 mv^2$. Frictionless means they're equal, and the mass cancels.",
        solution:
          "$$mgh=\\tfrac12 mv^2 \\;\\Rightarrow\\; v=\\sqrt{2gh}=\\sqrt{2\\cdot 9.8\\cdot 2.5}=\\sqrt{49}=7.0\\ \\text{m/s}$$",
        finalAnswer: "$v = 7.0\\ \\text{m/s}$",
        takeaway:
          "Same drop ⇒ same speed, whatever the mass. Energy conservation only cares about the height.",
      },
    },
    {
      problem: {
        problemText:
          "A ball on the end of a 1.2 m string is released from rest with the string horizontal. Ignoring air resistance, how fast is the ball moving at the lowest point of its swing? (g = 9.8 m/s².)",
        subject: "Physics",
        topic: "Conservation of mechanical energy",
        concept: "Conservation of mechanical energy",
        difficulty: "slightly_harder",
      },
      answerKeywords: ["4.8", "4.85", "4.9", "√23.5", "sqrt(23.5)"],
      wrongConceptKeywords: [
        "v = u + at",
        "suvat",
        "centripetal",
        "mv^2/r",
        "mv²/r",
        "circular motion",
      ],
      solution: {
        understanding:
          "A ball swings down on a 1.2 m string from horizontal; find its speed at the lowest point.",
        keyConcept:
          "Conservation of mechanical energy — and the vertical drop equals the string length.",
        reasoning:
          "The subtlety: from horizontal to the lowest point the height dropped is the full string length, $h=1.2$ m. Tension does no work (it's perpendicular to the motion), so mechanical energy is conserved.",
        solution:
          "$$v=\\sqrt{2gh}=\\sqrt{2\\cdot 9.8\\cdot 1.2}=\\sqrt{23.52}\\approx 4.85\\ \\text{m/s}$$",
        finalAnswer: "$v \\approx 4.85\\ \\text{m/s}$",
        takeaway:
          "Identify the real drop (here it's the string length), and remember tension does no work — so energy conservation still applies cleanly.",
      },
    },
  ],

  [MATH_QUADRATIC]: [
    {
      problem: {
        problemText: "Solve for x: 2x² − 10x + 12 = 0.",
        subject: "Mathematics",
        topic: "Quadratic equations",
        concept: "Factor out the common constant, then factor the quadratic",
        difficulty: "same",
      },
      answerKeywords: ["x = 2", "x=2", "x = 3", "x=3", "2 or 3", "2, 3", "2 and 3"],
      wrongConceptKeywords: ["x = -2", "x=-2", "x = -3", "x=-3", "-2 and -3"],
      solution: {
        understanding: "Find the values of $x$ satisfying $2x^2-10x+12=0$.",
        keyConcept:
          "Divide out the common factor first, then factor the simpler quadratic.",
        reasoning:
          "All terms share a factor of 2: $x^2-5x+6=0$. Two numbers with product $+6$ and sum $-5$ are $-2$ and $-3$.",
        solution:
          "$$2x^2-10x+12=0 \\;\\Rightarrow\\; x^2-5x+6=0 \\;\\Rightarrow\\; (x-2)(x-3)=0$$",
        finalAnswer: "$x=2$ or $x=3$",
        takeaway: "Pull out the common factor before factoring — the numbers get friendlier.",
      },
    },
    {
      problem: {
        problemText: "Solve for x: 3x² − 21x + 30 = 0.",
        subject: "Mathematics",
        topic: "Quadratic equations",
        concept: "Factor out the common constant, then factor the quadratic",
        difficulty: "slightly_harder",
      },
      answerKeywords: ["x = 2", "x=2", "x = 5", "x=5", "2 or 5", "2, 5", "2 and 5"],
      wrongConceptKeywords: ["x = -2", "x=-2", "x = -5", "x=-5", "-2 and -5"],
      solution: {
        understanding: "Find the values of $x$ satisfying $3x^2-21x+30=0$.",
        keyConcept:
          "Divide out the common factor first, then factor the simpler quadratic.",
        reasoning:
          "All terms share a factor of 3: $x^2-7x+10=0$. Two numbers with product $+10$ and sum $-7$ are $-2$ and $-5$.",
        solution:
          "$$3x^2-21x+30=0 \\;\\Rightarrow\\; x^2-7x+10=0 \\;\\Rightarrow\\; (x-2)(x-5)=0$$",
        finalAnswer: "$x=2$ or $x=5$",
        takeaway:
          "Common factor first, then find the pair — product $+10$, sum $-7$ gives $-2,-5$.",
      },
    },
  ],

  [CHEM_STOICH]: [
    {
      problem: {
        problemText:
          "How many moles of NH₃ are produced when 6.0 mol of H₂ reacts with excess N₂? (N₂ + 3H₂ → 2NH₃)",
        subject: "Chemistry",
        topic: "Stoichiometry (mole ratios)",
        concept: "Mole ratio with a limiting reactant",
        difficulty: "slightly_harder",
      },
      answerKeywords: ["4.0", "4 mol", "= 4"],
      wrongConceptKeywords: ["gram", "molar mass", "mass ratio", "excess n2 means more", "more nh3 because"],
      solution: {
        understanding:
          "6.0 mol H₂ reacts with excess N₂ via $\\text{N}_2 + 3\\text{H}_2 \\to 2\\text{NH}_3$; find mol NH₃.",
        keyConcept:
          "Use the mole ratio from the balanced equation; H₂ is limiting because N₂ is in excess.",
        reasoning:
          "The coefficients give H₂ : NH₃ = 3 : 2. With N₂ in excess, H₂ limits the product.",
        solution:
          "$$n_{\\text{NH}_3}=6.0\\ \\text{mol H}_2 \\times \\frac{2\\ \\text{mol NH}_3}{3\\ \\text{mol H}_2}=4.0\\ \\text{mol}$$",
        finalAnswer: "$4.0$ mol NH₃",
        takeaway:
          "The ratio isn't 1:1 here — read the coefficients (3:2) and let the limiting reactant set the amount.",
      },
    },
    {
      problem: {
        problemText:
          "How many moles of CO₂ are produced when 2.0 mol of propane (C₃H₈) burns in excess O₂? (C₃H₈ + 5O₂ → 3CO₂ + 4H₂O)",
        subject: "Chemistry",
        topic: "Stoichiometry (mole ratios)",
        concept: "Mole ratio with a limiting reactant",
        difficulty: "slightly_harder",
      },
      answerKeywords: ["6.0", "6 mol", "= 6"],
      wrongConceptKeywords: ["gram", "molar mass", "mass ratio", "excess o2 means more"],
      solution: {
        understanding:
          "2.0 mol C₃H₈ burns in excess O₂ via $\\text{C}_3\\text{H}_8 + 5\\text{O}_2 \\to 3\\text{CO}_2 + 4\\text{H}_2\\text{O}$; find mol CO₂.",
        keyConcept:
          "Use the mole ratio from the balanced equation; propane is limiting because O₂ is in excess.",
        reasoning:
          "The coefficients give C₃H₈ : CO₂ = 1 : 3. With O₂ in excess, propane limits the product.",
        solution:
          "$$n_{\\text{CO}_2}=2.0\\ \\text{mol C}_3\\text{H}_8 \\times \\frac{3\\ \\text{mol CO}_2}{1\\ \\text{mol C}_3\\text{H}_8}=6.0\\ \\text{mol}$$",
        finalAnswer: "$6.0$ mol CO₂",
        takeaway:
          "Balance first, then read the ratio (1:3 here) — the limiting reactant sets the amount of product.",
      },
    },
  ],
};

const AXIS_ORDER: RubricResult["axis"][] = [
  "concept_selection",
  "reasoning",
  "setup",
  "execution",
  "final_answer",
];

/** Look up a generated variant by its problem text (across all concepts). */
function findVariant(problemText: string): PracticeVariant | undefined {
  for (const variants of Object.values(PRACTICE_BANK)) {
    const v = variants.find((x) => x.problem.problemText === problemText);
    if (v) return v;
  }
  return undefined;
}

function rubric(
  statuses: Record<RubricResult["axis"], RubricResult["status"]>,
  notes: Partial<Record<RubricResult["axis"], string>>,
): RubricResult[] {
  return AXIS_ORDER.map((axis) => ({
    axis,
    status: statuses[axis],
    note: notes[axis] ?? "",
  }));
}

/**
 * Evaluate an attempt against a variant. A real model reads the actual work;
 * the mock infers an outcome from keywords in the typed attempt, then reveals
 * the solution. Focus is always the single most important issue.
 */
function evaluatePracticeAttempt(
  variant: PracticeVariant,
  attemptText: string,
  hasImage: boolean,
): PracticeEvaluation {
  const text = attemptText.toLowerCase();
  const { concept } = variant.problem;
  const answer = variant.solution.finalAnswer;

  // Reveal-only: no attempt provided.
  if (!text.trim() && !hasImage) {
    return {
      verdict: "partially_correct",
      rubric: rubric(
        {
          concept_selection: "not_shown",
          reasoning: "not_shown",
          setup: "not_shown",
          execution: "not_shown",
          final_answer: "not_shown",
        },
        {},
      ),
      focus: `Compare your reasoning to the model solution. Key idea: ${variant.solution.takeaway}`,
      summary: "Here's the worked solution — check your approach against it.",
      solution: variant.solution,
    };
  }

  const override = text.match(/outcome:\s*([a-z_]+)/)?.[1];
  const wrongConcept =
    override === "wrong_concept" ||
    variant.wrongConceptKeywords.some((k) => text.includes(k));
  const gotAnswer =
    override === "correct" ||
    variant.answerKeywords.some((k) => text.includes(k.toLowerCase()));

  if (wrongConcept) {
    return {
      verdict: "incorrect",
      rubric: rubric(
        {
          concept_selection: "incorrect",
          reasoning: "incorrect",
          setup: "incorrect",
          execution: "not_shown",
          final_answer: "incorrect",
        },
        {
          concept_selection: `This problem tests ${concept.toLowerCase()} — a different principle than you applied.`,
          reasoning: "The chain follows from the wrong starting point.",
          setup: "The equations don't match this concept.",
          final_answer: `Model answer: ${answer}.`,
        },
      ),
      focus: `The one thing that matters here is concept selection: this is a ${concept.toLowerCase()} problem. Re-read the solution's key concept, then the rest follows.`,
      summary: "The method doesn't fit this problem — it's a concept-selection issue, not an arithmetic one.",
      solution: variant.solution,
    };
  }

  if (gotAnswer) {
    return {
      verdict: "correct",
      rubric: rubric(
        {
          concept_selection: "correct",
          reasoning: "correct",
          setup: "correct",
          execution: "correct",
          final_answer: "correct",
        },
        {
          concept_selection: `Right principle: ${concept.toLowerCase()}.`,
          reasoning: "Your reasoning holds together.",
          setup: "Setup matches the model.",
          execution: "Clean execution.",
          final_answer: `Matches the model: ${answer}.`,
        },
      ),
      focus: `Nailed it — concept, reasoning, and answer all line up. Transferable idea: ${variant.solution.takeaway}`,
      summary: `Correct — ${answer}. Same concept as the original, so it's sticking.`,
      solution: variant.solution,
    };
  }

  // Engaged with the right idea, but the answer isn't confirmed — treat as an
  // execution slip and keep the feedback on execution, not the concept.
  return {
    verdict: "partially_correct",
    rubric: rubric(
      {
        concept_selection: "correct",
        reasoning: "correct",
        setup: "correct",
        execution: "minor_issue",
        final_answer: "incorrect",
      },
      {
        concept_selection: `Right principle: ${concept.toLowerCase()}.`,
        reasoning: "Your approach is sound.",
        setup: "Setup looks right.",
        execution: "Something slips between the setup and the number.",
        final_answer: `Doesn't match the model (${answer}) yet.`,
      },
    ),
    focus: `Your method is right — the gap is in execution. Re-run the arithmetic; the model answer is ${answer}.`,
    summary: `Right idea, but the final number is off — this is execution, not concept. Model answer: ${answer}.`,
    solution: variant.solution,
  };
}

function pickSample(seed: string): SampleProblem {
  // Deterministic pick so the same image maps to the same problem, while
  // different uploads can surface different subjects.
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return SAMPLES[Math.abs(hash) % SAMPLES.length];
}

/** Find the sample that matches a detected problem (falls back to the first). */
function sampleFor(problemText: string): SampleProblem {
  return (
    SAMPLES.find((s) => s.analysis.problemText === problemText) ?? SAMPLES[0]
  );
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MockProvider implements AIProvider {
  readonly name = "mock";

  async analyzeProblem(imageDataUrl: string): Promise<ProblemAnalysis> {
    await delay(700); // simulate OCR + classification latency
    return pickSample(imageDataUrl).analysis;
  }

  async tutor(request: TutorRequest): Promise<TutorTurn> {
    await delay(550);
    const sample = sampleFor(request.problem.problemText);
    const { action, history, studentText } = request;

    switch (action) {
      case "hint":
        return { message: sample.hint };

      case "explain":
        return { message: sample.explain };

      case "show_solution":
        return {
          message:
            "Here's the full worked solution. Read the **key concept** and **reasoning** first — that's where the understanding lives; the algebra is just bookkeeping.",
          solution: sample.solution,
        };

      case "similar_problem":
        return {
          message:
            "Try this one. It uses the same core idea, so lean on the concept rather than restarting from scratch:",
          similarProblem: sample.similar,
        };

      case "ask":
      default: {
        // Adapt depth to what the student's message demonstrates.
        const isOpener = history.length === 0;
        if (isOpener) return { message: sample.opener };

        const level = estimateUnderstanding(studentText ?? "");
        return { message: respondToStudent(sample, level, studentText ?? "") };
      }
    }
  }

  async checkWork(request: CheckWorkRequest): Promise<WorkCheck> {
    await delay(750); // simulate reading + diagnosing the attempt
    // A real provider reads request.attempt.imageDataUrl / .text against the
    // problem. The mock diagnoses from the typed text (or returns a sensible
    // fallback for a photo-only attempt).
    return diagnoseAttempt(request.problem.problemText, request.attempt.text ?? "");
  }

  async generatePractice(
    request: GeneratePracticeRequest,
  ): Promise<PracticeProblem> {
    await delay(650); // simulate generation
    const variants =
      PRACTICE_BANK[request.problem.problemText] ?? PRACTICE_BANK[PHYSICS_ENERGY];
    // Pick a fresh variant at random so repeated presses vary.
    const pick = variants[Math.floor(Math.random() * variants.length)];
    return pick.problem;
  }

  async evaluatePractice(
    request: EvaluatePracticeRequest,
  ): Promise<PracticeEvaluation> {
    await delay(800); // simulate reading + grading the attempt
    const variant = findVariant(request.practice.problemText);
    if (!variant) {
      throw new Error("Unknown practice problem.");
    }
    return evaluatePracticeAttempt(
      variant,
      request.attempt.text ?? "",
      !!request.attempt.imageDataUrl,
    );
  }
}

/**
 * Compose an adaptive reply. Real depth-tracking would come from the model;
 * here we branch on a simple understanding estimate to demonstrate the
 * philosophy: acknowledge and advance when the student gets it, teach the
 * idea when they don't, and correct briefly when it's a small slip.
 */
function respondToStudent(
  sample: SampleProblem,
  level: "low" | "medium" | "high",
  text: string,
): string {
  const t = text.toLowerCase();
  const asksWhy = /\bwhy\b|how come|reason/.test(t);
  const looksWrong = /\bwrong|mistake|is it|\?\s*$/.test(t) && /=|\d/.test(t);

  if (looksWrong) {
    return "Quick check: if your line disagrees with the concept, it's usually a small slip rather than a wrong idea. Re-scan the step where you moved a term or a factor — the principle you're using is right. Want me to point at the exact line?";
  }

  if (level === "high") {
    return `Exactly — that's the right principle, so you're set up well. ${firstSentence(
      sample.hint,
    )} Push it to the final number, and say if anything feels shaky.`;
  }

  if (level === "low" || asksWhy) {
    return sample.explain;
  }

  // medium: nudge toward the concept without over-explaining
  return `Good — you're on the right track. The thing that matters most here is *${sample.analysis.topic.toLowerCase()}*. ${firstSentence(
    sample.hint,
  )} What do you get when you apply that?`;
}

function firstSentence(s: string): string {
  const m = s.match(/^[^.!?]*[.!?]/);
  return (m ? m[0] : s).trim();
}

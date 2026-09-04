import type { AIProvider } from "@/lib/ai/types";
import type {
  ProblemAnalysis,
  StructuredSolution,
  TutorRequest,
  TutorTurn,
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

/**
 * The fixed vocabulary for "where the gap is".
 *
 * Concept tracking (History's "Concepts to work on", the home list, the
 * recurring banner, targeted practice) is keyed on these labels. They used to
 * be free text written per problem, so one gap arrived under several names
 * ("computing vertical velocity component from angle", "Resolving initial
 * velocity into components") and never added up, and the problem's broad topic
 * stood in for the actual mistake. Checks and the tutor's memory now pick from
 * this list (a schema enum), so the same gap merges across problems.
 *
 * Labels name the IDEA the mistake is about, not the problem's chapter: a
 * height used as a time in a free-fall problem is "Variables and symbols", not
 * "Free fall and gravity". Keep them short, stable and few; renaming one splits
 * its history.
 */

export const SUBJECT_CONCEPTS = {
  Physics: [
    "Vector components",
    "Kinematics equations",
    "Free fall and gravity",
    "Projectile motion",
    "Newton's laws",
    "Free-body diagrams",
    "Friction",
    "Circular motion",
    "Work and energy",
    "Conservation of energy",
    "Momentum and impulse",
    "Torque and equilibrium",
    "Oscillations and waves",
    "Electric circuits",
    "Electric fields and forces",
    "Magnetism",
    "Optics",
    "Thermal physics",
  ],
  Chemistry: [
    "Mole concept",
    "Stoichiometry",
    "Limiting reagent",
    "Balancing equations",
    "Concentration and dilution",
    "Gas laws",
    "Chemical equilibrium",
    "Acids, bases and pH",
    "Thermochemistry",
    "Redox",
    "Bonding and structure",
    "Periodic trends",
  ],
  Mathematics: [
    "Order of operations",
    "Solving linear equations",
    "Inequalities",
    "Expanding and factoring",
    "Quadratics",
    "Functions and graphs",
    "Slope and linear functions",
    "Rational functions",
    "Exponents and logarithms",
    "Trigonometry",
    "Systems of equations",
    "Sequences and series",
    "Probability and statistics",
    "Fractions and ratios",
    "Geometry and measurement",
    "Derivatives",
    "Integrals",
  ],
  Biology: [
    "Cell biology",
    "Genetics and inheritance",
    "Cellular respiration",
    "Photosynthesis",
    "Evolution",
    "Ecology",
    "Enzymes",
    "Human physiology",
  ],
} as const;

/** Gaps that cut across subjects. Offered for every subject. */
export const GENERAL_CONCEPTS = [
  "Arithmetic",
  "Algebraic manipulation",
  "Units and conversions",
  "Significant figures",
  "Variables and symbols",
  "Reading the question",
] as const;

/** Every label, as a non-empty tuple so it can back a schema enum. */
export const ALL_CONCEPTS = [
  ...new Set<string>([
    ...Object.values(SUBJECT_CONCEPTS).flat(),
    ...GENERAL_CONCEPTS,
  ]),
] as [string, ...string[]];

const BY_KEY = new Map(ALL_CONCEPTS.map((c) => [c.toLowerCase(), c]));

/** The labels to offer for a subject: its own plus the general ones. */
export function conceptsFor(subject: string | undefined): string[] {
  const own = SUBJECT_CONCEPTS[subject as keyof typeof SUBJECT_CONCEPTS];
  return own ? [...own, ...GENERAL_CONCEPTS] : [...ALL_CONCEPTS];
}

/** The canonical spelling of a label, or null if it isn't on the list. */
export function canonicalConcept(label: string | undefined | null): string | null {
  if (!label) return null;
  return BY_KEY.get(label.trim().toLowerCase()) ?? null;
}

export function isCanonicalConcept(label: string | undefined | null): boolean {
  return canonicalConcept(label) !== null;
}

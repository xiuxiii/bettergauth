/** Types for evals/runCase.mjs, so the owner routes can import it from TS. */

export type CaseKind = "check" | "notStem" | "tutor" | "detect";

/** A case file (evals/cases/*.json); evals/score.mjs documents each kind. */
export interface EvalCase {
  id: string;
  /** Unset = "check". */
  kind?: CaseKind;
  image?: string;
  /** Detect only: the same page with the coordinate grid drawn on. */
  gridImage?: string;
  [field: string]: unknown;
}

/** Fields every result that ran carries. */
interface RanResult {
  id: string;
  failed?: undefined;
  /** Wall time for the case, all its calls included. */
  ms: number;
}

export interface CheckResult extends RanResult {
  kind: "check";
  expectedCorrect: boolean;
  verdict: string;
  verdictRight: boolean;
  falseAlarm: boolean;
  missed: boolean;
  category: string | null;
  /** null = not scored (a correct attempt, or no expectation). */
  categoryRight: boolean | null;
  lineRight: boolean | null;
  answerLeaks: string[];
  labelSpoilers: string[];
  headlineLeak: string[];
  strayQuotes: string[];
  /** The WorkCheck the app returned. */
  check: Record<string, unknown>;
  /** The analysis's concept label. */
  label?: string;
}

export interface NotStemResult extends RanResult {
  kind: "notStem";
  turnedAway: boolean;
}

export interface TutorResult extends RanResult {
  kind: "tutor";
  passed: boolean;
  missing: string[];
  forbidden: string[];
  reply: string;
}

export interface DetectQuestionResult {
  label: string;
  found: boolean;
  predictedLabel?: string;
  hit: boolean;
  iou: number;
  /** Predicted centre minus true centre, as fractions of the page; null when not found. */
  dx: number | null;
  dy: number | null;
}

export interface DetectResult extends RanResult {
  kind: "detect";
  questions: DetectQuestionResult[];
  hits: number;
  total: number;
  meanIoU: number | null;
  meanDy: number | null;
  meanDx: number | null;
  missing: number;
  extra: number;
  /** The QuestionDetection the app returned. */
  detection: Record<string, unknown>;
}

/** A case that didn't run: counted by summarize(), not scored. */
export interface FailedResult {
  id: string;
  kind: CaseKind;
  failed: true;
  error: string;
}

export type EvalResult = CheckResult | NotStemResult | TutorResult | DetectResult | FailedResult;

/** What runCase needs from a fetch Response. */
export interface PostResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export interface RunCaseOptions {
  /** POST `body` as JSON to the app's `path` (e.g. "/api/analyze"). */
  post: (path: string, body: unknown) => Promise<PostResponse>;
  /** A repo-relative image path ("evals/images/x.jpg") as a data URL. */
  readImage: (relPath: string) => Promise<string>;
  /** Detect only: send the gridImage (when the case has one) and grid: true. */
  grid?: boolean;
}

export const KINDS: readonly CaseKind[];
export function kindOf(c: { kind?: CaseKind }): CaseKind;
/** Runs and scores one case. Never rejects: a failure is a FailedResult. */
export function runCase(c: EvalCase, options: RunCaseOptions): Promise<EvalResult>;

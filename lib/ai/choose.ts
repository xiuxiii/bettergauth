/**
 * Which provider a request runs on: the pure rules behind getProvider and
 * getDetectionProvider (lib/ai/provider.ts), kept here so `npm test` can
 * check them, and so the owner page can tell in advance whether a pinned
 * eval run would really run on the provider it names.
 *
 * A request's `x-ai-provider` pick is honoured only when the owner has turned
 * the Tutor switch on (TUTOR_SWITCH=on), or when it is an eval request (a
 * valid x-eval-bypass, so `npm run eval -- --provider X` and /owner can
 * compare the two). Otherwise the server's default runs, whatever the header
 * says. Hiding the switch in the UI was never enough: the header is set by
 * the browser, so a student with devtools (or one who picked Claude while the
 * switch was still visible, and still has that pick saved) could put every
 * request on the expensive provider.
 */

export type ProviderId = "anthropic" | "deepseek";

export type ChooseOptions = {
  requested: string | null | undefined;
  configured: Record<ProviderId, boolean>;
  defaultProvider: ProviderId | null;
  tutorSwitch: boolean;
  evalRequest: boolean;
};

/** The header's pick, when it names a configured provider (any case, any padding). */
function validPick(opts: ChooseOptions): ProviderId | null {
  const requested = opts.requested?.trim().toLowerCase();
  return (requested === "anthropic" || requested === "deepseek") && opts.configured[requested]
    ? requested
    : null;
}

/** The tutor's provider. null only when AI_PROVIDER names something unknown. */
export function chooseProvider(opts: ChooseOptions): ProviderId | null {
  const pick = validPick(opts);
  if (pick && (opts.tutorSwitch || opts.evalRequest)) return pick;
  return opts.defaultProvider;
}

/**
 * Question detection's provider:
 *   1. An eval request's pick, so the detect eval can compare the two even
 *      with DETECT_PROVIDER set. A student's pick never beats DETECT_PROVIDER:
 *      detection is a measured layout task, not the tutor they chose.
 *   2. DETECT_PROVIDER (already null when unset, unknown or without a key).
 *   3. Otherwise exactly what the tutor would use.
 */
export function chooseDetectionProvider(
  opts: ChooseOptions & { detectProvider: ProviderId | null },
): ProviderId | null {
  const pick = validPick(opts);
  if (pick && opts.evalRequest) return pick;
  if (opts.detectProvider) return opts.detectProvider;
  return chooseProvider(opts);
}

const NAME: Record<ProviderId, string> = { anthropic: "Claude", deepseek: "DeepSeek" };

/**
 * Why an eval run pinned to `provider` would NOT run on it, or null when it
 * would. Without a working bypass the pin is just a student's x-ai-provider
 * header, which the rules above ignore unless TUTOR_SWITCH=on (and, for
 * detection, always when DETECT_PROVIDER is set): the run would quietly
 * measure another provider under this one's name. Owner-facing, so it names
 * the env vars.
 */
export function pinnedRunProblem(opts: {
  provider: ProviderId;
  /** A detect case (/api/detect-questions) rather than the tutor's routes. */
  detect: boolean;
  /** The runner sends a valid x-eval-bypass (EVAL_BYPASS_TOKEN set on both sides). */
  bypass: boolean;
  configured: Record<ProviderId, boolean>;
  defaultProvider: ProviderId | null;
  tutorSwitch: boolean;
  detectProvider: ProviderId | null;
}): string | null {
  if (!opts.configured[opts.provider]) return `No ${NAME[opts.provider]} key on this deploy.`;
  const choose = {
    requested: opts.provider,
    configured: opts.configured,
    defaultProvider: opts.defaultProvider,
    tutorSwitch: opts.tutorSwitch,
    evalRequest: opts.bypass,
  };
  const runs = opts.detect
    ? chooseDetectionProvider({ ...choose, detectProvider: opts.detectProvider })
    : chooseProvider(choose);
  if (runs === opts.provider) return null;
  const decider =
    opts.detect && opts.detectProvider ? "DETECT_PROVIDER decides detection" : "TUTOR_SWITCH is off";
  return (
    `Pinned to ${NAME[opts.provider]}, but this would run on ${runs ? NAME[runs] : "the default"}: ` +
    `without EVAL_BYPASS_TOKEN the pick is ignored (${decider}). ` +
    `Set EVAL_BYPASS_TOKEN on the server and redeploy.`
  );
}

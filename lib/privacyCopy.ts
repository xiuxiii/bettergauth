/**
 * Which AI companies receive what, in plain words, for the privacy page
 * (app/privacy/page.tsx). Worked out from the live configuration so the page
 * can't drift from what the app actually does; the rules mirror getProvider
 * and the DeepSeek fallback in lib/ai/provider.ts:
 *
 * - The default answers (AI_PROVIDER, else DeepSeek when its key is set).
 *   Students can pick the other in Settings → Tutor only when the owner has
 *   turned that switch on (TUTOR_SWITCH=on) and both are set up.
 * - DeepSeek hands a photo it can't read, or an answer it can't produce, to
 *   Claude when Claude is set up. DEEPSEEK_VISION=off sends every photo
 *   straight to Claude (or nowhere, when there is no Claude).
 * - DETECT_PROVIDER pins question detection (finding the questions on a
 *   photo, getDetectionProvider) to one provider whoever tutors. DeepSeek
 *   there still obeys DEEPSEEK_VISION=off and hands photos to Claude. When
 *   that sends a photo somewhere it wouldn't otherwise go first, it gets its
 *   own line, and that company is named.
 *
 * Pure, so `npm test` checks every configuration.
 */

export type ProviderId = "anthropic" | "deepseek";

export type RoutingConfig = {
  anthropic: boolean;
  deepseek: boolean;
  defaultProvider: ProviderId | null;
  /** false when DEEPSEEK_VISION=off. */
  deepseekVision: boolean;
  /** Whether students get the Tutor switch (TUTOR_SWITCH=on). */
  studentSwitch: boolean;
  /** DETECT_PROVIDER when set AND configured (providerConfig), else null. */
  detectProvider: ProviderId | null;
};

export const PROVIDER_INFO: Record<
  ProviderId,
  { product: string; company: string; where: string; policy: string; note: string }
> = {
  anthropic: {
    product: "Claude",
    company: "Anthropic",
    where: "USA",
    policy: "https://www.anthropic.com/legal/privacy",
    note: "Anthropic's terms for apps like MindGap don't allow it to train its models on what you send.",
  },
  deepseek: {
    product: "DeepSeek",
    company: "DeepSeek",
    where: "China",
    policy: "https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html",
    note: "What it receives is handled under its own privacy policy and Chinese law.",
  },
};

/** The companies that can receive anything, and how requests are shared out. */
export function tutorRouting(cfg: RoutingConfig): { providers: ProviderId[]; lines: string[] } {
  const base = tutorOnlyRouting(cfg);
  const reader = detectionReader(cfg);
  if (!reader) return base;

  // Who reads a photo first without DETECT_PROVIDER. With the student switch
  // on (which needs both), a student can move the tutor away from the
  // detection provider, so the line is always needed then.
  const both = cfg.anthropic && cfg.deepseek;
  const switchable = both && cfg.studentSwitch;
  const photosFirst: ProviderId | null = !both
    ? cfg.anthropic
      ? "anthropic"
      : cfg.deepseekVision
        ? "deepseek"
        : null
    : cfg.defaultProvider === "anthropic" || !cfg.deepseekVision
      ? "anthropic"
      : "deepseek";
  if (reader === photosFirst && !switchable) return base;

  const name = PROVIDER_INFO[reader].product;
  const line = switchable
    ? `To find the questions on a photo, ${name} reads it, whichever you choose in Settings → Tutor.`
    : `To find the questions on a photo, ${name} reads it.`;
  const providers = (["anthropic", "deepseek"] as const).filter(
    (p) => base.providers.includes(p) || p === reader,
  );
  return { providers, lines: [...base.lines, line] };
}

/**
 * Who actually reads a photo for detection under DETECT_PROVIDER: DeepSeek
 * with DEEPSEEK_VISION=off passes it to Claude, or to no one.
 */
function detectionReader(cfg: RoutingConfig): ProviderId | null {
  const p = cfg.detectProvider;
  if (!p || !cfg[p]) return null;
  if (p === "deepseek" && !cfg.deepseekVision) return cfg.anthropic ? "anthropic" : null;
  return p;
}

/** The routing of everything but detection's DETECT_PROVIDER override. */
function tutorOnlyRouting(cfg: RoutingConfig): { providers: ProviderId[]; lines: string[] } {
  const providers = (["anthropic", "deepseek"] as const).filter((p) => cfg[p]);
  if (providers.length === 0) return { providers: [], lines: [] };

  if (providers.length === 1) {
    if (cfg.anthropic) return { providers, lines: ["Claude answers everything."] };
    return {
      providers,
      lines: cfg.deepseekVision
        ? ["DeepSeek answers everything, photos included."]
        : [
            "DeepSeek answers what you type.",
            "Photos aren't sent to it, so for now type your problems in.",
          ],
    };
  }

  const first = cfg.defaultProvider === "anthropic" ? "anthropic" : "deepseek";
  const other = first === "anthropic" ? "deepseek" : "anthropic";
  // Claude by default with no switch: DeepSeek never receives anything.
  if (!cfg.studentSwitch && first === "anthropic") {
    return { providers: ["anthropic"], lines: ["Claude answers everything."] };
  }
  const lines = cfg.studentSwitch
    ? [
        `${PROVIDER_INFO[first].product} answers unless you choose ${PROVIDER_INFO[other].product} in Settings → Tutor.`,
        "When DeepSeek is answering and can't read a photo or can't come up with an answer, that request is sent to Claude instead.",
      ]
    : [
        "DeepSeek answers everything.",
        "When DeepSeek can't read a photo or can't come up with an answer, that request is sent to Claude instead.",
      ];
  if (!cfg.deepseekVision) lines.push("Photos always go to Claude, never to DeepSeek.");
  return { providers, lines };
}

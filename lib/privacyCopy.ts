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

// ---------------------------------------------------------------------------
// Accounts (Supabase): what changes on the page when they're switched on.
// ---------------------------------------------------------------------------

export const ACCOUNT_STORE = {
  company: "Supabase",
  policy: "https://supabase.com/privacy",
};

/**
 * The "keeps", "never does" and account lines, for accounts on or off
 * (lib/supabase/config.ts). Off, the page says exactly what it always did;
 * on, it must not claim MindGap keeps nothing or uses one cookie, because a
 * signed-in student's problems are kept and the sign-in itself is a cookie.
 */
export function accountCopy(enabled: boolean): {
  summary: string;
  keeps: string[];
  never: string[];
  account: string[] | null;
} {
  const totals =
    "Daily totals, like how many problems were checked or how many hints were asked for, and roughly how many devices visited. They show whether MindGap is working and can't be traced back to you. Kept for 90 days.";
  const limits =
    "To stop overuse, requests are counted against a scrambled code made from your connection, never the address itself. Those counts clear within a day.";
  const logs = "The company that hosts MindGap keeps short technical logs, like any website.";
  const ads = "Show ads, or sell anything about you.";
  const trackers = "Use trackers or analytics from other companies.";

  if (!enabled) {
    return {
      summary:
        "The short version: what you photograph and type is sent to an AI tutor so it can answer you, and kept on this device as your history. MindGap has no accounts, no ads and no tracking, and it doesn't keep your problems.",
      keeps: [
        "Nothing about your problems: no photos, no text, no conversations.",
        totals,
        limits,
        "If you entered an access code, a cookie remembers that it was accepted. It's the only cookie MindGap uses.",
        logs,
      ],
      never: ["Ask for an account, your name or your email.", ads, trackers],
      account: null,
    };
  }
  return {
    summary:
      "The short version: what you photograph and type is sent to an AI tutor so it can answer you, and kept on this device as your history. An account is optional: sign in and your problems are kept in your account too, so they're on every device, until you delete them. No ads and no tracking.",
    keeps: [
      "If you don't sign in: nothing about your problems. No photos, no text, no conversations.",
      "If you sign in: what's listed under \"With an account\" below, until you delete it.",
      totals,
      limits,
      "Cookies only to keep you signed in, and to remember an access code if you entered one. No others.",
      logs,
    ],
    never: [
      "Make you sign up. Everything works without an account.",
      ads,
      trackers,
    ],
    account: [
      "Accounts are for ages 13 and up. We ask your birth month and year once, and keep only that you're 13 or older, never the date.",
      "Your account keeps your email (and, with Google, your name and picture), your problems, photos, conversations, progress and settings, so they're on every device you sign in on.",
      `They're stored by ${ACCOUNT_STORE.company}, which runs MindGap's database. Only you can see them: each account can only read its own.`,
      "Signing in with Google tells Google you used it to sign in to MindGap. Google doesn't see your problems.",
      "Delete one problem and it's deleted on every device. Delete your account (Account → Delete account) and everything in it is erased for good.",
      "Signing out takes your account's problems off that device. They stay in your account.",
    ],
  };
}

/** Small client/server-safe helpers. */

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Read a File into a data URL (client-only). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read the image file."));
    reader.readAsDataURL(file);
  });
}

/** sessionStorage key used to hand the captured image to the workspace. */
export const IMAGE_KEY = "mindgap:image";

/**
 * sessionStorage key for Ask mode's question, handed to the workspace beside
 * the image. The workspace removes it as soon as it reads it, so a reload
 * re-opens the photo without asking the same question twice.
 */
export const QUESTION_KEY = "mindgap:question";

/**
 * sessionStorage flag: detection saw handwritten working in the chosen question,
 * so the workspace may start the work check in parallel with the analysis.
 * Read once and cleared, like QUESTION_KEY.
 */
export const WORK_HINT_KEY = "mindgap:work-hint";

/**
 * sessionStorage key for a problem typed or pasted on the home screen, handed
 * to the workspace instead of an image. Written with IMAGE_KEY cleared, and
 * the other way round, so only one of the two is ever waiting.
 */
export const TEXT_KEY = "mindgap:text";

/** "Today", "Yesterday", "3 days ago", then a short date. */
export function formatRelativeDate(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Whether this Enter keypress should send. On a keyboard, Enter sends and
 * Shift+Enter is a newline. On a phone (a coarse pointer) Enter is a newline
 * and the send button sends: a phone keyboard has no Shift+Enter, so Enter
 * sending meant a multi-line answer was impossible and a stray tap sent half
 * a message. IME composition (e.g. Japanese input) never sends.
 */
export function enterSends(e: {
  key: string;
  shiftKey: boolean;
  nativeEvent?: { isComposing?: boolean };
}): boolean {
  if (e.key !== "Enter" || e.shiftKey || e.nativeEvent?.isComposing) return false;
  try {
    return !window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return true;
  }
}

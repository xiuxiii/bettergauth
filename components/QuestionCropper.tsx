"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type {
  DetectedQuestion,
  DetectionDebug,
  NormalizedRect,
  QuestionDetection,
} from "@/lib/tutor/types";
import { detectContentRectNormalized, imageForDetection } from "@/lib/image";
import { apiFetch } from "@/lib/apiClient";
import { detectGridWithin, useDetectGrid } from "@/lib/aiChoice";
import { enterSends } from "@/lib/utils";
import { Spinner } from "@/components/States";

type Handle = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const FULL: NormalizedRect = { x: 0, y: 0, w: 1, h: 1 };
const MIN_SIZE = 0.03; // smallest crop, as a fraction of the image: one printed line
const AUTO_PAD = 0.015; // breathing room around a detected question
/**
 * Space between the photo and the stage's sides. Drawn edge to edge, a box on
 * the photo's edge put its handles on the screen's edge, which on Android is
 * the system back gesture's strip: the drag went to the phone, not the box.
 */
const GUTTER_X = 32;
const GUTTER_Y = 20;
/** Below this many pixels of travel a press on the photo is a tap, not a drag. */
const TAP_SLOP = 8;
/**
 * Ceiling on the detection call, after which the local seed box is all there
 * is. Generous on purpose: the box is editable the whole time, and a dense
 * worksheet (25 numbered parts, ~30 output tokens each) outran the old 8s and
 * came back with nothing.
 */
const DETECT_TIMEOUT_MS = 20000;

/**
 * How long detection waits to learn whether to draw the coordinate grid
 * (DETECT_GRID). The home page prefetches it, so it is normally known already;
 * this only bounds a slow or failed /api/providers, after which detection goes
 * out without the grid.
 */
const GRID_FLAG_WAIT_MS = 300;

/**
 * Last detection result, so backing out of the cropper and re-entering with the
 * same photo doesn't re-pay the call. One slot, not a Map: these data URLs are
 * megabytes, and holding a history of them is how you run a phone out of memory.
 *
 * `grid` records whether that call sent the gridded image, but is NOT part of
 * the match: the flag can only go from unknown to known within a page load, so
 * a mismatch means the first call gave up waiting for it, and re-paying for
 * the same photo just because the flag turned up later is the double bill
 * this cache exists to prevent. Either answer is a real detection.
 */
let lastDetection: {
  image: string;
  grid: boolean;
  result: QuestionDetection;
} | null = null;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

/** Expand a detected box slightly so the crop never clips descenders/figures. */
function padded(r: NormalizedRect): NormalizedRect {
  const x = clamp(r.x - AUTO_PAD, 0, 1);
  const y = clamp(r.y - AUTO_PAD, 0, 1);
  return {
    x,
    y,
    w: clamp(r.x + r.w + AUTO_PAD, 0, 1) - x,
    h: clamp(r.y + r.h + AUTO_PAD, 0, 1) - y,
  };
}

function sameRect(a: NormalizedRect, b: NormalizedRect) {
  const eps = 0.002;
  return (
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.w - b.w) < eps &&
    Math.abs(a.h - b.h) < eps
  );
}

/** "Question 5" → "5", "Q3(b)" → "3(b)"; anything else stays as is. */
function shortLabel(label: string) {
  const m = /(\d+\s*(?:\([a-z]\)|[a-z])?)/i.exec(label);
  return m ? m[1].replace(/\s+/g, "") : label;
}

/**
 * Capture-time crop step: shows the photo, finds the questions on it (via the
 * AI provider, with a local ink-bounding-box fallback), boxes the most likely
 * one, and lets the student switch between questions, drag / resize / move the
 * box, reset to the detected crop, and confirm. The confirmed
 * crop then enters the existing MindGap flow unchanged.
 */
export default function QuestionCropper({
  image,
  onConfirm,
  onCancel,
  onRetake,
}: {
  /** Normalized (upright, downscaled) photo of the page as a data URL. */
  image: string;
  /**
   * Hands back the chosen region, not a cropped image. The crop is applied to
   * the full-resolution original by the caller: `image` here is only the small
   * preview, and cropping it would throw away the detail the model needs to
   * read handwriting. If it rejects, its message is shown here and the button
   * works again, so the student can retry (or cancel) knowing why.
   */
  onConfirm: (result: {
    rect: NormalizedRect;
    question?: string;
    /** Detection saw handwritten working in the chosen question. */
    workLikely?: boolean;
  }) => void | Promise<void>;
  onCancel: () => void;
  /** Back to the camera, for when the photo turned out not to be work at all.
   *  Falls back to onCancel when the caller has no capture to return to. */
  onRetake?: () => void;
}) {
  // Ask mode is a switch on this screen, not a separate button on home: it is
  // the same capture either way, and deciding before seeing the photo was the
  // wrong moment to ask.
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  // --- Detection -------------------------------------------------------------
  const [detecting, setDetecting] = useState(true);
  const [questions, setQuestions] = useState<DetectedQuestion[]>([]);
  const [selected, setSelected] = useState(0);
  const [rect, setRect] = useState<NormalizedRect>(FULL);
  // The auto-detected crop for the current selection (what "Reset" restores).
  const [autoRect, setAutoRect] = useState<NormalizedRect>(FULL);

  // The student's framing beats the model's. Set the moment they touch the box,
  // and read by the detection handler below, which would otherwise overwrite
  // whatever they had just dragged.
  const touchedRef = useRef(false);
  // The same fact as state, so the corners can stop pulsing the moment the
  // student starts dragging — a ref change wouldn't re-render them.
  const [touched, setTouched] = useState(false);
  // The model said this photo holds no study material at all (dinner, the
  // floor, an accidental shot). Shown as an overlay instead of letting them
  // spend a full analysis on it.
  const [notWork, setNotWork] = useState(false);

  // `?debug=boxes`: outline every detected box and show the model's raw pixel
  // output, to tell a coordinate-space bug (every box off by one factor) from
  // the model misplacing boxes (scattered errors). Read once, client-only.
  const [debugBoxes] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("debug") === "boxes",
  );
  // In production the server also wants its DEBUG_CODE: `?debug=boxes&code=…`.
  const [debugCode] = useState(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("code") ?? undefined
      : undefined,
  );
  const [debugInfo, setDebugInfo] = useState<DetectionDebug | null>(null);
  const [debugDenied, setDebugDenied] = useState(false);
  // Why detection gave nothing, for the debug panel: a timeout looks exactly
  // like "no questions" on screen otherwise.
  const [debugFailure, setDebugFailure] = useState<string | null>(null);
  const [debugSent, setDebugSent] = useState<{
    w: number;
    h: number;
    grid: boolean;
  } | null>(null);
  // DETECT_GRID as the server reports it. Detection itself decides once, via
  // detectGridWithin below; this is only for the debug line, to tell "flag
  // off" from "flag arrived too late to be used".
  const gridFlag = useDetectGrid();

  // Phase 1: seed a real box immediately, with no network.
  //
  // This is the whole point of the screen's timing. Detection takes seconds,
  // and until it lands the box used to sit at FULL — framing the entire page,
  // which looks exactly like nothing has happened. The local ink bounding box
  // needs no network and now runs at a small size, so a box is on the question
  // from the first frame and there is nothing to wait through. It only ever
  // seeds an editable box: the student can drag it, and detection replaces it.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let local: NormalizedRect | null = null;
      try {
        local = await detectContentRectNormalized(image);
      } catch {
        local = null;
      }
      // Anything that already moved the box wins: a slow seed must not yank
      // the frame out from under a student who got there first.
      if (cancelled || !local || touchedRef.current) return;
      setAutoRect(local);
      setRect(local);
    })();
    return () => {
      cancelled = true;
    };
  }, [image]);

  // Phase 2: ask the model where the questions are, in the background.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    // Without this the request had no ceiling at all: a hung call left
    // "Finding the questions…" on screen forever, because the only
    // setDetecting(false) sat after the await.
    let timedOut = false;
    const started = Date.now();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, DETECT_TIMEOUT_MS);

    async function detect() {
      let result: QuestionDetection | null = null;
      try {
        if (!debugBoxes && lastDetection && lastDetection.image === image) {
          // Re-entering the cropper with the same photo: the effect is keyed on
          // `image`, so without this every back-and-forth re-paid the call.
          result = lastDetection.result;
        } else {
          // Whether to draw the coordinate grid is decided ONCE, here, and the
          // flag is deliberately not an effect dependency: if it changed
          // between renders, a dependency would abort an in-flight call and
          // send a second one, paying twice for the same photo. It is
          // prefetched on the home page, so this normally resolves at once;
          // the wait only bounds a slow /api/providers, which then costs at
          // most GRID_FLAG_WAIT_MS and means a clean image.
          const grid = await detectGridWithin(GRID_FLAG_WAIT_MS);
          if (cancelled) return;
          // Detection gets its own, smaller image — and the dimensions that go
          // with THAT image, since the boxes come back in its pixel space. The
          // grid, when on, is drawn on this copy only; the photo on screen
          // stays clean.
          const shrunk = await imageForDetection(image, { grid });
          if (debugBoxes) setDebugSent({ w: shrunk.width, h: shrunk.height, grid });
          const res = await apiFetch("/api/detect-questions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              image: shrunk.image,
              width: shrunk.width,
              height: shrunk.height,
              ...(grid ? { grid: true } : {}),
              ...(debugBoxes ? { debug: true, debugCode } : {}),
            }),
            signal: controller.signal,
          });
          if (!res.ok && debugBoxes) setDebugFailure(`HTTP ${res.status} after ${Date.now() - started} ms`);
          if (res.ok) {
            result = (await res.json()) as QuestionDetection;
            lastDetection = { image, grid, result };
            if (debugBoxes) {
              setDebugInfo(result.debug ?? null);
              setDebugDenied(!!result.debugDenied);
            }
          }
        }
      } catch (err) {
        // Aborted, offline, or a bad response. The phase-1 box already gives
        // the student a usable screen, so there is nothing to recover here.
        if (debugBoxes && !cancelled) {
          setDebugFailure(
            timedOut
              ? `timed out after ${DETECT_TIMEOUT_MS} ms`
              : `failed after ${Date.now() - started} ms: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      if (cancelled) return;

      if (result && result.hasStemContent === false) {
        setNotWork(true);
        setDetecting(false);
        return;
      }

      if (result && result.questions.length > 0) {
        const i = clamp(result.primaryIndex, 0, result.questions.length - 1);
        setQuestions(result.questions);
        setSelected(i);
        if (!touchedRef.current) {
          const auto = padded(result.questions[i].rect);
          setAutoRect(auto);
          setRect(auto);
        }
      }
      setDetecting(false);
    }

    void detect();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
    // debugBoxes and debugCode are read once from the URL and never change.
  }, [image, debugBoxes, debugCode]);

  function selectQuestion(i: number) {
    if (i < 0 || i >= questions.length) return;
    const auto = padded(questions[i].rect);
    // Tapping a number is the student asking for that question, so it overrides
    // their earlier dragging rather than being suppressed by it.
    touchedRef.current = false;
    setSelected(i);
    setAutoRect(auto);
    setRect(auto);
  }

  // --- Stage geometry (image fitted inside the stage) ------------------------
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [img, setImg] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setStage({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useMemo(() => {
    if (!stage.w || !stage.h || !img.w || !img.h) return null;
    const scale = Math.min((stage.w - 2 * GUTTER_X) / img.w, (stage.h - 2 * GUTTER_Y) / img.h);
    if (scale <= 0) return null;
    const w = img.w * scale;
    const h = img.h * scale;
    return { w, h, x: (stage.w - w) / 2, y: (stage.h - h) / 2 };
  }, [stage, img]);

  // --- Drag / resize / move --------------------------------------------------
  const drag = useRef<{
    /** "draw": a press on the photo outside the box, which draws a new one. */
    handle: Handle | "draw";
    startX: number;
    startY: number;
    rect: NormalizedRect;
    /** draw only: where the press landed on the photo, normalized. */
    anchor?: { x: number; y: number };
    /** draw only: travelled past TAP_SLOP, so it is a drag, not a tap. */
    moved?: boolean;
  } | null>(null);

  /** A pointer position as a point on the photo, normalized and clamped. */
  const photoPoint = (clientX: number, clientY: number) => {
    const stageBox = stageRef.current?.getBoundingClientRect();
    if (!stageBox || !fit) return null;
    return {
      x: clamp((clientX - stageBox.left - fit.x) / fit.w, 0, 1),
      y: clamp((clientY - stageBox.top - fit.y) / fit.h, 0, 1),
    };
  };

  // Pressing the photo anywhere outside the box: drag across a question to
  // box it in one stroke (the quickest crop there is), or tap a detected
  // question to pick it. The box's own handlers stop propagation, so this
  // only sees presses that missed it.
  const startDraw = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    // The overlays inside the stage (not-work, debug) keep their own clicks.
    if (notWork || (e.target as HTMLElement).closest("button, a")) return;
    const anchor = photoPoint(e.clientX, e.clientY);
    if (!anchor) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { handle: "draw", startX: e.clientX, startY: e.clientY, rect, anchor, moved: false };
  };

  const startDrag = (handle: Handle) => (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    touchedRef.current = true;
    setTouched(true);
    drag.current = { handle, startX: e.clientX, startY: e.clientY, rect };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !fit) return;
    if (d.handle === "draw") {
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < TAP_SLOP) return;
      if (!d.moved) {
        d.moved = true;
        touchedRef.current = true;
        setTouched(true);
      }
      const p = photoPoint(e.clientX, e.clientY);
      const a = d.anchor;
      if (!p || !a) return;
      // Grow from the anchor towards the finger, at least MIN_SIZE each way,
      // and never past the photo.
      const span = (from: number, to: number) => {
        const size = clamp(Math.abs(to - from), MIN_SIZE, 1);
        const start = to >= from ? from : from - size;
        return { start: clamp(start, 0, 1 - size), size };
      };
      const sx = span(a.x, p.x);
      const sy = span(a.y, p.y);
      setRect({ x: sx.start, y: sy.start, w: sx.size, h: sy.size });
      return;
    }
    const dx = (e.clientX - d.startX) / fit.w;
    const dy = (e.clientY - d.startY) / fit.h;
    const r = d.rect;
    let { x, y, w, h } = r;
    const right = r.x + r.w;
    const bottom = r.y + r.h;

    if (d.handle === "move") {
      x = clamp(r.x + dx, 0, 1 - r.w);
      y = clamp(r.y + dy, 0, 1 - r.h);
    } else {
      if (d.handle.includes("w")) {
        x = clamp(r.x + dx, 0, right - MIN_SIZE);
        w = right - x;
      }
      if (d.handle.includes("e")) {
        w = clamp(r.w + dx, MIN_SIZE, 1 - r.x);
      }
      if (d.handle.includes("n")) {
        y = clamp(r.y + dy, 0, bottom - MIN_SIZE);
        h = bottom - y;
      }
      if (d.handle.includes("s")) {
        h = clamp(r.h + dy, MIN_SIZE, 1 - r.y);
      }
    }
    setRect({ x, y, w, h });
  };

  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    // A tap on the photo picks the detected question under it (the smallest,
    // where boxes nest). A tap anywhere else leaves the box alone.
    if (d?.handle === "draw" && !d.moved && e.type === "pointerup") {
      const p = photoPoint(e.clientX, e.clientY);
      if (!p) return;
      let best = -1;
      questions.forEach((q, i) => {
        const r = q.rect;
        const inside = p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
        if (inside && (best < 0 || r.w * r.h < questions[best].rect.w * questions[best].rect.h)) best = i;
      });
      if (best >= 0) selectQuestion(best);
    }
  };

  // --- Confirm / cancel ------------------------------------------------------
  const [cropping, setCropping] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);

  const trimmedQuestion = question.trim();
  const canConfirm = !asking || trimmedQuestion.length > 0;

  async function confirm() {
    if (cropping || !canConfirm) return;
    setCropping(true);
    setCropError(null);
    // A timing hint only (see TutorWorkspace): whether the question they chose
    // has working in it, so the check can start alongside the analysis.
    const workLikely = !asking && questions[selected]?.hasWorking === true;
    try {
      await onConfirm(asking ? { rect, question: trimmedQuestion } : { rect, workLikely });
    } catch (err) {
      // On success the page navigates away with the spinner still up; only a
      // failure hands the button back.
      setCropping(false);
      setCropError(err instanceof Error ? err.message : "Could not use that crop. Please try again.");
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const canReset = !sameRect(rect, autoRect);
  const cornersActive = detecting && !touched && !notWork;
  const multi = questions.length > 1;
  // The one thing worth reading, kept to a single phone line. The count is a
  // separate, quieter line: it is context, not an instruction.
  //
  // Detection deliberately does NOT get the primary line. There is already a
  // real box on the photo by now, so the student can act; announcing a wait
  // over a screen that isn't waiting is what made this feel slow. Progress
  // goes on the quiet line, where it reads as "more is coming" rather than
  // "you can't do anything yet".
  const instruction = asking
    ? "Frame what you're asking about"
    : multi
    ? "Tap a question, or drag across one"
    : questions.length === 1
      ? "Drag the box to frame the question"
      : "Drag across the question";
  const count = multi
    ? `${questions.length} questions found`
    : detecting && !asking
      ? "Looking for other questions…"
      : "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="question-cropper-title"
      className="fixed inset-0 z-50 !mt-0 flex flex-col bg-paper"
    >
      {/* Top bar */}
      <header className="flex min-h-14 items-center gap-2 border-b border-hairline bg-surface px-2 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top,0px))]">
        <button
          onClick={onCancel}
          aria-label="Back"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
        >
          <X size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {/* The instruction lives at the bottom, next to the controls and the
            thumb. A title up here would just say it a second time. */}
        <h2 id="question-cropper-title" className="sr-only">
          Select the question
        </h2>
        <div className="min-w-0 flex-1" />
        <button
          onClick={() => setRect(autoRect)}
          disabled={!canReset}
          className="h-10 rounded-md px-3 text-sm font-medium text-brand-700 transition hover:bg-brand-50 disabled:invisible"
        >
          Reset
        </button>
      </header>

      {/* Stage: the whole photo stays visible; everything outside the box is dimmed. */}
      <div
        ref={stageRef}
        /* Fixed dark, not `bg-ink`: this is a photo letterbox, so it must stay
           dark in both themes. `--ink` is the *text* colour and flips light on
           the dark theme, which turned these bars into cream slabs. Matches the
           dimming mask's literal below. */
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-[rgb(32_27_20)]"
        onPointerDown={startDraw}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image}
          alt="Your photo"
          draggable={false}
          onLoad={(e) =>
            setImg({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
          }
          className="pointer-events-none absolute"
          style={
            fit
              ? { left: fit.x, top: fit.y, width: fit.w, height: fit.h }
              : { opacity: 0 }
          }
        />

        {fit && (
          <>
            {/* Dimming mask, clipped to the photo so it never spills onto the stage. */}
            <div
              className="pointer-events-none absolute overflow-hidden"
              style={{ left: fit.x, top: fit.y, width: fit.w, height: fit.h }}
            >
              <div
                className="absolute rounded-sm shadow-[0_0_0_9999px_rgb(32_27_20/0.55)]"
                style={{
                  left: rect.x * fit.w,
                  top: rect.y * fit.h,
                  width: rect.w * fit.w,
                  height: rect.h * fit.h,
                }}
              />
            </div>

            {/* Interactive box in an unclipped layer, so the handles stay reachable
                when the box sits on the photo's edge. */}
            <div
              className="absolute"
              style={{ left: fit.x, top: fit.y, width: fit.w, height: fit.h }}
            >
            <div
              onPointerDown={startDrag("move")}
              className="absolute cursor-move rounded-sm border-2 border-brand-500"
              style={{
                left: rect.x * fit.w,
                top: rect.y * fit.h,
                width: rect.w * fit.w,
                height: rect.h * fit.h,
              }}
            >
              {/* Edge strips: 24px-thick hit areas centred on each edge. */}
              <Edge handle="n" onStart={startDrag} className="-top-3 left-0 h-6 w-full cursor-ns-resize" />
              <Edge handle="s" onStart={startDrag} className="-bottom-3 left-0 h-6 w-full cursor-ns-resize" />
              <Edge handle="w" onStart={startDrag} className="-left-3 top-0 h-full w-6 cursor-ew-resize" />
              <Edge handle="e" onStart={startDrag} className="-right-3 top-0 h-full w-6 cursor-ew-resize" />
              {/* Corner handles: 44px targets with a visible bracket. */}
              {/* While detection runs, the corners go bold and breathe: the
                  one useful thing to do in that time is frame the question,
                  so that is where the eye should go — not to how long the
                  processing takes. They settle as soon as detection lands or
                  the student starts dragging, whichever comes first. */}
              <Corner handle="nw" onStart={startDrag} active={cornersActive} className="-left-[22px] -top-[22px] cursor-nwse-resize" />
              <Corner handle="ne" onStart={startDrag} active={cornersActive} className="-right-[22px] -top-[22px] cursor-nesw-resize" />
              <Corner handle="sw" onStart={startDrag} active={cornersActive} className="-bottom-[22px] -left-[22px] cursor-nesw-resize" />
              <Corner handle="se" onStart={startDrag} active={cornersActive} className="-bottom-[22px] -right-[22px] cursor-nwse-resize" />
            </div>
            </div>

            {debugBoxes && debugInfo && (
              <div
                className="pointer-events-none absolute"
                style={{ left: fit.x, top: fit.y, width: fit.w, height: fit.h }}
              >
                {questions.map((q, i) => (
                  <div
                    key={`dbg-${i}`}
                    className="absolute border border-amber-400"
                    style={{
                      left: q.rect.x * fit.w,
                      top: q.rect.y * fit.h,
                      width: q.rect.w * fit.w,
                      height: q.rect.h * fit.h,
                    }}
                  >
                    <span className="absolute left-0 top-0 bg-amber-400 px-1 font-mono text-[10px] leading-4 text-black">
                      {shortLabel(q.label)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {debugBoxes && (
          <DebugPanel
            info={debugInfo}
            denied={debugDenied}
            sent={debugSent}
            gridFlag={gridFlag}
            preview={img}
            detecting={detecting}
            failure={debugFailure}
          />
        )}

        {notWork && (
          <div
            role="alertdialog"
            aria-labelledby="not-work-title"
            aria-describedby="not-work-body"
            className="absolute inset-0 z-10 flex animate-fade-in items-center justify-center bg-[rgb(32_27_20/0.72)] px-6"
          >
            <div className="w-full max-w-xs rounded-lg bg-surface p-5 text-center shadow-card">
              <p id="not-work-title" className="text-lg font-semibold text-ink">
                Question not detected
              </p>
              <p id="not-work-body" className="mt-1 text-sm text-slate-600">
                Please try again with the problem in frame.
              </p>
              <button
                onClick={onRetake ?? onCancel}
                autoFocus
                className="mt-4 flex h-12 w-full items-center justify-center rounded-md bg-brand-600 px-5 text-base font-semibold text-white transition hover:bg-accent-deep active:scale-[0.98]"
              >
                Take another photo
              </button>
              {/* A way through for the rare real page read as empty (faint
                  pencil, an odd diagram). Without it a wrong call is a dead
                  end; kept small so it doesn't compete with retaking. */}
              <button
                onClick={() => setNotWork(false)}
                className="mt-2 h-10 text-sm font-medium text-slate-500 underline-offset-4 hover:text-ink hover:underline"
              >
                Use this photo anyway
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Controls. Hidden behind the not-work overlay: offering "Use this
          question" under "Question not detected" would contradict itself. */}
      {!notWork && (
      <div className="border-t border-hairline bg-surface px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3">
        {/* Holds the nav row's height while detection is still running, so the
            chips don't shove the instruction and button down when they land. */}
        {!multi && detecting && <div className="mb-3 h-11" aria-hidden="true" />}

        {/* Question navigation — only when more than one was found. */}
        {multi && (
          <div className="mb-3 flex items-center justify-center gap-1">
            <button
              onClick={() => selectQuestion(selected - 1)}
              disabled={selected === 0}
              aria-label="Previous question"
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 disabled:opacity-30"
            >
              <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <div
              role="radiogroup"
              aria-label="Detected questions"
              className="scroll-fade flex min-w-0 snap-x snap-proximity items-center justify-center gap-2 overflow-x-auto px-1 py-1"
            >
              {questions.map((q, i) => {
                const active = i === selected;
                return (
                  <button
                    key={`${q.label}-${i}`}
                    role="radio"
                    aria-checked={active}
                    aria-label={q.label}
                    onClick={(e) => {
                      e.currentTarget.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
                      selectQuestion(i);
                    }}
                    className={`h-10 min-w-10 flex-shrink-0 snap-start whitespace-nowrap rounded-full px-3.5 text-sm font-semibold tnum transition ${
                      active
                        ? "bg-brand-600 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {shortLabel(q.label)}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => selectQuestion(selected + 1)}
              disabled={selected === questions.length - 1}
              aria-label="Next question"
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 disabled:opacity-30"
            >
              <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        )}


        <div className="mb-3 text-center" aria-live="polite">
          <p className="text-base font-medium text-ink">{instruction}</p>
          {count && <p className="mt-0.5 text-xs text-slate-500">{count}</p>}
        </div>
        {cropError && (
          <p role="alert" className="mb-2 text-center text-sm text-danger-600">
            {cropError}
          </p>
        )}

        <label className="mb-3 flex cursor-pointer items-center justify-between gap-3 rounded-md px-1 py-1">
          <span className="text-sm font-medium text-slate-700">
            Ask a specific question
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={asking}
            onClick={() => setAsking((v) => !v)}
            className={`relative h-7 w-12 flex-shrink-0 rounded-full transition ${
              asking ? "bg-brand-600" : "bg-slate-300"
            }`}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-[left] ${
                asking ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </label>

        {asking && (
          // Words, not working: a question typed in plain language is quick on
          // a phone in a way that transcribing maths never was. No autoFocus —
          // the keyboard rising over the photo before they've framed anything
          // would hide the thing they're framing.
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (enterSends(e)) {
                e.preventDefault();
                void confirm();
              }
            }}
            rows={2}
            maxLength={500}
            aria-label="Your question"
            placeholder="e.g. Why is the tension equal to Fg here?"
            className="mb-3 w-full resize-none rounded-md border border-slate-300 bg-paper px-3.5 py-2.5 text-base leading-6 text-ink outline-none transition placeholder:text-slate-400 focus:border-brand-400"
          />
        )}

        <button
          onClick={confirm}
          disabled={cropping || !fit || !canConfirm}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-5 text-base font-semibold text-white shadow-raised transition hover:bg-accent-deep active:scale-[0.98] active:bg-accent-deep disabled:cursor-not-allowed disabled:bg-brand-300 disabled:text-white/90 disabled:opacity-45 disabled:shadow-none"
        >
          {cropping ? <Spinner className="h-5 w-5" /> : null}
          {asking ? "Ask" : "Use this question"}
        </button>
      </div>
      )}
    </div>
  );
}

function Edge({
  handle,
  onStart,
  className,
}: {
  handle: Handle;
  onStart: (h: Handle) => (e: React.PointerEvent) => void;
  className: string;
}) {
  return (
    <div
      onPointerDown={onStart(handle)}
      className={`absolute ${className}`}
      aria-hidden="true"
    />
  );
}

function Corner({
  handle,
  onStart,
  className,
  active,
}: {
  handle: Handle;
  onStart: (h: Handle) => (e: React.PointerEvent) => void;
  className: string;
  /** Bold and pulsing — see the note where the corners are placed. */
  active: boolean;
}) {
  const top = handle.includes("n");
  const left = handle.includes("w");
  const width = active ? 5 : 3;
  const size = active ? 26 : 20;
  // The 44px hit target is centred on the box's corner (22px in). Offsetting
  // by the border width keeps the bracket's inner edge on the box line at
  // either weight, so going bold thickens outward instead of shifting.
  const offset = 22 - width;
  const style: React.CSSProperties = {
    width: size,
    height: size,
    [top ? "top" : "bottom"]: offset,
    [left ? "left" : "right"]: offset,
    [top ? "borderTopWidth" : "borderBottomWidth"]: width,
    [left ? "borderLeftWidth" : "borderRightWidth"]: width,
    // Breathe around the bracket's own vertex, so the arms extend and retract
    // from the corner rather than the whole mark drifting.
    transformOrigin: `${top ? "top" : "bottom"} ${left ? "left" : "right"}`,
  };
  const rounded = top
    ? left ? "rounded-tl-sm" : "rounded-tr-sm"
    : left ? "rounded-bl-sm" : "rounded-br-sm";
  return (
    <div
      onPointerDown={onStart(handle)}
      className={`absolute h-11 w-11 ${className}`}
      aria-hidden="true"
    >
      <span
        style={style}
        className={`absolute border-brand-500 drop-shadow-[0_0_1px_rgb(255_255_255/0.9)] transition-[width,height,border-width,top,left,right,bottom] duration-200 ${rounded} ${
          active ? "animate-corner-pulse" : ""
        }`}
      />
    </div>
  );
}

/** The raw detection numbers for the `?debug=boxes` view. */
function DebugPanel({
  info,
  denied,
  sent,
  gridFlag,
  preview,
  detecting,
  failure,
}: {
  info: DetectionDebug | null;
  denied: boolean;
  sent: { w: number; h: number; grid: boolean } | null;
  gridFlag: boolean;
  preview: { w: number; h: number };
  detecting: boolean;
  failure: string | null;
}) {
  const r = (n: number) => Math.round(n);
  return (
    <div className="absolute inset-x-2 top-2 z-20 max-h-[45%] overflow-auto rounded-sm bg-black/80 p-2 font-mono text-[10px] leading-4 text-white">
      <p>
        preview {preview.w}×{preview.h} · sent {sent ? `${sent.w}×${sent.h}` : "?"} · grid{" "}
        {sent ? (sent.grid ? "sent" : "not sent") : "?"} (flag {gridFlag ? "on" : "off"})
      </p>
      {denied ? (
        <p>debug not allowed: add &amp;code=… (the server&apos;s DEBUG_CODE)</p>
      ) : !info ? (
        <p>{detecting ? "detecting…" : failure ? `detection ${failure}` : "no debug data (detection failed or cached)"}</p>
      ) : (
        <>
          <p>
            model {info.model} · told {info.width}×{info.height} · primary {info.primaryIndex}
          </p>
          {info.raw.map((b, i) => {
            const out =
              Math.min(b.x1, b.x2) < 0 ||
              Math.min(b.y1, b.y2) < 0 ||
              Math.max(b.x1, b.x2) > info.width ||
              Math.max(b.y1, b.y2) > info.height;
            return (
              <p key={i} className={out ? "text-red-400" : undefined}>
                {b.label}: {r(b.x1)},{r(b.y1)} → {r(b.x2)},{r(b.y2)}
                {out ? "  OUT OF BOUNDS" : ""}
              </p>
            );
          })}
        </>
      )}
    </div>
  );
}

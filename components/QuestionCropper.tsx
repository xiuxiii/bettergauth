"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type {
  DetectedQuestion,
  NormalizedRect,
  QuestionDetection,
  Subject,
} from "@/lib/tutor/types";
import { cropDataUrl, detectContentRectNormalized, imageSize } from "@/lib/image";
import { Spinner } from "@/components/States";

/** The subjects the capture step offers. Values are the pipeline's own Subject. */
type CaptureSubject = Extract<Subject, "Mathematics" | "Physics" | "Chemistry">;
const SUBJECTS: { value: CaptureSubject; label: string }[] = [
  { value: "Mathematics", label: "Math" },
  { value: "Physics", label: "Physics" },
  { value: "Chemistry", label: "Chemistry" },
];
const LAST_SUBJECT_KEY = "stem-tutor:last-subject";

type Handle = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const FULL: NormalizedRect = { x: 0, y: 0, w: 1, h: 1 };
const MIN_SIZE = 0.06; // smallest crop, as a fraction of the image
const AUTO_PAD = 0.015; // breathing room around a detected question

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
 * box, reset to the detected crop, pick a subject, and confirm. The confirmed
 * crop then enters the existing MindGap flow unchanged.
 */
export default function QuestionCropper({
  image,
  onConfirm,
  onCancel,
}: {
  /** Normalized (upright, downscaled) photo of the page as a data URL. */
  image: string;
  onConfirm: (result: { imageDataUrl: string; subject: CaptureSubject | null }) => void;
  onCancel: () => void;
}) {
  // --- Detection -------------------------------------------------------------
  const [detecting, setDetecting] = useState(true);
  const [questions, setQuestions] = useState<DetectedQuestion[]>([]);
  const [selected, setSelected] = useState(0);
  const [rect, setRect] = useState<NormalizedRect>(FULL);
  // The auto-detected crop for the current selection (what "Reset" restores).
  const [autoRect, setAutoRect] = useState<NormalizedRect>(FULL);

  useEffect(() => {
    let cancelled = false;
    async function detect() {
      let result: QuestionDetection | null = null;
      try {
        // The model is asked for boxes in absolute pixels, so it has to be told
        // the image's size. Measured here rather than read from the <img>'s
        // onLoad, which may not have fired yet when detection starts.
        const { width, height } = await imageSize(image);
        const res = await fetch("/api/detect-questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image, width, height }),
        });
        if (res.ok) result = (await res.json()) as QuestionDetection;
      } catch {
        // fall through to the local fallback
      }
      if (cancelled) return;

      if (result && result.questions.length > 0) {
        const i = clamp(result.primaryIndex, 0, result.questions.length - 1);
        const auto = padded(result.questions[i].rect);
        setQuestions(result.questions);
        setSelected(i);
        setAutoRect(auto);
        setRect(auto);
      } else {
        // No model detection: box the ink on the page (the existing local
        // heuristic), or leave the whole photo selected.
        let local: NormalizedRect | null = null;
        try {
          local = await detectContentRectNormalized(image);
        } catch {
          local = null;
        }
        if (cancelled) return;
        const auto = local ?? FULL;
        setQuestions([]);
        setAutoRect(auto);
        setRect(auto);
      }
      setDetecting(false);
    }
    void detect();
    return () => {
      cancelled = true;
    };
  }, [image]);

  function selectQuestion(i: number) {
    if (i < 0 || i >= questions.length) return;
    const auto = padded(questions[i].rect);
    setSelected(i);
    setAutoRect(auto);
    setRect(auto);
  }

  // --- Subject ---------------------------------------------------------------
  const [subject, setSubject] = useState<CaptureSubject>("Mathematics");
  useEffect(() => {
    try {
      const last = window.localStorage.getItem(LAST_SUBJECT_KEY);
      if (SUBJECTS.some((s) => s.value === last)) setSubject(last as CaptureSubject);
    } catch {
      // storage unavailable: keep the default
    }
  }, []);
  function chooseSubject(s: CaptureSubject) {
    setSubject(s);
    try {
      window.localStorage.setItem(LAST_SUBJECT_KEY, s);
    } catch {
      // ignore
    }
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
    const scale = Math.min(stage.w / img.w, stage.h / img.h);
    const w = img.w * scale;
    const h = img.h * scale;
    return { w, h, x: (stage.w - w) / 2, y: (stage.h - h) / 2 };
  }, [stage, img]);

  // --- Drag / resize / move --------------------------------------------------
  const drag = useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    rect: NormalizedRect;
  } | null>(null);

  const startDrag = (handle: Handle) => (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { handle, startX: e.clientX, startY: e.clientY, rect };
  };

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d || !fit) return;
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
    },
    [fit],
  );

  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  // --- Confirm / cancel ------------------------------------------------------
  const [cropping, setCropping] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);

  async function confirm() {
    if (cropping) return;
    setCropping(true);
    setCropError(null);
    try {
      const imageDataUrl = sameRect(rect, FULL) ? image : await cropDataUrl(image, rect);
      onConfirm({ imageDataUrl, subject });
    } catch {
      setCropError("Could not crop the photo. Try again.");
      setCropping(false);
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
  const multi = questions.length > 1;
  const status = detecting
    ? "Finding the questions…"
    : multi
      ? `${questions.length} questions found — choose one, or adjust the box`
      : questions.length === 1
        ? "Adjust the box if it missed anything"
        : "Drag the box around the question";

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
        <h2
          id="question-cropper-title"
          className="min-w-0 flex-1 truncate text-sm font-semibold text-ink"
        >
          Select the question
        </h2>
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
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-ink"
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
              className={`absolute cursor-move rounded-sm border-2 ${
                detecting ? "animate-pulse border-brand-300" : "border-brand-500"
              }`}
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
              <Corner handle="nw" onStart={startDrag} className="-left-[22px] -top-[22px] cursor-nwse-resize" bracket="rounded-tl-sm border-l-[3px] border-t-[3px] left-[19px] top-[19px]" />
              <Corner handle="ne" onStart={startDrag} className="-right-[22px] -top-[22px] cursor-nesw-resize" bracket="rounded-tr-sm border-r-[3px] border-t-[3px] right-[19px] top-[19px]" />
              <Corner handle="sw" onStart={startDrag} className="-bottom-[22px] -left-[22px] cursor-nesw-resize" bracket="rounded-bl-sm border-b-[3px] border-l-[3px] bottom-[19px] left-[19px]" />
              <Corner handle="se" onStart={startDrag} className="-bottom-[22px] -right-[22px] cursor-nwse-resize" bracket="rounded-br-sm border-b-[3px] border-r-[3px] bottom-[19px] right-[19px]" />
            </div>
            </div>
          </>
        )}
      </div>

      {/* Controls */}
      <div className="border-t border-hairline bg-surface px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3">
        {/* Question navigation — only when more than one was found. */}
        {multi && (
          <div className="mb-3 flex items-center gap-1">
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
              className="scroll-fade flex min-w-0 flex-1 snap-x snap-proximity items-center gap-2 overflow-x-auto px-1 py-1 pr-6"
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

        {/* Subject — context for the existing pipeline, nothing more. */}
        <div
          role="radiogroup"
          aria-label="Subject"
          className="scroll-fade -mx-1 mb-3 flex snap-x snap-proximity items-center gap-2 overflow-x-auto px-1 pr-6"
        >
          {SUBJECTS.map((s) => {
            const active = s.value === subject;
            return (
              <button
                key={s.value}
                role="radio"
                aria-checked={active}
                onClick={() => chooseSubject(s.value)}
                className={`h-10 flex-shrink-0 snap-start whitespace-nowrap rounded-full border px-4 text-sm font-medium transition ${
                  active
                    ? "border-brand-500 bg-brand-50 text-brand-800"
                    : "border-slate-300 bg-surface text-slate-700 hover:border-brand-400"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        <p className="mb-2 text-xs text-slate-500" aria-live="polite">
          {multi && !detecting ? `${questions[selected].label} · ` : ""}
          {status}
        </p>
        {cropError && <p className="mb-2 text-sm text-danger-600">{cropError}</p>}

        <button
          onClick={confirm}
          disabled={cropping || !fit}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-5 text-base font-semibold text-white shadow-raised transition hover:bg-brand-700 active:scale-[0.98] active:bg-brand-700 disabled:bg-brand-300 disabled:text-white/90 disabled:shadow-none"
        >
          {cropping ? <Spinner className="h-5 w-5" /> : null}
          Use this question
        </button>
      </div>
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
  bracket,
}: {
  handle: Handle;
  onStart: (h: Handle) => (e: React.PointerEvent) => void;
  className: string;
  bracket: string;
}) {
  return (
    <div
      onPointerDown={onStart(handle)}
      className={`absolute h-11 w-11 ${className}`}
      aria-hidden="true"
    >
      <span
        className={`absolute h-5 w-5 border-brand-500 drop-shadow-[0_0_1px_rgb(255_255_255/0.9)] ${bracket}`}
      />
    </div>
  );
}

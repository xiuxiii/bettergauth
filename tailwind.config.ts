import type { Config } from "tailwindcss";

/**
 * MindGap's warm, premium palette. The `slate` and `brand` scales are
 * intentionally *remapped* (not just extended) so the whole app reskins from
 * its old slate/electric-blue look to warm ivory + indigo without touching
 * every className: existing `bg-slate-50`, `text-slate-900`, `bg-brand-600`,
 * etc. resolve to the new system.
 *
 * Neutral roles (Geist convention): light steps = backgrounds, middle = borders,
 * dark = text. 400 is decorative / placeholder only — never body or label text.
 *
 * The semantic aliases (paper/surface/ink/hairline) and the neutral scale are
 * CSS variables (see globals.css) so the warm dark theme swaps them in place.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Semantic aliases (light / dark values live in globals.css)
        paper: "rgb(var(--paper) / <alpha-value>)", // page ground
        surface: "rgb(var(--surface) / <alpha-value>)", // raised cards
        ink: "rgb(var(--ink) / <alpha-value>)", // primary text
        hairline: "rgb(var(--hairline) / <alpha-value>)", // borders
        accent: {
          DEFAULT: "#4E54DD",
          deep: "#3F44BE",
          tint: "#E1E6FD",
        },
        // Warm neutral remap of Tailwind's slate scale
        slate: {
          50: "rgb(var(--slate-50) / <alpha-value>)", // page (= paper)
          100: "rgb(var(--slate-100) / <alpha-value>)", // hover bg / subtle fill
          200: "rgb(var(--slate-200) / <alpha-value>)", // default border
          300: "rgb(var(--slate-300) / <alpha-value>)", // hover/active border, input border
          400: "rgb(var(--slate-400) / <alpha-value>)", // placeholder / decorative ONLY
          500: "rgb(var(--slate-500) / <alpha-value>)", // secondary text
          600: "rgb(var(--slate-600) / <alpha-value>)", // body text on tinted surfaces
          700: "rgb(var(--slate-700) / <alpha-value>)",
          800: "rgb(var(--slate-800) / <alpha-value>)",
          900: "rgb(var(--slate-900) / <alpha-value>)", // primary text (= ink)
        },
        // Indigo / periwinkle remap of the brand scale (MindGap)
        brand: {
          50: "#EEF1FE",
          100: "#E1E6FD",
          200: "#C7CEFB",
          300: "#A2ACF6",
          400: "#7A83EE",
          500: "#5C63E6",
          600: "#4E54DD",
          700: "#3F44BE",
          800: "#343A98",
          900: "#2F3479",
        },
        // Warm status palettes (replace Tailwind's stock rose/amber/emerald)
        danger: {
          50: "#FBEFEC",
          100: "#F5D9D2",
          200: "#EBB5A9",
          600: "#B4432F",
          700: "#963627",
          800: "#742A1E",
        },
        warn: {
          50: "#FAF1DF",
          100: "#F3E0B8",
          200: "#E8C98A",
          600: "#A56A12",
          700: "#87560F",
          800: "#6A430C",
        },
        success: {
          50: "#EAF3EA",
          100: "#D2E5D1",
          200: "#AECFAD",
          600: "#3E7A43",
          700: "#326437",
          800: "#284F2C",
        },
      },
      // One radius scale: cards/sheets = lg, controls = md, nested boxes = sm,
      // pills = full. Overrides Tailwind's defaults on purpose.
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "20px",
      },
      // Warm-tinted (never grey) shadows, used sparingly.
      boxShadow: {
        card: "0 1px 2px rgb(32 27 20 / 0.05)",
        raised:
          "0 1px 2px rgb(32 27 20 / 0.06), 0 8px 24px -8px rgb(32 27 20 / 0.10)",
        sheet: "0 -4px 24px -4px rgb(32 27 20 / 0.18)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Newsreader", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;

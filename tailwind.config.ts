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
  // The app themes itself with CSS variables keyed off `data-theme` (see
  // globals.css), so the `dark:` variant has to follow that attribute too.
  // Left on the default "media" it would track the OS and quietly ignore an
  // explicit Light/Dark choice.
  darkMode: ["selector", '[data-theme="dark"]'],
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
          tint: "rgb(var(--brand-100) / <alpha-value>)",
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
        // Mid steps (200-600) are fixed indigo in both themes — they carry the
        // brand. The tint and deep steps are CSS vars so tinted surfaces and
        // on-tint text flip with the theme (see globals.css).
        brand: {
          50: "rgb(var(--brand-50) / <alpha-value>)",
          100: "rgb(var(--brand-100) / <alpha-value>)",
          200: "rgb(var(--brand-200) / <alpha-value>)",
          300: "#A2ACF6",
          400: "#7A83EE",
          500: "#5C63E6",
          600: "#4E54DD",
          700: "rgb(var(--brand-700) / <alpha-value>)",
          800: "rgb(var(--brand-800) / <alpha-value>)",
          900: "rgb(var(--brand-900) / <alpha-value>)",
        },
        // Warm status palettes (replace Tailwind's stock rose/amber/emerald)
        danger: {
          50: "rgb(var(--danger-50) / <alpha-value>)",
          100: "rgb(var(--danger-100) / <alpha-value>)",
          200: "rgb(var(--danger-200) / <alpha-value>)",
          600: "rgb(var(--danger-600) / <alpha-value>)",
          700: "rgb(var(--danger-700) / <alpha-value>)",
          800: "rgb(var(--danger-800) / <alpha-value>)",
          // Fixed fills for solid destructive buttons with white text. 600/700
          // above are theme variables that turn pale salmon in dark mode, which
          // put white text at 2.5:1 (rest) and 1.8:1 (hover).
          solid: "#B4432F",
          deep: "#963627",
        },
        warn: {
          50: "rgb(var(--warn-50) / <alpha-value>)",
          100: "rgb(var(--warn-100) / <alpha-value>)",
          200: "rgb(var(--warn-200) / <alpha-value>)",
          600: "rgb(var(--warn-600) / <alpha-value>)",
          700: "rgb(var(--warn-700) / <alpha-value>)",
          800: "rgb(var(--warn-800) / <alpha-value>)",
        },
        success: {
          50: "rgb(var(--success-50) / <alpha-value>)",
          100: "rgb(var(--success-100) / <alpha-value>)",
          200: "rgb(var(--success-200) / <alpha-value>)",
          600: "rgb(var(--success-600) / <alpha-value>)",
          700: "rgb(var(--success-700) / <alpha-value>)",
          800: "rgb(var(--success-800) / <alpha-value>)",
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

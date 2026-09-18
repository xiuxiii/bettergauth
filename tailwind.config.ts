import type { Config } from "tailwindcss";

/**
 * Aria's warm, premium palette. The `slate` and `brand` scales are intentionally
 * *remapped* (not just extended) so the whole app reskins from its old
 * slate/electric-blue look to warm ivory + bordeaux without touching every
 * className: existing `bg-slate-50`, `text-slate-900`, `bg-brand-600`, etc. now
 * resolve to the new system. New code can also use the semantic aliases
 * (paper/surface/ink/hairline/accent).
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
        // Semantic aliases
        paper: "#F7F3EC", // page ground
        surface: "#FCFAF5", // raised cards
        ink: "#201B14", // primary text
        hairline: "#E7E0D3", // borders
        accent: {
          DEFAULT: "#4E54DD",
          deep: "#3F44BE",
          tint: "#E1E6FD",
        },
        // Warm neutral remap of Tailwind's slate scale
        slate: {
          50: "#F7F3EC",
          100: "#EFE8DB",
          200: "#E7E0D3",
          300: "#DDD5C6",
          400: "#A79E8E",
          500: "#8A8070",
          600: "#6B6459",
          700: "#3B342A",
          800: "#2A241C",
          900: "#201B14",
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

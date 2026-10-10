/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Only the e2e accounts profile sets this, for a second build with its own
  // baked-in env beside .next (e2e/run.mjs). Unset everywhere else.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The owner page runs the evals on the deploy itself (/api/owner/eval), so
  // the case files, and for running them the photos, ship with those two
  // routes only. They're read by path at runtime, which the build's file
  // tracing only guesses at; this makes it certain.
  outputFileTracingIncludes: {
    "/api/owner/cases": ["./evals/cases/**/*"],
    "/api/owner/eval": ["./evals/cases/**/*", "./evals/images/**/*"],
  },
};

export default nextConfig;

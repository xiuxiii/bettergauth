/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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

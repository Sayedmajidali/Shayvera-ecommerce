import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const isHttps = (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://");

/**
 * Content Security Policy.
 * Razorpay Checkout needs its script origin, its iframe origins and its API for XHR.
 * 'unsafe-inline' for scripts is required by Next.js inline bootstrap scripts unless
 * nonces are used; see SECURITY_REVIEW.md (accepted risk, mitigated by strict
 * object-src/base-uri/frame-ancestors and output encoding by React).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${isDev ? "'unsafe-eval' " : ""}https://checkout.razorpay.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.razorpay.com",
  "font-src 'self' data:",
  `connect-src 'self' https://*.razorpay.com${isDev ? " ws: wss:" : ""}`,
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isHttps ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Isolates the browsing context from cross-origin openers; popups (Razorpay UPI/3-D Secure) still work.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  {
    key: "Permissions-Policy",
    value:
      'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.razorpay.com")',
  },
  ...(isHttps
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  // Session-heavy app (cart, account, admin): classic dynamic rendering model.
  cacheComponents: false,
  // The Docker image sets NEXT_OUTPUT=standalone for a minimal runtime; local `next start` is unaffected.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["sharp", "razorpay"],
  images: {
    localPatterns: [{ pathname: "/media/**" }],
    formats: ["image/avif", "image/webp"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

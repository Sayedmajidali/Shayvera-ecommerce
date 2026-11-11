import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site";

// Built per request so the address comes from the server's runtime settings (NEXT_PUBLIC_APP_URL),
// not from whatever was set when the Docker image was built.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/account",
          "/api/",
          "/cart",
          "/checkout",
          "/order/",
          "/invoice/",
          "/credit-note/",
          "/track/",
          "/search",
          "/login",
          "/register",
          "/forgot-password",
          "/reset-password",
        ],
      },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}

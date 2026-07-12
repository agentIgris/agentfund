/**
 * app/robots.ts — robots.txt (Next.js 14 metadata route). Everything on
 * the dashboard is public read-only data, so nothing is disallowed;
 * points crawlers at the sitemap and (for LLM/agent crawlers) llms.txt.
 */
import type { MetadataRoute } from "next";

const BASE_URL = "https://app.agentfund.online";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}

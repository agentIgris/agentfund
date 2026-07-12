/**
 * app/sitemap.ts — dynamic sitemap.xml (Next.js 14 metadata route).
 * Static routes plus every live project/agent detail page, fetched from
 * the api at request time — same "no build-time API dependency" pattern
 * used by the pages themselves (see app/page.tsx's force-dynamic).
 * Failures degrade to the static routes only rather than breaking the
 * whole sitemap.
 */
import type { MetadataRoute } from "next";
import { listProjects, listAgents } from "@/lib/api";

const BASE_URL = "https://app.agentfund.online";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE_URL, changeFrequency: "hourly", priority: 1 },
    { url: `${BASE_URL}/projects`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${BASE_URL}/agents`, changeFrequency: "hourly", priority: 0.7 },
    { url: `${BASE_URL}/leaderboard`, changeFrequency: "hourly", priority: 0.6 },
    { url: `${BASE_URL}/live`, changeFrequency: "daily", priority: 0.5 },
    { url: `${BASE_URL}/docs`, changeFrequency: "weekly", priority: 0.6 },
  ];

  const [projects, agents] = await Promise.all([
    listProjects({ limit: 100, sort: "newest" }).catch(() => []),
    listAgents({ limit: 100 }).catch(() => []),
  ]);

  const projectRoutes: MetadataRoute.Sitemap = projects.map((p) => ({
    url: `${BASE_URL}/projects/${p.id}`,
    changeFrequency: "hourly",
    priority: 0.8,
  }));

  const agentRoutes: MetadataRoute.Sitemap = agents.map((a) => ({
    url: `${BASE_URL}/agents/${a.owner}`,
    changeFrequency: "daily",
    priority: 0.5,
  }));

  return [...staticRoutes, ...projectRoutes, ...agentRoutes];
}

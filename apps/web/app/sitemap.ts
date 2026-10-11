import type { MetadataRoute } from "next";
import { createServerClient } from "@/lib/supabase/server";
import { LIST_PATH } from "@/lib/routes";
import { siteUrl } from "@/lib/site-url";

// Rendered per request (it reads the database), so a newly curated project shows up without a rebuild.
export const dynamic = "force-dynamic";

/** The public pages plus one entry per project on the public list (curated projects only: public_list). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const at = (path: string): string => new URL(path, base).toString();
  const pages: MetadataRoute.Sitemap = [
    { url: at("/"), changeFrequency: "daily", priority: 1 },
    { url: at(LIST_PATH), changeFrequency: "daily", priority: 0.9 },
    { url: at("/coach"), changeFrequency: "weekly", priority: 0.5 },
  ];
  try {
    const db = await createServerClient();
    const { data, error } = await db.from("public_list").select("slug, checked_at").order("slug", { ascending: true }).limit(5000);
    if (error || !data) return pages;
    const projects = data.map((row) => ({
      url: at(`/projects/${encodeURIComponent(String(row.slug))}`),
      lastModified: typeof row.checked_at === "string" ? new Date(row.checked_at) : undefined,
      changeFrequency: "daily" as const,
      priority: 0.7,
    }));
    return [...pages, ...projects];
  } catch {
    // A database hiccup must not 500 the sitemap; the static pages still go out.
    return pages;
  }
}

import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

// Public pages are open to crawlers; the signed-in app, the login form and the API are not.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/garapan", "/watchlist", "/wallets", "/settings", "/changes", "/login"] },
    sitemap: new URL("/sitemap.xml", siteUrl()).toString(),
  };
}

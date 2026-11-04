import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/console/", "/auth"],
    },
    sitemap: "https://devora.my.id/sitemap.xml",
  };
}

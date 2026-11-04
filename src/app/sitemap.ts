import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://devora.my.id";
  const now = new Date();

  return [
    { url: base, lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${base}/models`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/events`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/stats`, lastModified: now, changeFrequency: "daily", priority: 0.6 },
  ];
}

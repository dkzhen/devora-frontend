"use client";

import { useState } from "react";

/**
 * Provider mark.
 *
 * Provider is a display concern — the gateway resolves routing from the catalogue, not
 * from this — so it appears as an avatar, not as text. Assets live in
 * `public/providers/<slug>.svg` (preferred) or `<slug>.png`, where the slug is the
 * provider lowercased with any run of non-alphanumeric characters collapsed to a
 * hyphen: "Token Harbor" -> "token-harbor".
 *
 * Until an asset exists the initial stands in, so an unseen provider still reads as a
 * deliberate mark rather than a broken image. Both marks occupy the same 22x22 box, so
 * rows do not shift when a logo lands.
 */
export const providerAsset = (provider: string) =>
  `/providers/${provider.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}.svg`;

export function ProviderMark({ provider, size = 22 }: { provider: string; size?: number }) {
  const [extIndex, setExtIndex] = useState(0);
  const slug = provider.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const extensions = [".svg", ".png"];

  if (extIndex >= extensions.length) {
    // Fallback: Devora icon instead of a plain letter
    return (
      <img
        className="provider-mark provider-default"
        style={{ width: size, height: size }}
        src="/devora-icon-red-nobg.png"
        alt={`${provider} (default)`}
        title={provider}
        width={size}
        height={size}
        loading="lazy"
      />
    );
  }

  return (
    <img
      className="provider-mark"
      style={{ width: size, height: size }}
      src={`/providers/${slug}${extensions[extIndex]}`}
      alt={`${provider} logo`}
      title={provider}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setExtIndex(i => i + 1)}
    />
  );
}

"use client";

import { useState } from "react";

/**
 * Provider mark.
 *
 * Provider is a display concern — the gateway resolves routing from the catalogue, not
 * from this — so it appears as an avatar, not as text. Assets live in
 * `public/providers/<slug>.svg`, where the slug is the provider lowercased with any run
 * of non-alphanumeric characters collapsed to a hyphen: "Token Harbor" -> "token-harbor".
 *
 * Until an asset exists the initial stands in, so an unseen provider still reads as a
 * deliberate mark rather than a broken image. Both marks occupy the same 22x22 box, so
 * rows do not shift when a logo lands.
 */
export const providerAsset = (provider: string) =>
  `/providers/${provider.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}.svg`;

export function ProviderMark({ provider, size = 22 }: { provider: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initial = provider.trim().charAt(0).toUpperCase() || "?";

  if (failed) {
    return (
      <span className="provider-fallback" style={{ width: size, height: size }} aria-hidden="true">
        {initial}
      </span>
    );
  }

  return (
    <img
      className="provider-mark"
      style={{ width: size, height: size }}
      src={providerAsset(provider)}
      alt={`${provider} logo`}
      title={provider}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

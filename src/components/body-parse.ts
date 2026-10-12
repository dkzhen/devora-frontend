export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** How a body was interpreted, so the UI can label it accurately. */
export type Parsed =
  | { shape: "json"; value: Json }
  | { shape: "sse"; frames: Json[] }
  | { shape: "text" };

/** An SSE body starts with `data:` on its own line. */
export function looksLikeSse(s: string): boolean {
  return /^data:\s/m.test(s);
}

function parseSse(source: string): Parsed {
  const frames: Json[] = [];
  const lines = source.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "") continue;
    try { frames.push(JSON.parse(payload) as Json); } catch { /* non-JSON frame */ }
  }
  return { shape: "sse", frames };
}

export function parseBody(source: string): Parsed {
  try {
    return { shape: "json", value: JSON.parse(source) as Json };
  } catch {
    // not one JSON document
  }
  if (looksLikeSse(source)) return parseSse(source);
  return { shape: "text" };
}

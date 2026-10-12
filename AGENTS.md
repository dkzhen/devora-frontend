# Devora Frontend

## Overview
Devora marketing landing plus authenticated console for AI Gateway, Billing, Credits, and Temp Mail. Stack: Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Bun. Frontend prototype only; no backend contract is wired yet.

## Commands
- `bun install` — install dependencies
- `bun run dev` — local dev server at `http://localhost:3000`
- `bun run typecheck` — TypeScript check
- `bun run build` — production build

## Conventions
- App Router pages live in `src/app/`; reusable console components in `src/components/`.
- Use semantic HTML, Lucide icons, CSS variables, responsive layouts, and accessible labels.
- All protected console routes redirect unauthenticated visitors to `/auth?next=<path>`.

## Boundaries
- **NEVER** commit `.env*`, credentials, real API keys, or user data.
- **NEVER** represent seeded UI demo metrics/API keys as live production data; label sample/demo state.
- **ALWAYS** keep the landing page `/` public; all other product pages require the `/auth` flow.
- **ALWAYS** honor `prefers-reduced-motion` and keyboard-accessible controls.

## Dependencies
- Next.js 16 + React 19: SSR and route handling.
- Tailwind CSS 4 + Lucide React: styling and icons.

## Config
No required environment variables for the prototype. Do not add production API origins or secrets without a real backend contract.

## Error Handling
Use visible inline form errors, disabled/loading states for async-style UI actions, and safe clipboard fallback feedback. No network calls are expected in this frontend-only prototype.

## Troubleshooting
- If CSS is missing, verify `src/app/globals.css` imports Tailwind and `postcss.config.mjs` enables `@tailwindcss/postcss`.
- If route types are stale, remove only generated `.next` output and rerun `bun run typecheck`.
- If port 3000 is occupied, stop the old dev server or run `bun run dev -- --port <port>`.

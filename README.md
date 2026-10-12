# Devora — frontend

Web front end for the Devora AI gateway: a console for API keys, usage, credits and vouchers;
an admin area for the model catalogue, events, users and rate limits; and public pages listing
the catalogue and whatever events are running.

Next.js 16 (App Router) · React 19 · Tailwind v4 · Clerk for auth.

---

## What this is

Devora is a gateway that puts one OpenAI-compatible endpoint in front of several model
providers. This repository is everything a person sees: the marketing page, the console they
sign in to, and the public pages that need no account.

**It holds no secrets that matter and performs no billing.** Every number on screen — prices,
token counts, credit balances, rate limits — is read from the backend on each load. That is
deliberate: the operator changes a price in the console and these pages reflect it without a
deploy. Nothing here is the source of truth, and nothing here decides what a request costs.

---

## Requirements

- **Node.js 22+** (or Bun 1.4+ — the lockfile is `bun.lock`)
- A running Devora backend
- A Clerk application (optional — see *Running without Clerk*)

---

## Getting started

```bash
# 1. Install
npm install          # or: bun install

# 2. Configure
cp .env.example .env.local
#    then fill in the values — each one is documented in that file

# 3. Run
npm run dev          # http://localhost:3000
```

### Other commands

```bash
npm run build        # production build
npm start            # serve the production build
npm run typecheck    # tsc --noEmit
```

There is no test suite. Verification is `typecheck` plus a build; the project's stance is that
a passing build and a correct type signature catch more here than a shallow render test would.

---

## Environment

Three variables. `.env.example` documents each one properly; the short version:

| Variable | Purpose |
|---|---|
| `BACKEND_ORIGIN` | Where the Next server reaches the Devora API. **Server-side only.** |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk instance selector — `pk_test_…` or `pk_live_…` |
| `CLERK_SECRET_KEY` | Required by `clerkMiddleware` for session verification. Server-side only. |

`NEXT_PUBLIC_*` is the only prefix Next inlines into the browser bundle, so the secret never
leaves the server.

### Running without Clerk

Leave the Clerk keys empty. `src/lib/clerk-config.ts` detects the absence and the app runs as a
public preview: the landing page, catalogue and events all render, `/console/*` is ungated, and
`/auth` shows a setup notice instead of a form. Useful for working on layout without an account.

---

## How the API is reached

The browser never talks to the backend directly. It calls `/backend/...`, and `next.config.ts`
rewrites that to `BACKEND_ORIGIN` on the server:

```
Browser  →  /backend/api/v1/models        (same origin)
Vercel   →  https://api.<domain>/api/v1/models   (server-side rewrite)
Backend  →  answers
```

Two consequences worth knowing:

- **No CORS is involved** in normal operation, because the browser's request is same-origin.
  The backend still configures CORS for direct API clients, but the console does not depend on it.
- **`BACKEND_ORIGIN` must be reachable from wherever this app is deployed**, not from the
  visitor's machine. A production deploy with `BACKEND_ORIGIN=http://127.0.0.1:8787` fails.

---

## Authentication

Clerk, email/password only — no OAuth providers are configured.

`src/proxy.ts` (Next 16's middleware) is the gate. It runs on every request and does two things:

1. **Requires a session** for `/console/*`, redirecting to `/auth?next=…` when absent.
2. **Requires the `SUPERUSER` plan** for `/console/admin/*`, returning a plain **404** rather
   than a 403 when it is missing.

That second choice is deliberate. A 403 confirms the route exists; a 404 makes the admin area
indistinguishable from a path that was never there, so it cannot be discovered by probing.

The plan is read from the Devora database through the backend, never from Clerk metadata or
anything the request carries. **The check fails closed** — if the backend is unreachable, the
answer is "not an operator".

> **Hiding the nav group is cosmetic.** Anyone who knows the path reaches the middleware, which
> is why the decision is made there and not in the UI.

---

## Routes

| Route | Access | |
|---|---|---|
| `/` | public | Landing page |
| `/models` | public | Full catalogue — search, provider filter, sort |
| `/events` | public | Events currently running |
| `/auth` | public | Sign in / sign up |
| `/console/ai` | session | Base URL, API keys, usage, available models |
| `/console/billing` | session | Plan and invoices |
| `/console/credits` | session | Balance and ledger |
| `/console/vouchers` | session | Redeem codes |
| `/console/admin/models` | SUPERUSER | Catalogue CRUD |
| `/console/admin/events` | SUPERUSER | Create and stop events |
| `/console/admin/users` | SUPERUSER | Accounts, plans, credits |
| `/console/admin/usage` | SUPERUSER | Request ledger and totals |
| `/console/admin/rate-limits` | SUPERUSER | Per-plan RPM/TPM |

---

## Layout

```
src/
├── app/
│   ├── (protected)/console/   Console + admin (gated by src/proxy.ts)
│   ├── auth/ events/ models/  Public pages
│   ├── globals.css            All styling. Single file, no CSS modules.
│   └── layout.tsx             Root, mounts the Clerk provider
├── components/                One file per page or shared primitive
├── lib/
│   ├── clerk-config.ts        Detects whether Clerk is configured
│   ├── credits.ts             Credit formatting
│   └── tokens.ts              Compact counters + full context formatting
└── proxy.ts                   Auth and plan gate (Next 16 middleware)
```

**Styling is one global stylesheet**, not Tailwind utility soup. Tailwind is present for the
build pipeline, but components carry semantic class names (`mp-item`, `land-price-card`) and the
rules live in `globals.css`. The design tokens are CSS custom properties at the top:

```css
--cream:#f5efe2  --paper:#fffdf8  --ink:#17140d
--mint:#12b3a4   --coral:#ff5b57   --mustard:#ffc531
--violet:#6b5be6 --sky:#3aa0ff
--display:"Bricolage Grotesque"  --body:"DM Sans"
```

---

## Notes for contributors

Things that are the way they are on purpose:

- **Provider marks are avatars, not text.** `provider` is a display concern; routing uses
  `upstream_model_id`. Logos live in `public/providers/<slug>.svg` and fall back to the
  provider's initial when absent — see the README in that folder.
- **No test files.** `typecheck` and `build` are the gate.
- **`CLERK_SECRET_KEY` belongs here.** It looks like it should not, but `clerkMiddleware`
  verifies sessions server-side and needs it. Removing it breaks every route with
  `Missing secretKey`.
- **A free price is not always `free: true`.** A model priced at zero and a model freed by a
  running event are the same offer to a reader, so both render as `free`.
- **`formatTokens` and `formatContext` are separate on purpose.** The first abbreviates for
  counters that grow (`1.2M`); the second writes a context window out in full (`1,000,000`)
  because it is a fixed property and the reader wants the actual number.

---

## Deployment

Built for Vercel. Import the repository, then set the three environment variables. Point the
Clerk keys at the same instance the backend uses — one session serves both the page and the
API only when both verify against the same instance.

Note that **Clerk development and production instances hold separate user records.** Accounts
created against a `pk_test_` instance do not exist in a `pk_live_` one.

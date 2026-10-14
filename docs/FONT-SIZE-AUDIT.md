# Font-size audit — all public pages

Measured 2026-10-14, dev box, `globals.css` + every public route.
Threshold: **8px**, the operator's own floor — below it text renders as grey texture, not text.

Two columns, because they are not the same number: what a rule **declares**, and what an element
**renders** after the cascade. Reading only the CSS misses responsive overrides and descendant
wins; reading only the DOM cannot tell you which rule to fix.

## Headline

| Page | Elements w/ text | Distinct sizes | Below 8px |
|---|---|---|---|
| `/` landing | 141 | 32 | 6 (4.3%) |
| `/models` | 207 | 12 | **49 (23.7%)** |
| `/pricing` | 14 | 9 | 0 |
| `/stats` | 124 | 17 | 2 (1.6%) |
| `/events` | 57 | 20 | 3 (5.3%) |
| `/auth` | 18 | 10 | 0 |

**40 CSS rules declare below 8px**, across 5 values: `5px` ×1, `6px` ×2, `6.5px` ×2, `7px` ×20,
`7.5px` ×15.

## The real problem is not the floor — it is that there is no scale

**49 distinct declared sizes, 522 declarations.** Every size is a literal `px` — no `rem`, no
`em`, no token. Between 7px and 13px there are **13 distinct sizes**, stepping 0.5px at a time:

```
7   7.5   8   8.5   9   9.5   10   10.5   11   11.5   12   12.5   13
```

Four of them are used once or twice (`8.5` ×3, `10.5` ×5, `11.5` ×4, `12.5` ×2) — sizes nobody can
see the difference between, which is the definition of a size that should not exist. The three
most-used (`9` ×114, `8` ×96, `10` ×77) carry 55% of all text.

And the same visual role is sized differently by different classes:

| Role | Class | Declared |
|---|---|---|
| Plan badge | `.plan-tag` | **8px** |
| Status badge | `.billing-badge` | 7.5px |
| Status badge | `.st-badge` | 7.5px |
| Status badge | `.topup-tag` | 7.5px |
| Pill | `.paid-pill` | **8px** |
| Pill | `.mp-plan` | 7.5px |
| Pill | `.land-free-pill` | 7.5px |
| Table header | `.model-table th` | **7px** |
| Table header | `.mp-group-label` | 7.5px |

Four badges of the same kind, two sizes, and the split is arbitrary — which one a screen uses
depends on when it was written, not on anything a reader could name.

## What actually renders below the floor

| Size | Count | Element | Where | Rule |
|---|---|---|---|---|
| 7.5px | 39 | `dt` | `/models` fact labels | `.mp-item-facts dt` |
| 7.5px | 7 | `b.mp-plan` | `/models` plan badges | `.mp-plan` |
| 7.5px | 6 | `dt` | `/` event facts | `.land-event-facts dt` |
| 7.5px | 2 | `span.mp-group-label` | `/models` group headers | `.mp-group-label` |
| 7.5px | 2 | `span.st-*` | `/stats` live label, inactive badge | `.st-live-label`, `.st-badge` |
| 7.5px | 3 | `dt` | `/events` fact labels | `.ev-fact dt` |
| 7.5px | 1 | `b.land-free-pill` | `/models` EVENT pill | `.land-free-pill` |

The `dt` element is the single biggest leak: **five different rules** all set
`font: 700 7.5px var(--display)` on it — `.land-event-facts dt`, `.land-price-card-nums dt`,
`.mp-item-facts dt`, `.ev-fact dt`, `.pkg-facts dt`. One label style, five copies, 48 rendered
instances.

The worst declared sizes don't reach a public page at all: `5px` (`.peek-stats small`), `6px`
(`.credit-graphic > span small`, `.peek-table`), `6.5px` (`.breakdown-*`) sit in the console.

## Not measured yet

Every `/console/*` route and the top-up dialog are behind Clerk, which refuses a headless login.
The console is where most of the sub-8px rules live (`.breakdown-head`, `.usage-stat > small`,
`.invoice-description small`), so the console audit still needs either the operator's own session
or a preview route per page.

## Scale dysfunctions worth acting on, by leak size

1. **`dt` fact labels — 48 instances, 5 rules, 7.5px.** The single biggest fix.
2. **`.model-table th` at 7px** — every table header on every page. A column heading at 7px is
   read once and then squinted past.
3. **Status badges split 7.5/8px for one role** — pick 8px everywhere.
4. **13 sizes in a 6px band** — collapse to a scale; the 0.5px steps are not perceptible.
5. **`.nav-badge` and `.kind-tile-flag` at 7px** — because they compete with a 9px neighbour that
   makes them look wrong, so they were nudged down instead of the neighbour being nudged up.

## Reproduce

```sh
python3 scripts/audit-font-sizes.py                     # measures every public page
python3 scripts/audit-font-sizes.py http://host:3000    # point it elsewhere
```

It reports, per page: elements with text, the size histogram, the count below 8px, and each
offending class with a sample string — so a rule can be named and fixed rather than guessed at.

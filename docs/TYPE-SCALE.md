# Type scale

`globals.css` carries the whole scale as custom properties. The rule for a new page:
**pick a role, never a px value.**

```css
/* ✅ */  .my-card h3 { font: 700 var(--fs-subhead)/1.35 var(--font-brand); }
/* ❌ */  .my-card h3 { font-size: 16px; }
```

A literal `px` font size is the thing this replaces. Before the scale the file held **49**
distinct sizes, 13 of them inside a 7–11.5px band stepping 0.5px, and four of those were used
once or twice — sizes nobody can tell apart. That is how one role ended up 7.5px in three classes
and 8px in a fourth, with nothing a reader could name explaining the split.

## Roles

Sizes are grounded in how each was already used, not chosen by taste.

| Token | Size | Use for |
|---|---|---|
| `--fs-decorative` | 123px | Oversized background/decoration type only |
| `--fs-display-xl` | 52px | Marketing hero h1 |
| `--fs-display` | 46px | Section hero h2 |
| `--fs-display-sm` | 43px | Console page figures |
| `--fs-h1` | 38px | Console page h1 |
| `--fs-h2` | 32px | Section headings |
| `--fs-h3` | 27px | Card headings on marketing pages |
| `--fs-h4` | 23px | Panel headings, large card titles |
| `--fs-h5` | 19px | Card titles, inline figures |
| `--fs-brand` | 21px | The wordmark in nav / sidebar / auth bar |
| `--fs-subhead-lg` | 17px | Prominent label, figure in a fact row |
| `--fs-subhead` | 16px | Small card heading |
| `--fs-lead` | 15px | Lead paragraph, emphasised label |
| `--fs-base` | 14px | **Body text** — paragraphs, list items, table cells |
| `--fs-body-sm` | 13px | Buttons, inline links, secondary paragraphs |
| `--fs-small` | 12px | Compact buttons, small links |
| `--fs-note` | 11px | Hints, captions, helper lines |
| `--fs-micro` | 10px | Badges, pills, flags, table headers, fact labels |

Families:

| Token | Value | Use for |
|---|---|---|
| `--font-brand` | `var(--display)` — Bricolage Grotesque | Headings, numerals, badges — the brand voice |
| `--font-text` | `var(--body)` — DM Sans | Anything read in sentences |
| `--font-code` | a monospace stack | Ids, refs, code |

## Reusable classes

For markup that should carry the role in one word. Each sets size, weight, line-height and family
for its role — no colour, no margin, so it composes with an existing class.

```
.t-display-xl .t-display .t-display-sm
.t-h1 .t-h2 .t-h3 .t-h4 .t-h5
.t-brand .t-subhead-lg .t-subhead .t-lead
.t-base .t-body-sm .t-small .t-note
.t-micro .t-code
```

```html
<h2 class="t-h4">Active packages</h2>
<span class="t-micro">Awaiting payment</span>
```

## Adjusting a size later

Change the token, and every rule and class using it moves together. That is the point: the size
lives in one place, so a segment cannot drift from its neighbours.

```css
:root { --fs-micro: 10px; }   /* ↑ 11px here and every badge, pill, flag,
                                 table header and fact label grows at once */
```

## Two traps when editing this file

**1. `globals.css` is minified, and range replaces have silently deleted unrelated rules three
separate times.** Append new blocks at end-of-file. If a replace touches an existing rule, diff
the *set of selectors* before and after, not just "does my block work".

**2. The last declaration before a `}` may have NO trailing semicolon.** `:root` ended
`--body:"DM Sans",sans-serif` with no `;`, so inserting a comment and a token right after it made
`--body` swallow them — the comment became part of the value and the first new token resolved to
nothing. The symptom is not an error: affected text silently fell back to the browser default
(`-apple-system`, 14px, weight 400), and a `var()` used as a size in the `font` shorthand
invalidated the whole declaration, so the family was lost too. **Add the missing `;` first, and
verify a new token resolves** — `getComputedStyle(document.documentElement).getPropertyValue('--fs-micro')`
should be `10px`, not `""`.

## Verifying

```sh
python3 scripts/audit-font-sizes.py    # sizes per page; asserts nothing renders below 10px
python3 scripts/audit-overflow.py      # bigger type must not introduce horizontal scroll
```

Both matter. Enlarging text is the classic way to produce clipped buttons and overlapping labels,
and neither a typecheck nor a CSS read can see it.

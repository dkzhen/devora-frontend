"""
Measure the rendered font size of every visible text element on each public page.

Why measured and not read from CSS: `globals.css` is minified with responsive overrides and
descendant rules, so the size an element actually renders at is not the size its own class
declares. `getComputedStyle` is the only answer that accounts for the cascade.

The operator's rule is that anything under 8px renders as grey texture rather than text — so the
threshold below is a finding, not a style preference.

Run: python3 scripts/audit-font-sizes.py
"""
import json
import sys
from collections import Counter, defaultdict

from playwright.sync_api import sync_playwright

PAGES = [
    ("/", "landing"),
    ("/models", "models catalogue"),
    ("/pricing", "pricing"),
    ("/stats", "stats"),
    ("/events", "events"),
    ("/auth", "auth / sign-in"),
]

# Anything below this renders as texture, not text. Zhen's threshold, stated directly.
FLOOR_PX = 8.0

# Collect every element's computed font-size, its own class, and its text.
JS = """
() => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    // Only elements that actually paint text themselves.
    const hasOwnText = [...el.childNodes].some(
      n => n.nodeType === 3 && n.textContent.trim().length > 0
    );
    if (!hasOwnText) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className && typeof el.className === 'string') ? el.className.slice(0, 90) : '',
      px: parseFloat(cs.fontSize),
      family: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
      weight: cs.fontWeight,
      text: el.textContent.trim().slice(0, 44),
    });
  }
  return out;
}
"""


def audit(page_url: str, label: str) -> dict:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.goto(page_url, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(2500)  # let client components settle
        items = page.evaluate(JS)
        title = page.title()
        browser.close()

    sizes = Counter(round(i["px"], 2) for i in items)

    # Which elements are below the floor, grouped by their class so one bad rule shows once.
    below = [i for i in items if i["px"] < FLOOR_PX]
    below_by_class = defaultdict(list)
    for i in below:
        below_by_class[f"{i['tag']}.{i['cls']}" if i["cls"] else i["tag"]].append(i)

    # A dominant element: is there a size that clearly owns the page?
    largest = max(sizes) if sizes else 0
    dominant = None
    if items:
        big = [i for i in items if i["px"] >= largest * 0.75]
        dominant = {"px": largest, "count": len(big), "share": round(len(big) / len(items), 3)}

    return {
        "label": label,
        "url": page_url,
        "title": title,
        "elements_with_text": len(items),
        "sizes": dict(sorted(sizes.items(), reverse=True)),
        "distinct_sizes": len(sizes),
        "below_floor": len(below),
        "below_floor_pct": round(100 * len(below) / len(items), 1) if items else 0,
        "below_detail": {k: {"px": v[0]["px"], "count": len(v), "sample": v[0]["text"]}
                         for k, v in sorted(below_by_class.items(), key=lambda kv: kv[1][0]["px"])},
        "largest": dominant,
    }


def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"
    results = []
    for path, label in PAGES:
        try:
            results.append(audit(f"{base}{path}", label))
        except Exception as exc:  # a page that will not load is a finding too
            results.append({"label": label, "url": f"{base}{path}", "error": str(exc)[:200]})

    for r in results:
        print("=" * 78)
        if "error" in r:
            print(f"{r['label']:22} ERROR  {r['error']}")
            continue
        print(f"{r['label']:22} {r['url']}")
        print(f"  title     : {r['title']}")
        print(f"  elements  : {r['elements_with_text']}  (distinct sizes: {r['distinct_sizes']})")
        print(f"  below {FLOOR_PX}px : {r['below_floor']}  ({r['below_floor_pct']}%)")
        print(f"  largest   : {r['largest']['px']}px x{r['largest']['count']}")
        print("  sizes     : " + "  ".join(f"{k}({v})" for k, v in r["sizes"].items()))
        if r["below_detail"]:
            print("  BELOW FLOOR:")
            for cls, d in r["below_detail"].items():
                print(f"     {d['px']:>5}px  x{d['count']:<3} {cls[:64]}")
                print(f"                \u201c{d['sample']}\u201d")

    print("=" * 78)
    print(json.dumps(results, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

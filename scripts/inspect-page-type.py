"""
Per-section type inspection for one page.

The page-level histogram says how many sizes exist; this says WHERE they are and what role
each is playing, grouped by the page's own sections, so a section can be judged on its own
hierarchy instead of against the whole document.

Run: python3 scripts/inspect-page-type.py /            landing page
     python3 scripts/inspect-page-type.py /models
"""
import json
import sys
from collections import defaultdict

from playwright.sync_api import sync_playwright

JS = """
() => {
  // Group by the nearest <section>, or the nearest ancestor that looks like one.
  const sections = [];
  const roots = document.querySelectorAll('main > section, main > div > section, main > div, footer, nav, header');
  const used = new Set();

  function label(el) {
    const h = el.querySelector('h1,h2,h3,.section-tag,.eyebrow');
    if (h) return h.textContent.trim().slice(0, 40);
    const c = (typeof el.className === 'string' ? el.className : '').split(' ')[0];
    return c ? '.' + c : el.tagName.toLowerCase();
  }

  for (const root of roots) {
    const items = [];
    for (const el of root.querySelectorAll('*')) {
      if (used.has(el)) continue;
      const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      used.add(el);
      items.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 46),
        px: parseFloat(cs.fontSize),
        w: cs.fontWeight,
        fam: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
        text: el.textContent.trim().slice(0, 38),
        top: Math.round(r.top + window.scrollY),
      });
    }
    if (items.length) sections.push({ label: label(root), count: items.length, items });
  }
  return { docHeight: document.body.scrollHeight, sections };
}
"""


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "/"
    base = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3000"

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.goto(f"{base}{path}", wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(2500)
        data = page.evaluate(JS)
        browser.close()

    print(f"# {path}   document height {data['docHeight']}px   {len(data['sections'])} sections")
    for s in data["sections"]:
        sizes = defaultdict(int)
        for i in s["items"]:
            sizes[(i["px"], i["w"], i["fam"])] += 1
        uniq = sorted({i["px"] for i in s["items"]})
        print()
        print(f"── {s['label'][:56]!r}  ({s['count']} text elements, sizes: {uniq})")
        for (px, w, fam), n in sorted(sizes.items(), reverse=True):
            # one sample per distinct size+weight+family
            sample = next(i for i in s["items"] if i["px"] == px and i["w"] == w and i["fam"] == fam)
            print(f"   {px:>5}px {w:>3} {fam[:12]:12} x{n:<3} {sample['tag']}.{sample['cls'][:34]:34} \u201c{sample['text'][:26]}\u201d")
    print()
    print(json.dumps(data, indent=1)[:1500])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

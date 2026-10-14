"""
Full font inventory for one page, section by section.

For each section: every distinct (size, weight, family) in use, how many elements, and a real
sample — so a section's hierarchy can be read at a glance and compared against its neighbours.

Run: python3 scripts/inspect-fonts.py /          landing
     python3 scripts/inspect-fonts.py /models
"""
import sys
from collections import defaultdict

from playwright.sync_api import sync_playwright

JS = """
() => {
  const secs = [];
  // Treat each top-level band of <main> as a section, plus nav and footer.
  const roots = [
    ...document.querySelectorAll('main > *'),
    document.querySelector('nav'),
    document.querySelector('footer'),
  ].filter(Boolean);

  for (const root of roots) {
    const items = [];
    for (const el of root.querySelectorAll('*')) {
      const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Ignore pure decoration: a glyph with no words
      const t = el.textContent.trim();
      items.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40),
        px: parseFloat(cs.fontSize),
        weight: cs.fontWeight,
        family: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
        tracking: cs.letterSpacing,
        transform: cs.textTransform,
        text: t.slice(0, 40),
        decorative: t.length <= 2,
      });
    }
    if (!items.length) continue;
    const title = (() => {
      const h = root.querySelector('h1,h2,h3,.section-tag,.eyebrow');
      if (h) return h.textContent.trim().replace(/\\s+/g, ' ').slice(0, 44);
      const c = (typeof root.className === 'string' ? root.className : '').split(' ')[0];
      return c || root.tagName.toLowerCase();
    })();
    secs.push({ title, cls: (typeof root.className === 'string' ? root.className : '').slice(0, 40), items });
  }
  return secs;
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
        secs = page.evaluate(JS)
        browser.close()

    print(f"# FONTS ON {path}\n")
    for n, s in enumerate(secs, 1):
        print("=" * 76)
        print(f"§{n}  {s['title']}")
        if s["cls"]:
            print(f"     .{s['cls'].split(' ')[0]}")
        groups = defaultdict(list)
        for i in s["items"]:
            key = (i["px"], i["weight"], i["family"], i["decorative"])
            groups[key].append(i)
        print(f"     {len(s['items'])} text elements, {len(groups)} distinct styles\n")
        for (px, w, fam, deco), items in sorted(groups.items(), reverse=True):
            tag = "decor" if deco else ""
            sample = next((i for i in items if not i["decorative"]), items[0])
            tr = sample["tracking"] if sample["tracking"] not in ("normal", "0px") else ""
            tf = f" {sample['transform']}" if sample["transform"] != "none" else ""
            print(f"     {px:>5}px  w{w:<3} {fam[:16]:16} x{len(items):<3} {tag:5} {sample['tag']}.{sample['cls'][:26]:26}{tr}{tf}")
            print(f"            \u201c{sample['text']}\u201d")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

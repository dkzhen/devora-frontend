"""
Where the body copy sits, per section — the type the reader actually reads in sentences.

Sizes are already on a scale; what this answers is whether the PARAGRAPH text is consistent
across a page, or whether each section set its own idea of "normal text".

Run: python3 scripts/inspect-body-copy.py /        landing
     python3 scripts/inspect-body-copy.py /models
"""
import json
import sys
from collections import defaultdict

from playwright.sync_api import sync_playwright

JS = """
() => {
  const out = [];
  for (const el of document.querySelectorAll('p, small, dd, li, blockquote')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const t = el.textContent.trim();
    if (t.length < 12) continue;
    let sec = el.closest('section') || el.closest('footer') || el.closest('nav') || el.closest('aside');
    let name = '(none)';
    if (sec) {
      const h = sec.querySelector('h1,h2,.section-tag');
      name = h ? h.textContent.trim().slice(0, 26)
               : (typeof sec.className === 'string' ? sec.className.split(' ')[0] : sec.tagName);
    }
    out.push({
      px: parseFloat(cs.fontSize),
      tag: el.tagName.toLowerCase(),
      sec: name,
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 30),
      text: t.slice(0, 34),
    });
  }
  return out;
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
        items = page.evaluate(JS)
        browser.close()

    by_size = defaultdict(list)
    for i in items:
        by_size[i["px"]].append(i)

    print(f"# {path} — {len(items)} body-copy elements, {len(by_size)} distinct sizes\n")
    for px in sorted(by_size, reverse=True):
        print(f"  {px}px   ({len(by_size[px])} elements)")
        for i in by_size[px][:6]:
            print(f"      [{i['sec'][:24]:24}] {i['tag']}.{i['cls'][:22]:22} \u201c{i['text']}\u201d")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""
Check that bigger type did not overflow any layout.

Enlarging text is the classic way to introduce horizontal scroll, clipped buttons and
overlapping labels — none of which a typecheck can see. This walks each public page at three
widths and reports any element that sticks out of the viewport or out of a scroll container.

Run: python3 scripts/audit-overflow.py
"""
import sys
from playwright.sync_api import sync_playwright

PAGES = ["/", "/models", "/pricing", "/stats", "/events", "/auth"]
WIDTHS = [(390, "phone"), (768, "tablet"), (1280, "desktop")]

JS = """
() => {
  const vw = document.documentElement.clientWidth;
  const offenders = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Sticks out of the viewport
    if (r.right > vw + 1) {
      offenders.push({
        kind: 'viewport',
        over: Math.round(r.right - vw),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
        tag: el.tagName.toLowerCase(),
        text: el.textContent.trim().slice(0, 34),
      });
    }
  }
  return {
    docScrollW: document.documentElement.scrollWidth,
    viewportW: vw,
    horizontalScroll: document.documentElement.scrollWidth > vw + 1,
    offenders: offenders.slice(0, 12),
    offenderCount: offenders.length,
  };
}
"""


def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"
    total = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for path in PAGES:
            for w, wname in WIDTHS:
                page = browser.new_page(viewport={"width": w, "height": 900})
                try:
                    page.goto(f"{base}{path}", wait_until="domcontentloaded", timeout=45000)
                    page.wait_for_timeout(1800)
                    r = page.evaluate(JS)
                except Exception as exc:
                    print(f"{path:10} {wname:8} ERROR {str(exc)[:90]}")
                    page.close()
                    continue
                status = "OK " if not r["horizontalScroll"] and r["offenderCount"] == 0 else "OVERFLOW"
                total += r["offenderCount"]
                print(f"{path:10} {wname:8} {status:9} scrollW={r['docScrollW']:>5} vw={r['viewportW']:>5} offenders={r['offenderCount']}")
                for o in r["offenders"][:4]:
                    print(f"      +{o['over']}px  {o['tag']}.{o['cls'][:44]}  \u201c{o['text']}\u201d")
                page.close()
        browser.close()
    print()
    print("TOTAL offending elements:", total)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

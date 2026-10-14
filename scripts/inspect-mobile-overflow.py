"""
Measure the admin event form's model select at phone width.

The report: on mobile the dropdown overflows to the right. `len(label)` where label is
"<displayName> · <modelId>" reaches 60+ characters, and .ui-select-list is
`white-space:nowrap; min-width:100%` — so the list is as wide as its longest option, no
matter how narrow the trigger is.

Run: python3 scripts/inspect-mobile-overflow.py
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000/preview-mobilemodel-tmp"
WIDTHS = [(360, "phone-sm"), (390, "phone"), (414, "phone-lg"), (768, "tablet")]

JS_OPEN = """
() => {
  // Reveal the model select's dropdown list.
  const trig = document.querySelector('.admin-subfield .ui-select-trigger')
            || document.querySelector('.ui-select-trigger');
  if (!trig) return { error: 'no select trigger found' };
  trig.click();
  return { opened: true };
}
"""

JS_MEASURE = """
() => {
  const vw = document.documentElement.clientWidth;
  const out = { vw, scrollW: document.documentElement.scrollWidth, offenders: [] };
  const list = document.querySelector('.ui-select-list');
  if (list) {
    const r = list.getBoundingClientRect();
    out.list = {
      w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right),
      overRight: Math.round(r.right - vw),
      nowrap: getComputedStyle(list).whiteSpace,
    };
  }
  const trig = document.querySelector('.ui-select-trigger');
  if (trig) {
    const r = trig.getBoundingClientRect();
    out.trigger = { w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right), overRight: Math.round(r.right - vw) };
  }
  const opt = document.querySelector('.ui-select-option');
  if (opt) {
    out.firstOption = { w: Math.round(opt.getBoundingClientRect().width), text: opt.innerText.slice(0, 70) };
  }
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    if (b.right > vw + 1) out.offenders.push({
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 44),
      over: Math.round(b.right - vw), tag: el.tagName.toLowerCase(),
      text: el.textContent.trim().slice(0, 34),
    });
  }
  out.offenders = out.offenders.slice(0, 10);
  return out;
}
"""


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for w, name in WIDTHS:
            page = browser.new_page(viewport={"width": w, "height": 820})
            page.goto(URL, wait_until="domcontentloaded", timeout=45000)
            page.wait_for_timeout(2000)
            # switch to a model-budget event so the Model field renders
            page.evaluate("""() => {
              const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('Free model'));
              if (b) b.click();
            }""")
            page.wait_for_timeout(900)
            opened = page.evaluate(JS_OPEN)
            page.wait_for_timeout(500)
            r = page.evaluate(JS_MEASURE)
            print(f"── {name} ({w}px)  {opened}")
            print(f"   doc scrollW={r['scrollW']}  vw={r['vw']}  horizontal-scroll={r['scrollW'] > r['vw'] + 1}")
            if r.get("trigger"):
                t = r["trigger"]
                print(f"   trigger   w={t['w']:>4} right={t['right']:>5} overRight={t['overRight']}")
            if r.get("list"):
                l = r["list"]
                print(f"   DROPDOWN  w={l['w']:>4} left={l['left']:>5} right={l['right']:>5}  OVER RIGHT={l['overRight']}px  nowrap={l['nowrap']}")
            if r.get("firstOption"):
                o = r["firstOption"]
                print(f"   option#1  w={o['w']}  \u201c{o['text']}\u201d")
            if r["offenders"]:
                print(f"   offenders ({len(r['offenders'])}):")
                for o in r["offenders"][:6]:
                    print(f"      +{o['over']:>4}px  {o['tag']}.{o['cls'][:40]}  \u201c{o['text']}\u201d")
            print()
            page.close()
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

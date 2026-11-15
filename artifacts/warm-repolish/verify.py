import json
from pathlib import Path
from playwright.sync_api import sync_playwright
out = Path(__file__).parent
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    results = []
    for width in [1440, 390, 320]:
        page = browser.new_page(viewport={'width': width, 'height': 1000}, device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto('http://localhost:3000', wait_until='networkidle')
        page.locator('.lu-overview').wait_for()
        page.locator('#model-spotlights-title').wait_for()
        page.locator('.landing-activity').scroll_into_view_if_needed()
        page.wait_for_timeout(1400)
        metrics = page.evaluate('''() => {
            const get = s => { const e = document.querySelector(s); const c = getComputedStyle(e); const r=e.getBoundingClientRect(); return {background:c.backgroundColor, columns:c.gridTemplateColumns, width:r.width, font:c.fontFamily}; };
            return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,chart:get('.lu-overview'),stats:get('.gs-grid'),statsSurface:get('.gateway-stats'),free:get('[aria-labelledby="free-models-title"]'),discount:get('[aria-labelledby="discount-models-title"]'),cells:document.querySelectorAll('.gs-cell').length,rows:document.querySelectorAll('[aria-labelledby="model-spotlights-title"] li').length};
        }''')
        page.screenshot(path=str(out / f'landing-{width}.png'), full_page=True)
        results.append({'width':width, 'metrics':metrics, 'pageErrors':errors})
        assert metrics['scrollWidth'] == width, metrics
        assert metrics['cells'] == 6
        assert not errors, errors
        page.close()
    browser.close()
    (out / 'dom-results.json').write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))

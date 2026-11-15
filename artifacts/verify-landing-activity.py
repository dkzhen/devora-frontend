import asyncio, json
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).parent
async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox'])
        page = await browser.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        results = []
        for width in [1440, 1024, 768, 375]:
            await page.set_viewport_size({'width': width, 'height': 1100})
            await page.goto('http://127.0.0.1:3000', wait_until='networkidle')
            await page.locator('.gateway-stats').wait_for()
            await page.locator('.landing-activity').scroll_into_view_if_needed()
            await page.wait_for_timeout(1400)
            result = await page.evaluate('''() => {
                const panel = document.querySelector('.landing-activity-panel');
                const bounds = panel.getBoundingClientRect();
                const children = [...panel.querySelectorAll('*')].filter(el => {
                    const r = el.getBoundingClientRect();
                    return r.width && (r.left < bounds.left - 1 || r.right > bounds.right + 1);
                }).map(el => el.className?.baseVal ?? el.className);
                return {width: innerWidth, cells: document.querySelectorAll('.gs-cell').length,
                    panelWidth: bounds.width, chartWidth: document.querySelector('.live-usage-section').getBoundingClientRect().width,
                    statsWidth: document.querySelector('.gateway-stats').getBoundingClientRect().width,
                    columns: getComputedStyle(document.querySelector('.gs-grid')).gridTemplateColumns,
                    overflow: document.documentElement.scrollWidth > innerWidth, outsidePanel: children,
                    tears: document.querySelectorAll('.lu-tear').length, gradients: panel.querySelectorAll('linearGradient').length};
            }''')
            await page.locator('.landing-activity-panel').screenshot(path=str(ROOT / f'landing-activity-{width}.png'))
            assert result['cells'] == 6 and not result['overflow'] and not result['outsidePanel'], result
            assert result['chartWidth'] == result['statsWidth'], result
            results.append(result)
        await page.route('**/backend/api/v1/stats**', lambda route: route.fulfill(status=503, body='{}', content_type='application/json'))
        await page.reload(wait_until='networkidle')
        empty = await page.locator('.landing-activity').evaluate('(el) => ({display: getComputedStyle(el).display, height: el.getBoundingClientRect().height})')
        assert empty['display'] == 'none' and empty['height'] == 0, empty
        output = {'responsive': results, 'empty': empty, 'pageErrors': errors}
        (ROOT / 'landing-activity-checks.json').write_text(json.dumps(output, indent=2))
        print(json.dumps(output, indent=2))
        await browser.close()

asyncio.run(main())

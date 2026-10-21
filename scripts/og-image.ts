// Renders scripts/og-image.html to public/og.png, the image shown when a link to the site is
// shared. 1200 by 630 is the size Open Graph and X's large card expect. Run `just og`.
import { chromium } from '@playwright/test'

const WIDTH = 1200
const HEIGHT = 630
const OUTPUT = new URL('../public/og.png', import.meta.url)

const browser = await chromium.launch()
try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } })
    await page.goto(new URL('og-image.html', import.meta.url).href)
    await page.evaluate(async () => {
        await document.fonts.ready
    })
    const figtree = await page.evaluate(() => document.fonts.check('700 1em Figtree'))
    if (!figtree) {
        throw new Error('Figtree did not load; run npm install first')
    }
    await page.screenshot({ path: OUTPUT.pathname })
    console.info(`wrote ${OUTPUT.pathname}`)
} finally {
    await browser.close()
}

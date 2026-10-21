import { type Page, expect, test } from '@playwright/test'
import type { Screen } from '../../src/app/state'
import { BROKEN_TEXT, openApp } from './helpers'

// The design rules from PLAN.md, checked on every screen: everything fits the viewport
// without clipping, no text under 20px, no all caps, monospace only for key hints, no pure
// white, no hairline borders, and every visible button shows its key.
const VIEWPORTS = [
    { name: 'touch phone', width: 390, height: 844, touch: true },
    { name: 'small phone', width: 360, height: 640, touch: true },
    { name: 'narrow window', width: 390, height: 740, touch: false },
    { name: 'laptop', width: 1280, height: 800, touch: false },
    { name: 'short', width: 1024, height: 600, touch: false },
    { name: 'short and wide', width: 1000, height: 540, touch: false },
    { name: 'mockup', width: 1586, height: 992, touch: false },
]

const violations = async (page: Page): Promise<string[]> =>
    page.evaluate(() => {
        const problems: string[] = []
        const sides = ['top', 'right', 'bottom', 'left']
        const frames = [...document.querySelectorAll('main, .tuner')]
        if (frames.length === 0) {
            return ['no screen rendered']
        }
        frames.forEach((frame) => {
            const name = frame.getAttribute('data-screen') ?? 'unknown'
            if (frame.scrollHeight > frame.clientHeight + 1 || frame.scrollWidth > frame.clientWidth + 1) {
                problems.push(`${name}: overflows (${frame.scrollWidth}x${frame.scrollHeight} in ${frame.clientWidth}x${frame.clientHeight})`)
            }
            const section = frame.querySelector('section')
            if (section !== null && (section.scrollHeight > section.clientHeight + 1 || section.scrollWidth > section.clientWidth + 1)) {
                problems.push(`${name}: content clipped (${section.scrollWidth}x${section.scrollHeight} in ${section.clientWidth}x${section.clientHeight})`)
            }
        })
        document.querySelectorAll('#root *').forEach((element) => {
            const style = getComputedStyle(element)
            const rect = element.getBoundingClientRect()
            if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || element.closest('[hidden]') !== null) {
                return
            }
            const text = [...element.childNodes]
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent ?? '')
                .join('')
                .trim()
            const label = `<${element.tagName.toLowerCase()}> "${text.slice(0, 30)}"`
            if (text !== '') {
                if (Number.parseFloat(style.fontSize) < 20) {
                    problems.push(`${label} is ${style.fontSize}`)
                }
                if (style.textTransform === 'uppercase') {
                    problems.push(`${label} is uppercase`)
                }
                if (rect.bottom > window.innerHeight + 1 || rect.right > window.innerWidth + 1 || rect.left < -1 || rect.top < -1) {
                    problems.push(`${label} is off screen`)
                }
            }
            const mono = /mono|courier|jetbrains|consolas|menlo/i.test(style.fontFamily)
            if (mono && element.tagName !== 'KBD') {
                problems.push(`${label} uses monospace (${style.fontFamily})`)
            }
            if (element.tagName === 'KBD' && /jetbrains/i.test(style.fontFamily)) {
                problems.push(`${label} uses JetBrains Mono`)
            }
            const white = 'rgb(255, 255, 255)'
            if (style.color === white || style.backgroundColor === white || style.fill === white) {
                problems.push(`${label} uses pure white`)
            }
            sides.forEach((side) => {
                const width = Number.parseFloat(style.getPropertyValue(`border-${side}-width`))
                if (width > 0 && width < 4) {
                    problems.push(`${label} has a ${width}px ${side} border`)
                }
            })
            if (element.tagName === 'BUTTON' && element.querySelector('kbd') === null && window.matchMedia('(pointer: fine)').matches) {
                problems.push(`button "${element.textContent?.trim()}" has no key hint`)
            }
        })
        return problems
    })

const show = async (page: Page, screen: Screen): Promise<void> => {
    await page.evaluate(async (next) => {
        const state = await import('/src/app/state.ts')
        const data = state.dataset()
        const record = data?.sessions.at(-1)
        if (data !== null && record !== undefined && state.session() === null) {
            state.setSession({
                record,
                rounds: data.rounds.filter(({ sessionId }) => sessionId === record.id),
                lastScored: data.scored.at(-1) ?? null,
                lastRoundEndedAt: Date.now(),
            })
        }
        state.setScreen(next)
    }, screen)
    // Charts size themselves after layout.
    await page.waitForTimeout(150)
}

const setTuner = async (page: Page, open: boolean): Promise<void> => {
    await page.evaluate(async (value) => {
        const { setTunerOpen } = await import('/src/ui/palette.ts')
        setTunerOpen(value)
    }, open)
    await page.waitForTimeout(50)
}

const SCREENS: Screen[] = [
    { name: 'home' },
    { name: 'more' },
    { name: 'insights', index: 0 },
    { name: 'insights', index: 1 },
    ...[0, 1, 2, 3, 4, 5].flatMap((group): Screen[] => [{ name: 'stats', group, page: 0 }, { name: 'stats', group, page: 1 }]),
    { name: 'stat', id: 'accuracy', group: 0, page: 1 },
    { name: 'stat', id: 'rt-position', group: 1, page: 1 },
    { name: 'stat', id: 'rating', group: 5, page: 1 },
    { name: 'history', page: 0 },
    { name: 'history', page: 1 },
    { name: 'weekly' },
    { name: 'experiments' },
    { name: 'new-experiment', question: 'Does saying the letters help?', conditionA: 'Out loud', conditionB: 'Silent' },
    { name: 'settings', back: { name: 'home' } },
    { name: 'confirm-delete', back: { name: 'home' } },
    { name: 'how-to-play', back: { name: 'home' } },
    { name: 'baseline' },
    { name: 'ready' },
    { name: 'results' },
    { name: 'detail' },
    { name: 'session-end' },
]

VIEWPORTS.forEach((viewport) => test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.touch, hasTouch: viewport.touch })

    test(`every screen follows the design rules at ${viewport.name} size`, async ({ page }) => {
        // Arrange
        await openApp(page)
        await page.evaluate(async () => {
            const { seed } = await import('/tests/e2e/seed.ts')
            await seed({ sessions: 30, seed: 7, eveningCost: 80 })
        })
        const errors = await openApp(page)

        // Act
        const found: string[] = []
        for (const screen of SCREENS) {
            await show(page, screen)
            found.push(...(await violations(page)).map((problem) => `${screen.name}: ${problem}`))
            const text = await page.locator('#root').textContent()
            if (BROKEN_TEXT.test(text ?? '')) {
                found.push(`${JSON.stringify(screen)}: broken text "${text?.match(BROKEN_TEXT)?.[0]}"`)
            }
        }
        await show(page, { name: 'home' })
        await setTuner(page, true)
        found.push(...(await violations(page)).map((problem) => `tuner colours: ${problem}`))
        await page.keyboard.press('p')
        found.push(...(await violations(page)).map((problem) => `tuner presets: ${problem}`))
        await setTuner(page, false)

        await show(page, { name: 'play' })
        await expect(page.locator('[data-screen="play"]')).toBeVisible()
        found.push(...(await violations(page)).map((problem) => `play: ${problem}`))
        const centring = await page.evaluate(() => {
            const box = (label: string): DOMRect | undefined => document.querySelector(`[data-screen="play"] [aria-label="${label}"]`)?.getBoundingClientRect()
            const grid = box('Grid')
            const answers = box('Answers')
            return grid === undefined || answers === undefined ? null : {
                left: grid.left,
                right: window.innerWidth - grid.right,
                bottom: window.innerHeight - answers.bottom,
                answersCentre: answers.left + answers.width / 2,
                gridCentre: grid.left + grid.width / 2,
                answersWidth: answers.width,
                gridWidth: grid.width,
            }
        })
        await page.screenshot({ path: `test-results/play-${viewport.name.replace(/ /g, '-')}.png` })
        await page.keyboard.press('Escape')

        // Assert
        expect(found).toEqual([])
        expect(errors).toEqual([])
        expect(centring).not.toBeNull()
        expect(Math.abs((centring?.left ?? 0) - (centring?.right ?? 0))).toBeLessThan(2)
        // As in the mockup, the answers reach a little past the grid on both sides.
        expect(Math.abs((centring?.answersCentre ?? 0) - (centring?.gridCentre ?? 0))).toBeLessThan(2)
        expect(centring?.answersWidth).toBeGreaterThan(centring?.gridWidth ?? 0)
        expect(centring?.bottom).toBeGreaterThan(0)
    })
}))

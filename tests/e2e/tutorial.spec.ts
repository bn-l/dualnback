import { expect, test } from '@playwright/test'
import { openApp, readStore, screenIs, tap } from './helpers'

const STOPS = 9

test('a newcomer walks through How to play from the keyboard, hearing each letter', async ({ page }) => {
    // Arrange
    const errors = await openApp(page)
    const offered = await page.getByRole('button', { name: 'How to play' }).isVisible()
    // Count the letters played, at the one place every sound starts.
    await page.evaluate(() => {
        const prototype = AudioBufferSourceNode.prototype
        const original: unknown = Reflect.get(prototype, 'start')
        Reflect.set(window, 'lettersPlayed', 0)
        Reflect.set(prototype, 'start', function counted(this: AudioBufferSourceNode, ...args: unknown[]): void {
            Reflect.set(window, 'lettersPlayed', Number(Reflect.get(window, 'lettersPlayed')) + 1)
            if (typeof original === 'function') {
                Reflect.apply(original, this, args)
            }
        })
    })

    // Act
    await page.keyboard.press('p')
    await screenIs(page, 'how to play')
    const stops: Array<{ text: string; inView: boolean; clearOfTarget: boolean; lit: boolean }> = []
    for (let stop = 0; stop < STOPS; stop += 1) {
        await expect(page.getByRole('dialog', { name: 'How to play' })).toContainText(`${stop + 1} of ${STOPS}`)
        // The callout is placed once it has measured its new text, after the next layout.
        const read = async () => page.evaluate(() => {
            const callout = document.querySelector('[role="dialog"]')?.getBoundingClientRect()
            const name = document.querySelector('[data-pointing-at]')?.getAttribute('data-pointing-at') ?? ''
            const target = name === '' ? undefined : document.querySelector(`[data-tour="${name}"]`)?.getBoundingClientRect()
            const holes = (document.querySelector('[data-scrim] path')?.getAttribute('d')?.match(/M/g) ?? []).length - 1
            const overlaps = (a: DOMRect, b: DOMRect): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
            return {
                text: document.querySelector('[role="dialog"] [aria-live]')?.textContent?.trim() ?? '',
                inView: callout !== undefined && callout.left >= 0 && callout.top >= 0 && callout.right <= innerWidth && callout.bottom <= innerHeight,
                clearOfTarget: callout === undefined || target === undefined || !overlaps(callout, target),
                lit: holes === 1 && target !== undefined,
            }
        })
        await expect.poll(async () => {
            const { inView, clearOfTarget } = await read()
            return inView && clearOfTarget
        }, { timeout: 2000 }).toBe(true)
        stops.push(await read())
        await page.keyboard.press('Enter')
    }
    await screenIs(page, 'home')
    const played = await page.evaluate(() => Number(Reflect.get(window, 'lettersPlayed')))
    const data = await readStore(page)

    // Assert
    expect(offered).toBe(true)
    expect(stops).toHaveLength(STOPS)
    stops.forEach((stop) => {
        expect(stop.text).not.toBe('')
        expect(stop.inView).toBe(true)
        expect(stop.clearOfTarget).toBe(true)
    })
    // Every stop but the last points at something.
    expect(stops.map(({ lit }) => lit)).toEqual([...Array.from({ length: STOPS - 1 }, () => true), false])
    expect(played).toBe(4)
    // Learning to play isn't playing: nothing is recorded.
    expect(data.sessions).toHaveLength(0)
    expect(data.rounds).toHaveLength(0)
    expect(errors).toEqual([])
})

test('How to play leaves on Escape, returns to where it was opened, and is offered only to newcomers', async ({ page }) => {
    // Arrange
    const errors = await openApp(page)

    // Act
    await tap(page, 'How to play')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
    await screenIs(page, 'home')
    await tap(page, 'More')
    await tap(page, 'How to play')
    await screenIs(page, 'how to play')
    // The pictured pause button shares Escape, but only the tour's Exit takes it.
    await page.keyboard.press('Escape')
    await screenIs(page, 'more')
    await page.evaluate(async () => {
        const { seed } = await import('/tests/e2e/seed.ts')
        await seed({ sessions: 2, seed: 4, eveningCost: 0 })
    })
    await openApp(page)
    const offeredAfterPlaying = await page.locator('[data-screen="home"]').getByRole('button', { name: 'How to play' }).count()

    // Assert
    expect(offeredAfterPlaying).toBe(0)
    expect(errors).toEqual([])
})

test('leaving the round intro goes home without starting a session', async ({ page }) => {
    // Arrange
    const errors = await openApp(page)
    await tap(page, 'Start session')
    await screenIs(page, 'reaction test')
    await tap(page, 'Skip')
    await screenIs(page, 'ready')

    // Act
    const exit = await page.locator('[data-screen="ready"] button[data-hotkey="Escape"]').innerText()
    await page.keyboard.press('Escape')
    await screenIs(page, 'home')
    const data = await readStore(page)

    // Assert
    expect(exit).toMatch(/^Exit/)
    expect(data.sessions).toHaveLength(0)
    expect(data.screenViews.map(({ screen }) => screen)).not.toContain('session end')
    expect(errors).toEqual([])
})

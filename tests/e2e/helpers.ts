import { type Page, expect } from '@playwright/test'

// Collects console errors and uncaught exceptions so a test fails loudly on any of them.
export const watchErrors = (page: Page): string[] => {
    const errors: string[] = []
    page.on('console', (message) => {
        if (message.type() === 'error') {
            errors.push(message.text())
        }
    })
    page.on('pageerror', (error) => errors.push(error.message))
    return errors
}

// The data and the letter sounds are loaded. waitForFunction would take an async check's
// Promise as already true, so poll instead.
export const appLoaded = async (page: Page): Promise<void> => {
    await expect.poll(async () => page.evaluate(async () => {
        const { letterBank, dataset } = await import('/src/app/state.ts')
        return letterBank() !== null && dataset() !== null
    })).toBe(true)
}

export const openApp = async (page: Page): Promise<string[]> => {
    const errors = watchErrors(page)
    await page.goto('/')
    await expect(page.locator('[data-screen="home"]')).toBeVisible()
    await appLoaded(page)
    return errors
}

export const screenIs = async (page: Page, label: string): Promise<void> => {
    await expect(page.locator(`[data-screen="${label}"]`)).toBeVisible()
}

export const tap = async (page: Page, name: string): Promise<void> => {
    await page.getByRole('button', { name, exact: true }).click()
}

// Every table, straight out of IndexedDB through the app's own store.
export const readStore = async (page: Page) =>
    page.evaluate(async () => {
        const { store } = await import('/src/app/state.ts')
        return {
            sessions: await store.sessions.toArray(),
            rounds: await store.rounds.toArray(),
            trials: await store.trials.toArray(),
            presses: await store.presses.toArray(),
            focusEvents: await store.focusEvents.toArray(),
            screenViews: await store.screenViews.toArray(),
            baselines: await store.baselines.toArray(),
            experiments: await store.experiments.toArray(),
            findings: await store.findings.toArray(),
            settings: await store.settings.toArray(),
        }
    })

// Start a session and get to the ready screen, skipping the daily reaction test.
export const skipToReady = async (page: Page): Promise<void> => {
    await tap(page, 'Start session')
    await screenIs(page, 'reaction test')
    await tap(page, 'Skip')
    await screenIs(page, 'ready')
}

// The rating as the app holds it. Settings are only stored once a session has started, so
// before the first round the store has none.
export const currentRating = async (page: Page): Promise<number> =>
    page.evaluate(async () => (await import('/src/app/state.ts')).settings().rating.rating)

export const currentTrial = async (page: Page): Promise<number> =>
    page.evaluate(() => {
        const counter = document.querySelector('[data-screen="play"] .counter')
        return Number((counter?.textContent ?? '0').split('/')[0])
    })

export const litCell = async (page: Page): Promise<number> =>
    page.evaluate(() => [...document.querySelectorAll('[data-screen="play"] .cell')].findIndex((cell) => cell.hasAttribute('data-lit')))

// Text that means a number went wrong somewhere on the way to the screen.
export const BROKEN_TEXT = /\bNaN\b|\bundefined\b|\bInfinity\b|\[object|\bnull\b/

// Waits until the round has shown at least this many squares.
export const reachTrial = async (page: Page, trial: number): Promise<void> => {
    await page.waitForFunction((expected) => {
        const counter = document.querySelector('[data-screen="play"] .counter')
        return Number((counter?.textContent ?? '0').split('/')[0]) >= expected
    }, trial, { timeout: 15_000 })
}

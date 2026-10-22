import { type Page, expect, test } from '@playwright/test'
import { BROKEN_TEXT, appLoaded, openApp, reachTrial, readStore, screenIs, skipToReady, tap } from './helpers'

// What happens when a round or a session is cut off: a reload, a closed tab, the browser's
// Back button.

const MARK = 'dualnback:away'
const HOUR = 3_600_000

const historyState = async (page: Page): Promise<unknown> => page.evaluate((): unknown => history.state)

const audioState = async (page: Page): Promise<string | undefined> =>
    page.evaluate(async () => (await import('/src/app/state.ts')).letterBank()?.context.state)

// Without the autoplay flag the other test files use, audio waits for a tap or key, as it
// does for anyone playing, so these tests see it asleep after a reload.
test.use({ launchOptions: { args: [] } })

test.describe('a reload partway through', () => {
    test('a round comes back paused, saved as far as it got, and the session carries on', async ({ page }) => {
        // Arrange
        const errors = await openApp(page)
        await skipToReady(page)
        await tap(page, 'Start round')
        await screenIs(page, 'play')
        await reachTrial(page, 3)
        await page.keyboard.press('a')
        await reachTrial(page, 4)
        // Past the save made just after each square. A reload sooner loses that square.
        await page.waitForTimeout(1000)

        // Act
        await page.reload()
        await screenIs(page, 'results')
        await appLoaded(page)
        const pausedText = await page.locator('[data-screen="results"]').textContent()
        const saved = await readStore(page)
        const audioBefore = await audioState(page)
        await tap(page, 'Next round')
        await screenIs(page, 'play')
        const audioAfter = await audioState(page)
        await reachTrial(page, 2)
        await tap(page, 'Pause')
        await screenIs(page, 'results')
        await tap(page, 'End session')
        await screenIs(page, 'session end')
        await tap(page, 'Done')
        await screenIs(page, 'home')
        const final = await readStore(page)

        // Assert
        expect(errors).toEqual([])
        expect(pausedText).toMatch(/Round paused/)
        expect(pausedText).not.toMatch(BROKEN_TEXT)

        // The cut-off round, as far as it got.
        const [cutOff] = saved.rounds
        expect(saved.sessions).toHaveLength(1)
        expect(saved.sessions[0]?.endedAt).toBeNull()
        expect(saved.rounds).toHaveLength(1)
        expect(cutOff?.completed).toBe(false)
        expect(cutOff?.quitAtTrial).toBe(3)
        expect(cutOff?.perfEnd).toBeGreaterThan(cutOff?.perfStart ?? Infinity)
        expect(saved.trials).toHaveLength((cutOff?.quitAtTrial ?? 0) + 1)
        expect(saved.trials.every(({ visualOnset }) => visualOnset !== null)).toBe(true)
        expect(saved.presses.map(({ key, sense }) => ({ key, sense }))).toEqual([{ key: 'KeyA', sense: 'position' }])

        // Audio slept through the reload and woke with the tap.
        expect(audioBefore).toBe('suspended')
        expect(audioAfter).toBe('running')
        const second = final.rounds.find(({ index }) => index === 1)
        const secondEvents = final.focusEvents.filter(({ roundId }) => roundId === second?.id).map(({ type }) => type)
        expect(secondEvents).not.toContain('audio-running')

        // The next round joined the same session, which then ended.
        expect(final.sessions).toHaveLength(1)
        expect(final.sessions[0]?.endedAt).not.toBeNull()
        expect(final.rounds.map(({ index, sessionId }) => ({ index, sessionId })).sort((a, b) => a.index - b.index)).toEqual([
            { index: 0, sessionId: final.sessions[0]?.id },
            { index: 1, sessionId: final.sessions[0]?.id },
        ])
    })
})

test('a session left open for hours is closed where it stopped, and the app opens at home', async ({ page }) => {
    // Arrange: a round cut off by a reload, then moved back three hours.
    const errors = await openApp(page)
    await skipToReady(page)
    await tap(page, 'Start round')
    await reachTrial(page, 2)
    await page.reload()
    await screenIs(page, 'results')
    await page.evaluate(async (shift) => {
        const { store } = await import('/src/app/state.ts')
        const [session] = await store.sessions.toArray()
        const [round] = await store.rounds.toArray()
        if (session === undefined || round === undefined) {
            throw new Error('nothing to move back')
        }
        await store.sessions.put({ ...session, startedAt: session.startedAt - shift })
        await store.rounds.put({ ...round, startedAt: round.startedAt - shift })
    }, 3 * HOUR)

    // Act
    await page.reload()
    await screenIs(page, 'home')
    await appLoaded(page)
    const data = await readStore(page)

    // Assert
    expect(errors).toEqual([])
    const [round] = data.rounds
    expect(data.sessions).toHaveLength(1)
    expect(data.sessions[0]?.endedAt).toBe((round?.startedAt ?? 0) + (round?.perfEnd ?? 0) - (round?.perfStart ?? 0))
    expect(await page.evaluate(async () => (await import('/src/app/state.ts')).session())).toBeNull()
})

test('Back steps back a screen like Escape, and only leaves from home', async ({ page }) => {
    // Arrange
    const errors = await openApp(page)
    const visited: string[] = []
    const where = async (label: string): Promise<void> => {
        await screenIs(page, label)
        visited.push(label)
    }

    // Act
    await tap(page, 'More')
    await tap(page, 'Weekly report')
    await screenIs(page, 'weekly')
    await page.goBack()
    await where('more')
    await page.goBack()
    await where('home')
    await page.keyboard.press('s')
    await screenIs(page, 'stats accuracy')
    await page.keyboard.press('g')
    await screenIs(page, 'settings')
    await page.goBack()
    await where('stats accuracy')
    await page.goBack()
    await where('home')
    await page.keyboard.press('`')
    await expect(page.locator('.tuner')).toBeVisible()
    await page.goBack()
    await expect(page.locator('.tuner')).toHaveCount(0)
    await where('home')
    await expect.poll(async () => historyState(page)).toBeNull()
    await page.goBack()

    // Assert
    expect(errors).toEqual([])
    expect(visited).toEqual(['more', 'home', 'stats accuracy', 'home', 'home'])
    expect(page.url()).toBe('about:blank')
})

test('Back pauses a round, then ends the session, then leaves', async ({ page }) => {
    // Arrange
    const errors = await openApp(page)
    await skipToReady(page)
    await tap(page, 'Start round')
    await reachTrial(page, 2)
    const visited: string[] = []
    const where = async (label: string): Promise<void> => {
        await screenIs(page, label)
        visited.push(label)
    }

    // Act
    await page.goBack()
    await where('results')
    await page.goBack()
    await where('session end')
    await page.goBack()
    await where('home')
    const data = await readStore(page)
    await page.goBack()

    // Assert
    expect(errors).toEqual([])
    expect(visited).toEqual(['results', 'session end', 'home'])
    expect(data.rounds).toHaveLength(1)
    expect(data.rounds[0]?.completed).toBe(false)
    expect(data.sessions[0]?.endedAt).not.toBeNull()
    expect(page.url()).toBe('about:blank')
})

test('Back on the round intro exits without starting a session', async ({ page }) => {
    // Arrange
    const errors = await openApp(page)
    await skipToReady(page)

    // Act
    await page.goBack()
    await screenIs(page, 'home')
    const data = await readStore(page)

    // Assert
    expect(errors).toEqual([])
    expect(data.sessions).toEqual([])
})

test('after a reload away from home, Back still steps back, and the trap is gone at home', async ({ page }) => {
    // Arrange
    const errors = await openApp(page)
    await skipToReady(page)
    await tap(page, 'Start round')
    await reachTrial(page, 2)
    await page.reload()
    await screenIs(page, 'results')
    await appLoaded(page)
    const stateAfterReload = await historyState(page)

    // Act
    await page.goBack()
    await screenIs(page, 'session end')
    await page.goBack()
    await screenIs(page, 'home')
    await expect.poll(async () => historyState(page)).toBeNull()
    await page.goBack()

    // Assert
    expect(errors).toEqual([])
    expect(stateAfterReload).toBe(MARK)
    expect(page.url()).toBe('about:blank')
})

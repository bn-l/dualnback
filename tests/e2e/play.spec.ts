import { expect, test } from '@playwright/test'
import { BROKEN_TEXT, currentRating, currentTrial, litCell, openApp, readStore, screenIs, skipToReady, tap } from './helpers'

// The bot answers position matches only (it can't hear), presses 300 ms after it sees a
// square, holds each key for 80 ms, and makes deliberate mistakes along the way.
const REACTION_MS = 300
const HOLD_MS = 80

test('a real round records every trial, press and timing, and moves the rating', async ({ page }) => {
    // Arrange
    const errors = await openApp(page)
    await skipToReady(page)
    const n = Number((await page.locator('[data-screen="ready"] .heading').textContent())?.match(/(\d)-back/)?.[1])
    await tap(page, 'Start round')
    await screenIs(page, 'play')
    const seen: number[] = []
    const pressedAt: number[] = []

    // Act
    for (let trial = 1; trial <= 20 + n; trial += 1) {
        await page.waitForFunction((expected) => {
            const counter = document.querySelector('[data-screen="play"] .counter')
            return Number((counter?.textContent ?? '0').split('/')[0]) >= expected
        }, trial, { timeout: 10_000 })
        seen.push(await litCell(page))
        const index = seen.length - 1
        if (index >= n && seen[index] === seen[index - n]) {
            await page.waitForTimeout(REACTION_MS)
            await page.keyboard.down('a')
            await page.waitForTimeout(HOLD_MS)
            await page.keyboard.up('a')
            pressedAt.push(index)
            if (pressedAt.length === 1) {
                // A double press on the first match.
                await page.keyboard.press('a')
            }
        }
        if (trial === 5) {
            // A key that is neither Position nor Sound.
            await page.keyboard.press('x')
        }
    }
    await screenIs(page, 'results')
    const resultsText = await page.locator('[data-screen="results"]').textContent()
    await tap(page, 'Details')
    await screenIs(page, 'detail')
    const detailText = await page.locator('[data-screen="detail"]').textContent()
    await tap(page, 'Back')
    await tap(page, 'End session')
    await screenIs(page, 'session end')
    await page.getByLabel('Note').fill('e2e bot session')
    await tap(page, 'Done')
    await screenIs(page, 'home')
    const data = await readStore(page)

    // Assert
    expect(errors).toEqual([])
    expect(resultsText).toMatch(/this round/)
    expect(resultsText).not.toMatch(BROKEN_TEXT)
    expect(detailText).not.toMatch(BROKEN_TEXT)
    expect(pressedAt.length).toBeGreaterThan(0)

    const [round] = data.rounds
    expect(data.rounds).toHaveLength(1)
    expect(round?.completed).toBe(true)
    expect(round?.trialCount).toBe(20 + n)
    expect(round?.accuracy).not.toBeNull()
    expect(round?.ratingAfter?.rating).not.toBe(round?.ratingBefore.rating)
    expect(round?.refreshHz).toBeGreaterThan(20)
    expect(round?.refreshHz).toBeLessThan(260)
    expect(Number.isFinite(round?.audio.outputLatency)).toBe(true)

    const trials = [...data.trials].sort((a, b) => a.index - b.index)
    expect(trials).toHaveLength(20 + n)
    trials.forEach((trial, index) => {
        expect(trial.visualOnset).not.toBeNull()
        expect(trial.audioOnset).not.toBeNull()
        // Sight and sound arrive together: within two frames of each other.
        expect(Math.abs((trial.visualOnset ?? 0) - (trial.audioOnset ?? 0))).toBeLessThan(40)
        const next = trials[index + 1]
        if (next !== undefined) {
            expect(next.scheduledOnset - trial.scheduledOnset).toBeCloseTo(round?.step.intervalMs ?? 0, 0)
        }
    })

    const position = data.presses.filter((press) => press.sense === 'position' && !press.repeat)
    expect(position.length).toBe(pressedAt.length + 1)
    position.forEach((press) => {
        expect(press.input).toBe('keyboard')
        expect(press.key).toBe('KeyA')
        expect(press.upAt).not.toBeNull()
    })
    const held = position.map((press) => (press.upAt ?? 0) - press.downAt).filter((hold) => hold > 40)
    held.forEach((hold) => expect(hold).toBeLessThan(200))
    expect(data.presses.some((press) => press.sense === null && press.key === 'KeyX')).toBe(true)

    // Reaction times: the bot waits 300 ms after it first sees the square.
    pressedAt.forEach((index) => {
        const trial = trials[index]
        const press = position.find((candidate) => trial !== undefined && candidate.downAt > (trial.visualOnset ?? 0) && candidate.downAt < (trial.visualOnset ?? 0) + 2000)
        const rt = (press?.downAt ?? 0) - (trial?.visualOnset ?? 0)
        expect(rt).toBeGreaterThan(REACTION_MS)
        expect(rt).toBeLessThan(REACTION_MS + 500)
    })

    expect(data.sessions[0]?.endedAt).not.toBeNull()
    expect(data.sessions[0]?.note).toBe('e2e bot session')
    expect(data.screenViews.some((view) => view.screen === 'results' && view.leftAt !== null)).toBe(true)
    expect(data.settings[0]?.rating.rating).toBe(round?.ratingAfter?.rating)
})

test('pausing mid-round saves what happened and leaves the rating alone', async ({ page }) => {
    // Arrange
    const errors = await openApp(page)
    await skipToReady(page)
    const before = await currentRating(page)
    await tap(page, 'Start round')
    await page.waitForFunction(() => {
        const counter = document.querySelector('[data-screen="play"] .counter')
        return Number((counter?.textContent ?? '0').split('/')[0]) >= 3
    })

    // Act
    await page.evaluate(() => {
        window.dispatchEvent(new FocusEvent('blur'))
    })
    await page.waitForTimeout(500)
    await page.evaluate(() => {
        window.dispatchEvent(new FocusEvent('focus'))
    })
    const reached = await currentTrial(page)
    await page.keyboard.press('Escape')
    await screenIs(page, 'results')
    const data = await readStore(page)

    // Assert
    expect(errors).toEqual([])
    await expect(page.getByText('Round paused')).toBeVisible()
    const [round] = data.rounds
    expect(round?.completed).toBe(false)
    expect(round?.ratingAfter).toBeNull()
    expect(round?.quitAtTrial).toBeGreaterThanOrEqual(reached - 1)
    expect(data.trials).toHaveLength((round?.quitAtTrial ?? -1) + 1)
    expect(data.trials.some((trial) => trial.flags.blurred)).toBe(true)
    expect(data.focusEvents.map(({ type }) => type)).toEqual(['blur', 'focus'])
    expect(data.settings[0]?.rating.rating).toBe(before)
})

test('a round played with the sound off is saved but leaves the rating alone', async ({ page }) => {
    // Arrange
    const errors = await openApp(page)
    await skipToReady(page)
    const before = await currentRating(page)
    await tap(page, 'Start round')
    await page.waitForFunction(() => Number(document.querySelector('[data-screen="play"] .counter')?.textContent?.split('/')[0]) >= 2)
    const gain = async (): Promise<number> => page.evaluate(async () => {
        const { letterBank } = await import('/src/app/state.ts')
        return letterBank()?.output.gain.value ?? -1
    })

    // Act: M turns the sound off mid-round, and the round plays on to the end.
    await page.keyboard.press('m')
    await expect(page.getByRole('button', { name: 'Turn sound on' })).toBeVisible()
    await page.waitForTimeout(200)
    const mutedGain = await gain()
    await expect(page.locator('[data-screen="results"]')).toBeVisible({ timeout: 120_000 })
    const heading = await page.locator('[data-screen="results"] .heading').innerText()
    const data = await readStore(page)
    await tap(page, 'Next round')
    await screenIs(page, 'play')
    await tap(page, 'Turn sound on')
    await page.waitForTimeout(200)
    const unmutedGain = await gain()
    await page.keyboard.press('Escape')
    await screenIs(page, 'results')

    // Assert
    expect(errors).toEqual([])
    expect(mutedGain).toBeLessThan(0.01)
    expect(unmutedGain).toBeGreaterThan(0.99)
    expect(heading).toBe('Sound was off')
    const [round] = data.rounds
    expect(round?.completed).toBe(true)
    expect(round?.accuracy).not.toBeNull()
    expect(round?.result).toBeNull()
    expect(round?.ratingAfter).toBeNull()
    const trials = [...data.trials].sort((a, b) => a.index - b.index)
    expect(trials[0]?.flags.muted).toBe(false)
    expect(trials.at(-1)?.flags.muted).toBe(true)
    expect(data.focusEvents.map(({ type }) => type)).toContain('sound-off')
    // The M key is the sound button's, not an answer.
    expect(data.presses.some((press) => press.key === 'KeyM')).toBe(false)
    expect(data.settings[0]?.rating.rating).toBe(before)
})

test('settings opened mid-round stop the round and return to its results', async ({ page }) => {
    // Arrange
    const errors = await openApp(page)
    await skipToReady(page)
    await tap(page, 'Start round')
    await page.waitForFunction(() => Number(document.querySelector('[data-screen="play"] .counter')?.textContent?.split('/')[0]) >= 2)

    // Act
    await page.keyboard.press('g')
    await screenIs(page, 'settings')
    await expect.poll(async () => (await readStore(page)).rounds.length).toBe(1)
    // Still on settings after the paused round has been saved.
    await page.waitForTimeout(300)
    const stayed = await page.locator('[data-screen="settings"]').isVisible()
    await page.keyboard.press('Escape')
    await screenIs(page, 'results')
    const data = await readStore(page)

    // Assert
    expect(errors).toEqual([])
    expect(stayed).toBe(true)
    await expect(page.getByText('Round paused')).toBeVisible()
    expect(data.rounds[0]?.completed).toBe(false)
    expect(data.presses.some((press) => press.key === 'KeyG')).toBe(false)
})

import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { BROKEN_TEXT, openApp, screenIs, tap } from './helpers'

test('two months of play with a planted evening effect produces an evening finding and complete stats', async ({ page }) => {
    // Arrange
    await openApp(page)
    const seeded = await page.evaluate(async () => {
        const { seed } = await import('/tests/e2e/seed.ts')
        return seed({ sessions: 60, seed: 3, eveningCost: 80 })
    })
    const errors = await openApp(page)

    // Act
    await tap(page, 'Insights')
    await screenIs(page, 'insight')
    const sentences: string[] = []
    for (;;) {
        sentences.push(await page.locator('[data-screen="insight"] header .heading').innerText())
        const next = page.getByRole('button', { name: 'Next', exact: true })
        if (await next.isDisabled()) {
            break
        }
        await next.click()
    }
    await tap(page, 'Home')
    await tap(page, 'Stats')
    const groups: string[] = []
    const charts: number[] = []
    const sparklines: number[] = []
    for (let group = 0; group < 6; group += 1) {
        // Each group opens on its chart, then lists its stats.
        await expect(page.locator('main')).toContainText(`Group ${group + 1} of 6, page 1 of`)
        groups.push(await page.locator('main').innerText())
        const chart = page.locator('main svg[aria-label="Trend over time"] path, main svg[aria-label="Columns"] path')
        // Charts draw once they've measured the space they have.
        await expect(chart.first()).toBeAttached()
        charts.push(await chart.count())
        await tap(page, 'Next')
        sparklines.push(await page.locator('main button[data-hotkey] svg path').count())
        await page.locator('main button[data-hotkey="1"]').click()
        await expect(page.locator('main svg[aria-label="Trend over time"] path')).toHaveCount(1)
        groups.push(await page.locator('main').innerText())
        await tap(page, 'Back')
        await expect(page.locator('main')).toContainText(`Group ${group + 1} of 6, page 2 of`)
        await page.keyboard.press('ArrowLeft')
        await expect(page.locator('main')).toContainText(`Group ${group + 1} of 6, page 1 of`)
        // On through the group's pages to the next group (the last wraps to the first).
        const next = `Group ${((group + 1) % 6) + 1} of 6, page 1 of`
        for (let press = 0; press < 20 && !(await page.locator('main').innerText()).includes(next); press += 1) {
            await page.keyboard.press('ArrowRight')
        }
        await expect(page.locator('main')).toContainText(next)
    }

    // Assert
    expect(seeded.rounds).toBe(300)
    expect(sentences.some((sentence) => /after 6pm|evening/i.test(sentence))).toBe(true)
    // Nothing else was planted, so nothing else about when you play may be reported.
    sentences.forEach((sentence) => expect(sentence).not.toMatch(/weekend|before 10am|days off|time zone/i))
    sentences.forEach((sentence) => expect(sentence).not.toMatch(BROKEN_TEXT))
    groups.forEach((text) => expect(text).not.toMatch(BROKEN_TEXT))
    charts.forEach((marks) => expect(marks).toBeGreaterThan(0))
    sparklines.forEach((lines) => expect(lines).toBeGreaterThan(0))
    expect(errors).toEqual([])
})

test('settings export every table, delete everything, and import it all back', async ({ page }) => {
    // Arrange
    await openApp(page)
    await page.evaluate(async () => {
        const { seed } = await import('/tests/e2e/seed.ts')
        await seed({ sessions: 3, seed: 1, eveningCost: 0 })
    })
    const errors = await openApp(page)
    const ratingBefore = await page.locator('[data-screen="home"] .number').innerText()
    await tap(page, 'Settings')

    // Act
    const [jsonDownload] = await Promise.all([page.waitForEvent('download'), tap(page, 'Export as JSON')])
    const parsed: unknown = JSON.parse(await readFile(await jsonDownload.path(), 'utf8'))
    const exported = parsed !== null && typeof parsed === 'object' ? parsed : {}
    const sizeOf = (name: string): number => {
        const rows: unknown = Reflect.get(exported, name)
        return Array.isArray(rows) ? rows.length : -1
    }
    const [csvDownload] = await Promise.all([page.waitForEvent('download'), tap(page, 'Export as CSV')])
    await tap(page, 'Delete all data')
    await tap(page, 'Delete everything')
    await screenIs(page, 'home')
    const remaining = await page.evaluate(async () => {
        const { store } = await import('/src/app/state.ts')
        const counts = await Promise.all(store.tables.map(async (table): Promise<[string, number]> => [table.name, await table.count()]))
        return Object.fromEntries(counts)
    })
    const views = await page.evaluate(async () => {
        const { store } = await import('/src/app/state.ts')
        return (await store.screenViews.toArray()).map(({ screen }) => screen)
    })
    const ratingAfterDelete = await page.locator('[data-screen="home"] .number').innerText()
    await tap(page, 'Settings')
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), tap(page, 'Import from JSON')])
    await chooser.setFiles(await jsonDownload.path())
    await expect(page.getByText(/^Imported 3 sessions and 15 rounds/)).toBeVisible()
    const restored = await page.evaluate(async () => {
        const { store } = await import('/src/app/state.ts')
        return { rounds: await store.rounds.count(), trials: await store.trials.count() }
    })
    await tap(page, 'Back')
    const ratingAfterImport = await page.locator('[data-screen="home"] .number').innerText()

    // Assert
    expect(Object.keys(exported).sort()).toEqual(['baselines', 'experiments', 'findings', 'focusEvents', 'presses', 'rounds', 'screenViews', 'sessions', 'settings', 'trials'])
    expect(sizeOf('rounds')).toBe(15)
    expect(sizeOf('trials')).toBeGreaterThan(300)
    expect(csvDownload.suggestedFilename()).toMatch(/\.zip$/)
    // Only the home screen you land on after deleting is recorded again.
    expect({ ...remaining, screenViews: 0 }).toEqual(Object.fromEntries(Object.keys(remaining).map((name) => [name, 0])))
    expect(views).toEqual(['home'])
    expect(ratingAfterDelete).toBe('1200')
    expect(restored.rounds).toBe(15)
    expect(restored.trials).toBe(sizeOf('trials'))
    expect(ratingAfterImport).toBe(ratingBefore)
    expect(errors).toEqual([])
})

test('importing a file that is not an export changes nothing and says why', async ({ page }) => {
    // Arrange
    await openApp(page)
    await page.evaluate(async () => {
        const { seed } = await import('/tests/e2e/seed.ts')
        await seed({ sessions: 2, seed: 2, eveningCost: 0 })
    })
    const errors = await openApp(page)
    const count = async (): Promise<number> => page.evaluate(async () => {
        const { store } = await import('/src/app/state.ts')
        return store.rounds.count()
    })
    const before = await count()
    await tap(page, 'Settings')
    const notice = page.locator('[data-screen="settings"] [aria-live]')
    const choose = async (name: string, contents: string): Promise<string> => {
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), tap(page, 'Import from JSON')])
        await chooser.setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(contents) })
        await expect(notice).not.toHaveText(/^Importing/)
        return notice.innerText()
    }

    // Act
    const notAnExport = await choose('notes.json', '{"todo": ["milk"]}')
    const broken = await choose('broken.json', '{"sessions": [')
    const damaged = await choose('damaged.json', JSON.stringify({ sessions: [], rounds: [{ id: 7 }] }))
    // Rows that look right but can't be scored: the whole import is rolled back.
    const unscorable = await choose('unscorable.json', JSON.stringify({ sessions: [], rounds: [{ id: 'r1', completed: true, result: 0.5, startedAt: 1 }], trials: [{ id: 't1', roundId: 'r1' }] }))

    // Assert
    expect(notAnExport).toMatch(/isn't a dual n-back export/)
    expect(broken).toMatch(/isn't a dual n-back export/)
    expect(damaged).toMatch(/rounds in this file are damaged/)
    expect(unscorable).toMatch(/couldn't be read, so nothing was imported/)
    expect(await count()).toBe(before)
    expect(errors).toEqual([])
})

test('everything works from the keyboard, including the colour tuner', async ({ page }) => {
    // Arrange
    await openApp(page)
    await page.evaluate(async () => {
        const { seed } = await import('/tests/e2e/seed.ts')
        await seed({ sessions: 20, seed: 5, eveningCost: 0 })
    })
    const errors = await openApp(page)
    const background = async (): Promise<string> =>
        page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())
    const baselinesBefore = await page.evaluate(async () => {
        const { store } = await import('/src/app/state.ts')
        return store.baselines.count()
    })

    // Act: a session from start to note, without the mouse.
    await page.keyboard.press('Enter')
    await screenIs(page, 'reaction test')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    // Escape skips the reaction test even halfway through, and isn't taken as a response.
    await page.keyboard.press('Escape')
    await screenIs(page, 'ready')
    await page.keyboard.press('Enter')
    await screenIs(page, 'play')
    await page.waitForFunction(() => Number(document.querySelector('[data-screen="play"] .counter')?.textContent?.split('/')[0]) >= 2)
    await page.keyboard.press('Escape')
    await screenIs(page, 'results')
    await page.keyboard.press('Escape')
    await screenIs(page, 'session end')
    await page.keyboard.type('keyboard only')
    await page.keyboard.press('Enter')
    await screenIs(page, 'home')

    // Act: browsing.
    await page.keyboard.press('s')
    await screenIs(page, 'stats accuracy')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('1')
    await expect(page.locator('main[data-screen^="stat "]')).toBeVisible()
    await page.keyboard.press('Escape')
    await screenIs(page, 'stats accuracy')
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('main')).toContainText('page 3')
    await page.keyboard.press('Escape')
    await screenIs(page, 'home')
    await page.keyboard.press('m')
    await screenIs(page, 'more')
    await page.keyboard.press('g')
    await screenIs(page, 'settings')
    await page.keyboard.press('r')
    await expect(page.locator('main')).toContainText('Daily reaction test: off')
    await page.keyboard.press('g')
    await screenIs(page, 'more')
    await page.keyboard.press('Escape')
    await screenIs(page, 'home')

    // Act: the tuner.
    const before = await background()
    await page.keyboard.press('`')
    await screenIs(page, 'tuner')
    await page.keyboard.press('p')
    await page.keyboard.press('2')
    const sky = await background()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-screen="tuner"]')).toHaveCount(0)
    await page.reload()
    await expect(page.locator('[data-screen="home"]')).toBeVisible()
    const afterReload = await background()
    await page.keyboard.press('`')
    await page.keyboard.press('r')
    const reset = await background()
    const stored = await page.evaluate(async () => {
        const { store } = await import('/src/app/state.ts')
        return { session: await store.sessions.orderBy('startedAt').last(), baselines: await store.baselines.count(), settings: await store.settings.get('settings') }
    })

    // Assert
    expect(stored.session?.note).toBe('keyboard only')
    expect(stored.baselines).toBe(baselinesBefore)
    expect(stored.settings?.dailyBaseline).toBe(false)
    expect(before.toUpperCase()).toBe('#FAF9F6')
    expect(sky.toUpperCase()).toBe('#F7F9FA')
    expect(afterReload.toUpperCase()).toBe('#F7F9FA')
    expect(reset.toUpperCase()).toBe('#FAF9F6')
    expect(errors).toEqual([])
})

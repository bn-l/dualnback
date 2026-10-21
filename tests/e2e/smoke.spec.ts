import { expect, test } from '@playwright/test'
import { openApp } from './helpers'

test('the app loads cross-origin isolated, with sounds and no errors', async ({ page }) => {
    // Arrange
    const errors = await openApp(page)

    // Act
    const isolated = await page.evaluate(() => window.crossOriginIsolated)
    const soundsLoaded = await page.evaluate(async () => {
        const { letterBank } = await import('/src/app/state.ts')
        return letterBank()?.buffers.length ?? 0
    })

    // Assert
    expect(isolated).toBe(true)
    expect(soundsLoaded).toBe(8)
    await expect(page.getByRole('button', { name: 'Start session' })).toBeVisible()
    await page.screenshot({ path: 'test-results/home.png' })
    expect(errors).toEqual([])
})

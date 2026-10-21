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

test('a shared link gets a title, description and a 1200 by 630 preview image', async ({ page, request }) => {
    // Arrange
    await openApp(page)

    // Act
    const meta = await page.evaluate(() => Object.fromEntries(
        [...document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"], meta[name="description"]')]
            .map((tag) => [tag.getAttribute('property') ?? tag.getAttribute('name') ?? '', tag.getAttribute('content') ?? '']),
    ))
    const image = await request.get(new URL(meta['og:image'] ?? '').pathname)
    const size = await page.evaluate(async (bytes) => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
        return { width: bitmap.width, height: bitmap.height }
    }, [...await image.body()])

    // Assert
    expect(meta['og:title']).toBe('dual n-back')
    expect(meta['og:description']?.length).toBeGreaterThan(40)
    expect(meta['description']?.length).toBeGreaterThan(40)
    expect(meta['og:url']).toBe('https://nback.bn-l.net/')
    expect(meta['og:image']).toBe('https://nback.bn-l.net/og.png')
    expect(meta['twitter:card']).toBe('summary_large_image')
    expect(meta['twitter:image']).toBe(meta['og:image'])
    expect(image.status()).toBe(200)
    expect(image.headers()['content-type']).toBe('image/png')
    expect(size).toEqual({ width: Number(meta['og:image:width']), height: Number(meta['og:image:height']) })
    expect(size).toEqual({ width: 1200, height: 630 })
})

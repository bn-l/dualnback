import { describe, expect, test } from 'vitest'
import { CORAL, ENOUGH_CONTRAST, PRESETS, type Palette, contrast, derived, lowestContrast } from '../../src/ui/colours'

describe('colour presets', () => {
    test.each(PRESETS.map((preset): [string, Palette] => [preset.name, preset]))('%s keeps every text at 4.5:1 or better', (_, preset) => {
        // Arrange
        const lowest = lowestContrast(preset)

        // Act
        const short = Object.entries(lowest).filter(([, ratio]) => ratio < ENOUGH_CONTRAST)

        // Assert
        expect(short).toEqual([])
    })

    test('the default is the mockup palette', () => {
        // Arrange
        const mockup = ['#FAF9F6', '#E8E7E3', '#414450', '#FF9C73', '#DCD4F5', '#C9D6C5']

        // Act
        const colours = [CORAL.background, CORAL.surface, CORAL.text, CORAL.position, CORAL.sound, CORAL.chosen]

        // Assert
        expect(colours).toEqual(mockup)
    })
})

describe('derived colours', () => {
    test('quiet text sits between text and background', () => {
        // Arrange
        const { quiet } = derived(CORAL)

        // Act
        const againstBackground = contrast(quiet, CORAL.background)
        const textAgainstBackground = contrast(CORAL.text, CORAL.background)

        // Assert
        expect(quiet).toMatch(/^#[0-9A-F]{6}$/)
        expect(againstBackground).toBeGreaterThan(1)
        expect(againstBackground).toBeLessThan(textAgainstBackground)
    })

    test('labels on fills use the darker of text and background', () => {
        // Arrange
        const night = PRESETS.find(({ name }) => name === 'Night')

        // Act
        const light = derived(CORAL).onFill
        const dark = night === undefined ? null : derived(night).onFill

        // Assert
        expect(light).toBe(CORAL.text)
        expect(dark).toBe(night?.background)
    })

    test('a contrast ratio is symmetric and runs from 1 to 21', () => {
        // Arrange
        const black = '#000000'
        const offWhite = '#FFFFFE'

        // Act
        const forward = contrast(black, offWhite)
        const backward = contrast(offWhite, black)
        const same = contrast(CORAL.text, CORAL.text)

        // Assert
        expect(forward).toBeCloseTo(backward, 10)
        expect(forward).toBeGreaterThan(20.9)
        expect(same).toBe(1)
    })
})

import { describe, expect, it } from 'vite-plus/test'
import { modelFindings } from '../../src/domain/findings'
import { PHONE, coinSource, noiseSource, simulate } from './fixtures-insights'

// Rounds in a session share the day's form. A model that treats them as independent
// reports day-level factors (time of day, weekends, device) that have no effect at all.
// These tests plant day-to-day form, then count what the model claims.

const DAY_LEVEL = /^model\|(weekend|morning|evening|device:.*)$/

const DAYS = 40

const world = (options: { seed: number; eveningEffect: number }) => {
    const coin = coinSource(options.seed)
    const form = noiseSource(options.seed + 1000)
    const forms = Array.from({ length: DAYS }, () => form(0.15))
    return simulate({
        days: DAYS,
        roundsPerSession: 5,
        seed: options.seed,
        noise: 0.12,
        plan: () => ({ hour: coin() ? 8 : coin() ? 13 : 19, device: coin() ? PHONE : undefined }),
        effect: ({ day, plan }) => (forms[day] ?? 0) + (plan.hour >= 18 ? options.eveningEffect : 0),
    })
}

describe('model robustness', () => {
    it('reports almost nothing when only day-to-day form varies', () => {
        // Arrange
        const seeds = Array.from({ length: 12 }, (_, index) => index + 1)

        // Act
        const falseFindings = seeds.map((seed) =>
            modelFindings(world({ seed, eveningEffect: 0 }), new Date(2026, 2, 1)).filter(({ id }) => DAY_LEVEL.test(id)).length)
        const average = falseFindings.reduce((sum, count) => sum + count, 0) / seeds.length

        // Assert
        expect(average).toBeLessThan(0.5)
    })

    it('still finds a real evening effect through the day-to-day form', () => {
        // Arrange
        const dataset = world({ seed: 13, eveningEffect: -0.12 })

        // Act
        const findings = modelFindings(dataset, new Date(2026, 2, 1))

        // Assert
        expect(findings.map(({ id }) => id)).toContain('model|evening')
        expect(findings.find(({ id }) => id === 'model|evening')?.sentence).toMatch(/^You score about \d+ points lower after 6pm\.$/)
    })
})

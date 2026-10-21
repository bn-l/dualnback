import { describe, expect, it } from 'vite-plus/test'
import { LADDER, stepForRating } from '../../src/domain/difficulty'
import { generateRound, trialCountFor } from '../../src/domain/sequence'

const SEEDS = Array.from({ length: 200 }, (_, seed) => seed + 1)

describe('generateRound', () => {
    it('is deterministic for a seed', () => {
        // Arrange
        const step = stepForRating(1400)

        // Act
        const first = generateRound(step, 42)
        const second = generateRound(step, 42)

        // Assert
        expect(second).toEqual(first)
    })

    it('places exactly the planned number of matches for every step and many seeds', () => {
        // Arrange
        const cases = LADDER.flatMap((step) => SEEDS.slice(0, 20).map((seed) => ({ step, seed })))

        // Act
        const results = cases.map(({ step, seed }) => {
            const trials = generateRound(step, seed)
            const eligible = trials.length - step.n
            return {
                expected: Math.round(step.matchRate * eligible),
                position: trials.filter((trial) => trial.positionMatch).length,
                sound: trials.filter((trial) => trial.soundMatch).length,
                length: trials.length,
                n: step.n,
            }
        })

        // Assert
        results.forEach((result) => {
            expect(result.length).toBe(trialCountFor(result.n))
            expect(result.position).toBe(result.expected)
            expect(result.sound).toBe(result.expected)
        })
    })

    it('never marks a match in the first N trials and keeps stimuli in range', () => {
        // Arrange
        const step = stepForRating(2000)

        // Act
        const rounds = SEEDS.map((seed) => generateRound(step, seed))

        // Assert
        rounds.flat().forEach((trial) => {
            expect(trial.position).toBeGreaterThanOrEqual(0)
            expect(trial.position).toBeLessThan(9)
            expect(trial.sound).toBeGreaterThanOrEqual(0)
            expect(trial.sound).toBeLessThan(8)
            if (trial.index < step.n) {
                expect(trial.positionMatch).toBe(false)
                expect(trial.soundMatch).toBe(false)
                expect(trial.gridDistance).toBeNull()
            }
        })
    })

    it('records lures at lags other than N, and more of them at higher lure rates', () => {
        // Arrange
        const few = LADDER.find((step) => step.n === 3 && step.lureRate < 0.2)
        const many = LADDER.find((step) => step.n === 3 && step.lureRate > 0.2)
        if (few === undefined || many === undefined) {
            throw new Error('Ladder is missing 3-back steps')
        }
        const lureCount = (trials: ReturnType<typeof generateRound>): number =>
            trials.filter((trial) => !trial.positionMatch && (trial.positionLags.includes(2) || trial.positionLags.includes(4))).length

        // Act
        const fewTotal = SEEDS.reduce((sum, seed) => sum + lureCount(generateRound(few, seed)), 0)
        const manyTotal = SEEDS.reduce((sum, seed) => sum + lureCount(generateRound(many, seed)), 0)

        // Assert
        expect(manyTotal).toBeGreaterThan(fewTotal)
        SEEDS.slice(0, 10).forEach((seed) => {
            generateRound(many, seed).forEach((trial) => expect(trial.positionLags).not.toContain(3))
        })
    })

    it('works at 1-back, where there is no N−1 lure', () => {
        // Arrange
        const step = stepForRating(1000)

        // Act
        const trials = generateRound(step, 7)

        // Assert
        expect(step.n).toBe(1)
        expect(trials).toHaveLength(trialCountFor(1))
    })
})

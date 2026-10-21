import { describe, expect, it } from 'vite-plus/test'
import { type FactorRow, type FactorTable, roundFactors } from '../../src/domain/factors'
import { isMeaningful } from '../../src/domain/findings'
import { fitModel } from '../../src/domain/model'
import { pointsFromResultDelta } from '../../src/domain/rating'
import { EMPTY, PHONE, allFinite, coinSource, factor, noiseSource, simulate } from './fixtures-insights'

const EVENING_EFFECT = -0.06

// Evenings are planted to score lower; the phone, played at random, has no effect.
const eveningDataset = () => {
    const evening = coinSource(11)
    const phone = coinSource(12)
    return simulate({
        days: 60,
        roundsPerSession: 5,
        plan: () => ({ hour: evening() ? 20 : 12, device: phone() ? PHONE : undefined }),
        effect: ({ plan }) => (plan.hour >= 18 ? EVENING_EFFECT : 0),
    })
}

const fitNumbers = (table: FactorTable): number[] => {
    const fit = fitModel(table)
    return [fit.intercept, fit.noiseSd, ...fit.coefficients.flatMap(({ mean, sd }) => [mean, sd])]
}

const rowsOf = (count: number, values: (index: number) => Record<string, number | null>, residual: (index: number) => number): FactorRow[] =>
    Array.from({ length: count }, (_, index) => ({
        roundId: `r${index}`,
        sessionId: 's',
        order: index,
        startedAt: index,
        residual: residual(index),
        values: values(index),
    }))

describe('fitModel', () => {
    it('recovers a planted evening effect and leaves an unrelated factor alone', () => {
        // Arrange
        const table = roundFactors(eveningDataset())

        // Act
        const fit = fitModel(table)

        // Assert
        const evening = fit.coefficients.find(({ factor: { id } }) => id === 'evening')
        const phone = fit.coefficients.find(({ factor: { id } }) => id.startsWith('device:'))
        expect(evening?.mean).toBeCloseTo(EVENING_EFFECT, 1)
        expect(evening && isMeaningful(evening)).toBe(true)
        expect(phone && isMeaningful(phone)).toBe(false)
        expect(Math.abs(pointsFromResultDelta(phone?.mean ?? 1))).toBeLessThan(10)
    })

    it('separates two overlapping factors and credits the one that matters', () => {
        // Arrange: B usually comes with A, but only A moves the result.
        const noise = noiseSource(3)
        const coin = coinSource(4)
        const rows = rowsOf(300, () => {
            const a = coin() ? 1 : 0
            const b = coin() || coin() ? a : 1 - a
            return { a, b }
        }, () => 0)
        const table: FactorTable = {
            factors: [factor('a'), factor('b')],
            rows: rows.map((row) => ({ ...row, residual: (row.values.a ?? 0) * 0.08 + noise(0.15) })),
        }

        // Act
        const fit = fitModel(table)

        // Assert
        const [a, b] = fit.coefficients
        expect(a?.mean).toBeCloseTo(0.08, 1)
        expect(Math.abs(b?.mean ?? 1)).toBeLessThan(0.02)
    })

    it('uses only answered rounds for a question that was sometimes skipped', () => {
        // Arrange: answered rounds show a clean effect; skipped rounds sit far away.
        const table: FactorTable = {
            factors: [factor('q', 'binary', 'question')],
            rows: rowsOf(200, (index) => ({ q: index % 4 === 3 ? null : index % 2 }),
                (index) => (index % 4 === 3 ? -0.4 : (index % 2) * 0.1)),
        }

        // Act
        const fit = fitModel(table)

        // Assert
        expect(fit.coefficients[0]?.mean).toBeCloseTo(0.1, 2)
        expect(fit.coefficients[0]?.answered).toBe(150)
    })
})

describe('fitModel on hostile input', () => {
    it('returns the prior for an empty dataset', () => {
        // Arrange
        const table = roundFactors(EMPTY)

        // Act
        const fit = fitModel(table)

        // Assert
        expect(fit.rows).toBe(0)
        expect(allFinite(fitNumbers(table))).toBe(true)
        expect(fit.coefficients.every(({ mean }) => mean === 0)).toBe(true)
    })

    it('stays finite with a single round', () => {
        // Arrange
        const table: FactorTable = { factors: [factor('a')], rows: rowsOf(1, () => ({ a: 1 }), () => 0.3) }

        // Act
        const numbers = fitNumbers(table)

        // Assert
        expect(allFinite(numbers)).toBe(true)
    })

    it('stays finite when every factor is missing', () => {
        // Arrange
        const table: FactorTable = {
            factors: [factor('a', 'binary', 'qa'), factor('b', 'continuous', 'qb')],
            rows: rowsOf(30, () => ({ a: null, b: null }), (index) => (index % 3) * 0.1),
        }

        // Act
        const fit = fitModel(table)

        // Assert
        expect(allFinite(fitNumbers(table))).toBe(true)
        expect(fit.coefficients.every(({ mean, answered }) => mean === 0 && answered === 0)).toBe(true)
    })

    it('splits perfectly collinear factors instead of blowing up', () => {
        // Arrange
        const table: FactorTable = {
            factors: [factor('a'), factor('b')],
            rows: rowsOf(80, (index) => ({ a: index % 2, b: index % 2 }), (index) => (index % 2) * 0.1),
        }

        // Act
        const fit = fitModel(table)

        // Assert
        const [a, b] = fit.coefficients
        expect(allFinite(fitNumbers(table))).toBe(true)
        expect((a?.mean ?? 0) + (b?.mean ?? 0)).toBeCloseTo(0.1, 2)
        expect(a?.mean).toBeCloseTo(b?.mean ?? 0, 5)
    })

    it('finds nothing in constant outcomes', () => {
        // Arrange
        const table: FactorTable = {
            factors: [factor('a'), factor('b', 'continuous')],
            rows: rowsOf(50, (index) => ({ a: index % 2, b: (index % 5) - 2 }), () => 0.25),
        }

        // Act
        const fit = fitModel(table)

        // Assert
        expect(allFinite(fitNumbers(table))).toBe(true)
        expect(fit.coefficients.every(({ mean }) => Math.abs(mean) < 1e-6)).toBe(true)
    })

    it('stays finite and reports nothing with 100 factors and 15 rounds of noise', () => {
        // Arrange
        const coin = coinSource(9)
        const noise = noiseSource(10)
        const factors = Array.from({ length: 100 }, (_, index) => factor(`f${index}`))
        const table: FactorTable = {
            factors,
            rows: rowsOf(15, () => Object.fromEntries(factors.map(({ id }) => [id, coin() ? 1 : 0])), () => noise(0.2)),
        }

        // Act
        const fit = fitModel(table)

        // Assert
        expect(allFinite(fitNumbers(table))).toBe(true)
        expect(fit.coefficients.filter(isMeaningful)).toEqual([])
    })

    it('ignores rounds with a non-finite residual', () => {
        // Arrange
        const table: FactorTable = {
            factors: [factor('a')],
            rows: rowsOf(20, (index) => ({ a: index % 2 }), (index) => (index === 0 ? Number.NaN : 0.1)),
        }

        // Act
        const fit = fitModel(table)

        // Assert
        expect(fit.rows).toBe(19)
        expect(allFinite(fitNumbers(table))).toBe(true)
    })
})

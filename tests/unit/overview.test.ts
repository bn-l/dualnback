import { describe, expect, it } from 'vite-plus/test'
import { STAT_GROUPS } from '../../src/domain/analysis-types'
import { overviewFor, smooth } from '../../src/domain/stats/overview'
import { buildDataset, emptyDataset, manyRounds, noisy, perfect, silent } from './fixtures-stats'

const numbersIn = (overview: ReturnType<typeof overviewFor>): number[] =>
    overview === null ? []
        : overview.kind === 'lines' ? overview.series.flatMap(({ points }) => points.map(({ value }) => value))
            : overview.columns.flatMap(({ value }) => value === null ? [] : [value])

describe('smooth', () => {
    it('averages each day with up to two days either side', () => {
        // Arrange
        const points = [10, 20, 30, 40, 50].map((value, index) => ({ day: `2026-01-0${index + 1}`, value }))

        // Act
        const smoothed = smooth(points)

        // Assert
        expect(smoothed.map(({ value }) => value)).toEqual([20, 25, 30, 35, 40])
        expect(smoothed.map(({ day }) => day)).toEqual(points.map(({ day }) => day))
    })

    it('leaves a single day and an empty list alone', () => {
        // Arrange
        const one = [{ day: '2026-01-01', value: 7 }]

        // Act
        const results = [smooth(one), smooth([])]

        // Assert
        expect(results).toEqual([one, []])
    })
})

describe('overviewFor', () => {
    it('draws nothing without data', () => {
        // Arrange
        const dataset = emptyDataset()

        // Act
        const overviews = STAT_GROUPS.map(({ id }) => overviewFor(id, dataset))

        // Assert
        expect(overviews.every((overview) => overview === null)).toBe(true)
    })

    it('has a chart for every group after weeks of play, with only finite values', () => {
        // Arrange
        const dataset = buildDataset(manyRounds(60, noisy()))

        // Act
        const overviews = STAT_GROUPS.map(({ id }) => overviewFor(id, dataset))

        // Assert
        overviews.forEach((overview) => expect(overview).not.toBeNull())
        overviews.flatMap(numbersIn).forEach((value) => expect(Number.isFinite(value)).toBe(true))
    })

    it('shows a perfect player at 100% accuracy and a silent one at 0%', () => {
        // Arrange
        const perfectData = buildDataset(manyRounds(9, perfect))
        const silentData = buildDataset(manyRounds(9, silent))

        // Act
        const best = overviewFor('accuracy', perfectData)
        const worst = overviewFor('stamina', silentData)

        // Assert
        expect(numbersIn(best).every((value) => value === 1)).toBe(true)
        expect(numbersIn(worst)).toEqual([0, 0, 0])
    })

    it('counts every round in the time-of-day columns', () => {
        // Arrange
        const dataset = buildDataset(manyRounds(12, noisy()))

        // Act
        const habits = overviewFor('habits', dataset)

        // Assert
        expect(habits?.kind).toBe('columns')
        expect(numbersIn(habits).reduce((sum, value) => sum + value, 0)).toBe(12)
    })
})

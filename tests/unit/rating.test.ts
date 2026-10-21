import { describe, expect, it } from 'vite-plus/test'
import { LADDER, ratingForN, stepForRating, stretchStep } from '../../src/domain/difficulty'
import {
    INITIAL_RATING,
    afterIdleDays,
    expectedResult,
    pointsFromResultDelta,
    rateRound,
    resultFromAccuracy,
} from '../../src/domain/rating'

describe('resultFromAccuracy', () => {
    it('maps 75% to a draw, 100% to a win and 50% or below to a loss', () => {
        // Arrange
        const accuracies = [1, 0.75, 0.5, 0.2, 0]

        // Act
        const results = accuracies.map(resultFromAccuracy)

        // Assert
        expect(results).toEqual([1, 0.5, 0, 0, 0])
    })
})

describe('rating updates', () => {
    it('moves up after a win, down after a loss and barely after a draw at an even step', () => {
        // Arrange
        const player = { rating: 1400, rd: 80, vol: 0.06 }
        const step = stepForRating(1400)

        // Act
        const win = rateRound(player, step, 1)
        const loss = rateRound(player, step, 0)
        const draw = rateRound(player, step, 0.5)

        // Assert
        expect(win.rating).toBeGreaterThan(player.rating)
        expect(loss.rating).toBeLessThan(player.rating)
        expect(Math.abs(draw.rating - player.rating)).toBeLessThan(1)
        expect(win.rd).toBeLessThan(player.rd)
    })

    it('moves more early on, when uncertainty is high', () => {
        // Arrange
        const step = stepForRating(INITIAL_RATING.rating)
        const settled = { ...INITIAL_RATING, rd: 60 }

        // Act
        const earlyGain = rateRound(INITIAL_RATING, step, 1).rating - INITIAL_RATING.rating
        const settledGain = rateRound(settled, step, 1).rating - settled.rating

        // Assert
        expect(earlyGain).toBeGreaterThan(settledGain)
    })

    it('widens uncertainty for idle days without exceeding the starting value', () => {
        // Arrange
        const player = { rating: 1500, rd: 60, vol: 0.06 }

        // Act
        const week = afterIdleDays(player, 7)
        const years = afterIdleDays(player, 2000)
        const none = afterIdleDays(player, 0)

        // Assert
        expect(week.rd).toBeGreaterThan(player.rd)
        expect(week.rating).toBe(player.rating)
        expect(years.rd).toBeLessThanOrEqual(INITIAL_RATING.rd)
        expect(none).toEqual(player)
    })

    it('expects a draw at an equal rating and converts result deltas to points symmetrically', () => {
        // Arrange
        const player = { rating: 1600, rd: 80, vol: 0.06 }

        // Act
        const even = expectedResult(player, 1600)
        const up = pointsFromResultDelta(0.05)
        const down = pointsFromResultDelta(-0.05)
        const extreme = pointsFromResultDelta(5)

        // Assert
        expect(even).toBeCloseTo(0.5)
        expect(up).toBeCloseTo(-down)
        expect(up).toBeGreaterThan(30)
        expect(up).toBeLessThan(40)
        expect(Number.isFinite(extreme)).toBe(true)
    })
})

describe('difficulty ladder', () => {
    it('is strictly increasing and picks the nearest step', () => {
        // Arrange
        const ratings = LADDER.map((step) => step.rating)

        // Act
        const near = stepForRating(1420)
        const top = stretchStep(LADDER[LADDER.length - 1] ?? near)

        // Assert
        ratings.slice(1).forEach((rating, index) => expect(rating).toBeGreaterThan(ratings[index] ?? Infinity))
        expect(near.rating).toBe(1400)
        expect(stretchStep(near).rating).toBe(1450)
        expect(top.index).toBe(LADDER.length - 1)
        expect(ratingForN(5)).toBe(1800)
        expect(stepForRating(-5000).index).toBe(0)
    })
})

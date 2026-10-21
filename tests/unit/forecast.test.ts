import { describe, expect, it } from 'vite-plus/test'
import { forecastSession } from '../../src/domain/forecast'
import { EMPTY, coinSource, simulate } from './fixtures-insights'

const RATING = { rating: 1500, rd: 60, vol: 0.06 }

// Evening sessions are planted to score lower.
const eveningDataset = () => {
    const evening = coinSource(51)
    return simulate({
        days: 60,
        roundsPerSession: 5,
        plan: () => ({ hour: evening() ? 20 : 12 }),
        effect: ({ plan }) => (plan.hour >= 18 ? -0.06 : 0),
    })
}

describe('forecastSession', () => {
    it('forecasts below the rating in the evening and says why', () => {
        // Arrange
        const dataset = eveningDataset()
        const now = new Date(2026, 5, 1, 20)

        // Act
        const forecast = forecastSession({ dataset, rating: RATING, now })

        // Assert
        expect(forecast.rating).toBeLessThan(1480)
        expect(forecast.reason).toMatch(/^That's about \d+ below your rating, mostly because of playing after 6pm\.$/)
    })

    it('forecasts the rating itself, with no reason, at midday', () => {
        // Arrange
        const dataset = eveningDataset()
        const now = new Date(2026, 5, 1, 12)

        // Act
        const forecast = forecastSession({ dataset, rating: RATING, now })

        // Assert
        expect(forecast).toEqual({ rating: 1500, reason: null })
    })

    it('returns the rating unchanged with no data', () => {
        // Arrange
        const now = new Date(2026, 5, 1)

        // Act
        const forecast = forecastSession({ dataset: EMPTY, rating: RATING, now })

        // Assert
        expect(forecast).toEqual({ rating: 1500, reason: null })
    })
})

import { describe, expect, it } from 'vite-plus/test'
import type { FindingRecord } from '../../src/data/schema'
import { weeklyReport } from '../../src/domain/weekly'
import { EMPTY, datasetOf, simulate } from './fixtures-insights'

const START = new Date(2026, 0, 5)
const NOW = new Date(2026, 0, 19, 23)

const finding = (overrides: Partial<FindingRecord> & Pick<FindingRecord, 'id' | 'updatedAt'>): FindingRecord => ({
    status: 'new',
    sentence: overrides.id,
    effectPoints: 20,
    sign: 1,
    firstSeenAt: 0,
    roundsAtDetection: 0,
    ...overrides,
})

const twoWeeks = () => simulate({
    days: 15,
    roundsPerSession: 3,
    start: START,
    plan: () => ({ hour: 12 }),
    effect: ({ day, roundIndex }) => (day === 12 && roundIndex === 1 ? 0.3 : 0),
    noise: 0.01,
    ratingPerDay: 10,
})

describe('weeklyReport', () => {
    it('sums up the last seven days', () => {
        // Arrange
        const base = twoWeeks()
        const sessions = base.sessions.map((session) => session.id === 's14'
            ? { ...session, forecast: { rating: 1520, reason: null } }
            : session)
        const dataset = datasetOf({ sessions, rounds: base.rounds })
        const findings = [
            finding({ id: 'old', updatedAt: new Date(2026, 0, 6).getTime() }),
            finding({ id: 'faded', status: 'faded', updatedAt: new Date(2026, 0, 18).getTime() }),
            finding({ id: 'confirmed this week', status: 'confirmed', updatedAt: new Date(2026, 0, 17).getTime() }),
        ]

        // Act
        const report = weeklyReport({ dataset, findings, now: NOW })

        // Assert
        expect(report.sessions).toBe(7)
        expect(report.rounds).toBe(21)
        expect(report.ratingChange).toBe(60)
        expect(report.bestRound).toMatchObject({ roundId: 's12r1', n: 3, rating: 1520 })
        expect(report.bestRound?.pointsAboveExpected).toBeGreaterThan(100)
        expect(report.finding?.id).toBe('confirmed this week')
        expect(report.forecastError).toBe(20)
        expect(report.forecastsCompared).toBe(1)
    })

    it('is empty but well-formed with no play', () => {
        // Arrange
        const now = NOW

        // Act
        const report = weeklyReport({ dataset: EMPTY, findings: [], now })

        // Assert
        expect(report).toMatchObject({
            ratingChange: null, sessions: 0, rounds: 0, bestRound: null, finding: null, forecastError: null,
        })
    })
})

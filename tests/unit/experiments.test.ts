import { addDays, format } from 'date-fns'
import { describe, expect, it } from 'vite-plus/test'
import type { ExperimentRecord } from '../../src/data/schema'
import { conditionFor, experimentResult } from '../../src/domain/experiments'
import { EMPTY, simulate } from './fixtures-insights'

const START = new Date(2026, 0, 5)

const experiment = (overrides: Partial<ExperimentRecord> = {}): ExperimentRecord => ({
    id: 'exp',
    question: 'Does exercising before a session help?',
    conditionA: 'Exercise first',
    conditionB: 'No exercise',
    startDay: '2026-01-05',
    days: 14,
    seed: 42,
    createdAt: 0,
    stoppedAt: null,
    ...overrides,
})

const dayOf = (offset: number): string => format(addDays(START, offset), 'yyyy-MM-dd')

const scheduleOf = (record: ExperimentRecord): Array<'a' | 'b' | null> =>
    Array.from({ length: record.days }, (_, offset) => conditionFor(record, dayOf(offset)))

const played = (record: ExperimentRecord, effectOfA: number) => simulate({
    days: record.days,
    roundsPerSession: 5,
    start: START,
    plan: (day) => {
        const condition = conditionFor(record, dayOf(day))
        return { hour: 12, experiment: condition === null ? null : { experimentId: record.id, condition } }
    },
    effect: ({ plan }) => (plan.experiment?.condition === 'a' ? effectOfA : 0),
    experiments: [record],
})

describe('conditionFor', () => {
    it('gives each condition half the days', () => {
        // Arrange
        const record = experiment()

        // Act
        const schedule = scheduleOf(record)

        // Assert
        expect(schedule.filter((condition) => condition === 'a')).toHaveLength(7)
        expect(schedule.filter((condition) => condition === 'b')).toHaveLength(7)
    })

    it('is the same every time and differs between seeds', () => {
        // Arrange
        const record = experiment()

        // Act
        const first = scheduleOf(record)
        const again = scheduleOf(record)
        const otherSeed = scheduleOf(experiment({ seed: 7 }))

        // Assert
        expect(again).toEqual(first)
        expect(otherSeed).not.toEqual(first)
    })

    it('returns null outside the experiment', () => {
        // Arrange
        const record = experiment()

        // Act
        const before = conditionFor(record, '2026-01-04')
        const after = conditionFor(record, dayOf(14))

        // Assert
        expect(before).toBeNull()
        expect(after).toBeNull()
    })
})

describe('experimentResult', () => {
    it('says which condition scored higher when the difference is clear', () => {
        // Arrange
        const record = experiment()
        const dataset = played(record, 0.1)

        // Act
        const result = experimentResult(record, dataset)

        // Assert
        expect(result.clear).toBe(true)
        expect(result.sentence).toMatch(/^“Exercise first” scored about \d+ points higher than “No exercise”\.$/)
        expect(result.rounds).toEqual({ a: 35, b: 35 })
        expect(result.pointsDifference).toBeGreaterThan(0)
    })

    it('says there is no clear difference when there is none', () => {
        // Arrange
        const record = experiment()
        const dataset = played(record, 0)

        // Act
        const result = experimentResult(record, dataset)

        // Assert
        expect(result.clear).toBe(false)
        expect(result.sentence).toBe('No clear difference between “Exercise first” and “No exercise”.')
    })

    it('asks for more rounds before judging', () => {
        // Arrange
        const record = experiment()

        // Act
        const result = experimentResult(record, EMPTY)

        // Assert
        expect(result.enoughData).toBe(false)
        expect(result.pointsDifference).toBeNull()
        expect(result.sentence).toBe('Not enough rounds yet: 0 with “Exercise first” and 0 with “No exercise”. Each needs at least 5.')
    })
})

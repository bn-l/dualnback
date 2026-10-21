import { describe, expect, it } from 'vite-plus/test'
import type { ScoredRound } from '../../src/domain/scoring'
import { SEGMENT_COUNT, roundDetail, roundSummary } from '../../src/domain/round-summary'
import { type Behaviour, buildDataset, noisy, perfect, silent } from './fixtures-stats'

const onlyRound = (behaviour: Behaviour, seed = 2024): ScoredRound => {
    const round = buildDataset([{ behaviour, seed }]).scored[0]
    if (round === undefined) {
        throw new Error('Fixture produced no completed round')
    }
    return round
}

describe('roundSummary', () => {
    it('says so when neither sense had an error, with full segments', () => {
        // Arrange
        const round = onlyRound(perfect)

        // Act
        const summary = roundSummary(round)

        // Assert
        expect(summary.sentence).toBe('No errors in either sense.')
        expect(summary.segments.position).toEqual(Array.from({ length: SEGMENT_COUNT }, () => 1))
        expect(summary.segments.sound).toEqual(Array.from({ length: SEGMENT_COUNT }, () => 1))
    })

    it('reports a slip when position errors pile up in the last third', () => {
        // Arrange
        const lateSlip: Behaviour = ({ trial, sense }) => {
            const match = sense === 'position' ? trial.positionMatch : trial.soundMatch
            return { press: sense === 'position' && trial.index >= 15 ? !match : match, rt: 450 }
        }
        const round = onlyRound(lateSlip)

        // Act
        const summary = roundSummary(round)

        // Assert
        expect(summary.sentence).toBe('Position slipped in the last third. Sound had no errors.')
        expect(summary.segments.position[SEGMENT_COUNT - 1]).toBe(0)
        expect(summary.segments.position[0]).toBe(1)
    })

    it('reports early errors when they come at the start', () => {
        // Arrange
        const earlyErrors: Behaviour = ({ trial, sense }) => {
            const match = sense === 'position' ? trial.positionMatch : trial.soundMatch
            return { press: sense === 'sound' && trial.index < 7 ? !match : match, rt: 450 }
        }
        const round = onlyRound(earlyErrors)

        // Act
        const summary = roundSummary(round)

        // Assert
        expect(summary.sentence).toBe('Position had no errors. Sound errors came early.')
    })

    it('says both held steady with a single stray error each', () => {
        // Arrange
        const stray: Behaviour = ({ trial, sense }) => {
            const match = sense === 'position' ? trial.positionMatch : trial.soundMatch
            const strayIndex = sense === 'position' ? 10 : 11
            return { press: trial.index === strayIndex ? !match : match, rt: 450 }
        }
        const round = onlyRound(stray)

        // Act
        const summary = roundSummary(round)

        // Assert
        expect(summary.sentence).toBe('Both senses held steady.')
    })

    it('always writes one or two plain sentences, never praise, across many noisy rounds', () => {
        // Arrange
        const rounds = Array.from({ length: 40 }, (_, seed) => onlyRound(noisy(0.6, 0.2), 9000 + seed))

        // Act
        const sentences = rounds.map((round) => roundSummary(round).sentence)

        // Assert
        sentences.forEach((sentence) => {
            const count = sentence.split('. ').length
            expect(count).toBeGreaterThanOrEqual(1)
            expect(count).toBeLessThanOrEqual(2)
            expect(sentence).toMatch(/\.$/)
            expect(sentence).not.toMatch(/!|great|nice|well done|undefined|NaN/i)
        })
        rounds.forEach((round) => {
            const { segments } = roundSummary(round)
            expect([...segments.position, ...segments.sound].every((value) => value >= 0 && value <= 1)).toBe(true)
        })
    })
})

describe('roundDetail', () => {
    it('lists the valid lure lags for N, and has too few errors to judge clustering on a perfect round', () => {
        // Arrange
        const round = onlyRound(perfect)

        // Act
        const detail = roundDetail(round)

        // Assert
        expect(round.round.step.n).toBe(2)
        expect(detail.lureErrors.map(({ label }) => label)).toEqual(['N−1', 'N+1', 'N+2'])
        expect(detail.lureErrors.every(({ count }) => count === 0)).toBe(true)
        expect(detail.clustering).toBe('too-few')
        expect(detail.medianRt).toBeGreaterThanOrEqual(400)
        expect(detail.medianRt).toBeLessThanOrEqual(600)
        expect(detail.trials).toHaveLength(round.trials.length)
    })

    it('returns nulls, not NaN, when nothing was pressed', () => {
        // Arrange
        const round = onlyRound(silent)

        // Act
        const detail = roundDetail(round)

        // Assert
        expect(detail.medianRt).toBeNull()
        expect(detail.consistency).toBeNull()
        expect(detail.slowTail).toBeNull()
        expect(['clustered', 'spread', 'too-few']).toContain(detail.clustering)
    })

    it('counts false alarms on N+1 lures', () => {
        // Arrange
        const lureChaser: Behaviour = ({ trial, sense, n }) => {
            const match = sense === 'position' ? trial.positionMatch : trial.soundMatch
            const lags = sense === 'position' ? trial.positionLags : trial.soundLags
            return { press: match || lags.includes(n + 1), rt: 450 }
        }
        const round = onlyRound(lureChaser)
        const expected = round.trials.filter(({ trial }) =>
            (!trial.positionMatch && trial.positionLags.includes(3)) || (!trial.soundMatch && trial.soundLags.includes(3)))

        // Act
        const detail = roundDetail(round)

        // Assert
        const plusOne = detail.lureErrors.find(({ label }) => label === 'N+1')
        expect(plusOne?.count).toBeGreaterThan(0)
        expect(plusOne?.count).toBeLessThanOrEqual(expected.length * 2)
    })
})

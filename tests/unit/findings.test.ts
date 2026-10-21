import { describe, expect, it } from 'vite-plus/test'
import type { FindingRecord } from '../../src/data/schema'
import type { Finding } from '../../src/domain/analysis-types'
import { CONFIRM_ROUNDS, modelFindings, updateLifecycle } from '../../src/domain/findings'
import { EMPTY, PHONE, coinSource, simulate } from './fixtures-insights'

const NOW = new Date(2026, 5, 1)

// Evening sessions are planted to score lower (or, after `flipAfterDay`, higher).
const eveningDataset = (options: { days?: number; flipAfterDay?: number } = {}) => {
    const evening = coinSource(21)
    return simulate({
        days: options.days ?? 60,
        roundsPerSession: 5,
        plan: () => ({ hour: evening() ? 20 : 12 }),
        effect: ({ day, plan }) => {
            const sign = options.flipAfterDay !== undefined && day >= options.flipAfterDay ? 1 : -1
            return plan.hour >= 18 ? sign * 0.06 : 0
        },
    })
}

const record = (overrides: Partial<FindingRecord> & Pick<FindingRecord, 'id'>): FindingRecord => ({
    status: 'new',
    sentence: 'old sentence',
    effectPoints: -40,
    sign: -1,
    firstSeenAt: 0,
    roundsAtDetection: 0,
    updatedAt: 0,
    ...overrides,
})

const finiteEverywhere = (findings: readonly Finding[]): boolean =>
    findings.every(({ effectPoints, evidence }) =>
        (effectPoints === null || Number.isFinite(effectPoints)) && evidence.every(({ value }) => Number.isFinite(value)))

describe('modelFindings', () => {
    it('reports a planted evening effect in plain words, with evidence and a basis', () => {
        // Arrange
        const dataset = eveningDataset()

        // Act
        const findings = modelFindings(dataset, NOW)

        // Assert
        const evening = findings.find(({ id }) => id === 'model|evening')
        expect(evening?.sentence).toMatch(/^You score about \d+ points lower after 6pm\.$/)
        expect(evening?.effectPoints).toBeLessThan(-20)
        expect(evening?.evidence.map(({ label }) => label)).toEqual(['After 6pm', '10am to 6pm'])
        expect(evening?.basis).toMatch(/^From 300 rounds over \d+ (weeks|months)\.$/)
        expect(evening?.controllable).toBe(true)
    })

    it('reports nothing when nothing was planted', () => {
        // Arrange
        const coin = coinSource(5)
        const dataset = simulate({
            days: 60,
            roundsPerSession: 5,
            plan: () => ({ hour: coin() ? 8 : coin() ? 13 : 20, device: coin() ? PHONE : undefined }),
            effect: () => 0,
        })

        // Act
        const findings = modelFindings(dataset, NOW)

        // Assert
        expect(findings).toEqual([])
    })

    it('credits the phone, not evenings, when the phone travels with evenings', () => {
        // Arrange: the phone on most evenings and few afternoons; only the phone hurts.
        const coin = coinSource(31)
        const dataset = simulate({
            days: 80,
            roundsPerSession: 5,
            plan: () => {
                const evening = coin()
                const phone = evening ? coin() || coin() : coin() && coin()
                return { hour: evening ? 20 : 14, device: phone ? PHONE : undefined }
            },
            effect: ({ plan }) => (plan.device === PHONE ? -0.07 : 0),
        })

        // Act
        const findings = modelFindings(dataset, NOW)

        // Assert
        const sentences = findings.map(({ sentence }) => sentence)
        expect(sentences).toContain('Your phone, not time of day, explains your evening slump.')
        expect(sentences).toContainEqual(expect.stringMatching(
            /^You score about \d+ points (lower with your phone than with your computer|higher with your computer than with your phone)\.$/))
        expect(findings.some(({ id }) => id === 'model|evening')).toBe(false)
    })

    it('joins the third-round peak and the late-session drop into one sentence', () => {
        // Arrange
        const dataset = simulate({
            days: 50,
            roundsPerSession: 7,
            plan: () => ({ hour: 12 }),
            effect: ({ roundIndex }) => (roundIndex === 2 ? 0.08 : roundIndex >= 5 ? -0.08 : 0),
        })

        // Act
        const findings = modelFindings(dataset, NOW)

        // Assert
        const combined = findings.find(({ id }) => id === 'model|round-number')
        expect(combined?.sentence).toMatch(/^Your third round is usually your best\. After the fifth, you score about \d+ points lower\.$/)
        expect(findings.some(({ id }) => id === 'model|third-round' || id === 'model|sixth-plus')).toBe(false)
    })

    it('finds nothing in an empty dataset and stays finite', () => {
        // Arrange
        const dataset = EMPTY

        // Act
        const findings = modelFindings(dataset, NOW)

        // Assert
        expect(findings).toEqual([])
        expect(finiteEverywhere(findings)).toBe(true)
    })
})

describe('updateLifecycle', () => {
    it('adds a newly found finding as new, stamped with the rounds seen so far', () => {
        // Arrange
        const dataset = eveningDataset()
        const findings = modelFindings(dataset, NOW)

        // Act
        const records = updateLifecycle({ records: [], findings, dataset, now: NOW })

        // Assert
        const evening = records.find(({ id }) => id === 'model|evening')
        expect(evening).toMatchObject({ status: 'new', sign: -1, roundsAtDetection: 300, updatedAt: NOW.getTime() })
    })

    it('confirms a finding that holds on the rounds played after it was found', () => {
        // Arrange
        const dataset = eveningDataset({ days: 80 })
        const findings = modelFindings(dataset, NOW)
        const detectedAt = dataset.scored.length - 100
        const records = [record({ id: 'model|evening', roundsAtDetection: detectedAt })]

        // Act
        const updated = updateLifecycle({ records, findings, dataset, now: NOW })

        // Assert
        expect(updated[0]).toMatchObject({ status: 'confirmed', updatedAt: NOW.getTime(), roundsAtDetection: detectedAt })
        expect(updated[0]?.sentence).toMatch(/after 6pm\.$/)
    })

    it('fades a finding whose effect reverses on later rounds', () => {
        // Arrange: evenings hurt for 60 days, then help for 40.
        const dataset = eveningDataset({ days: 100, flipAfterDay: 60 })
        const reversedFinding: Finding = {
            id: 'model|evening', kind: 'helps-hurts', sentence: 'still found', effectPoints: -20,
            evidence: [], basis: '', controllable: true,
        }
        const records = [record({ id: 'model|evening', roundsAtDetection: 300 })]

        // Act
        const updated = updateLifecycle({ records, findings: [reversedFinding], dataset, now: NOW })

        // Assert
        expect(updated[0]?.status).toBe('faded')
    })

    it('waits for the confirmation window before judging', () => {
        // Arrange
        const dataset = eveningDataset()
        const findings = modelFindings(dataset, NOW)
        const records = [record({ id: 'model|evening', roundsAtDetection: dataset.scored.length - CONFIRM_ROUNDS + 1 })]

        // Act
        const updated = updateLifecycle({ records, findings, dataset, now: NOW })

        // Assert
        expect(updated[0]).toMatchObject({ status: 'new', updatedAt: 0 })
    })

    it('fades a finding the data no longer supports, and keeps the record', () => {
        // Arrange
        const records = [record({ id: 'model|weekend', status: 'confirmed' })]

        // Act
        const updated = updateLifecycle({ records, findings: [], dataset: EMPTY, now: NOW })

        // Assert
        expect(updated).toHaveLength(1)
        expect(updated[0]).toMatchObject({ status: 'faded', sentence: 'old sentence', updatedAt: NOW.getTime() })
    })

    it('restarts a faded finding that comes back', () => {
        // Arrange
        const dataset = eveningDataset()
        const findings = modelFindings(dataset, NOW)
        const records = [record({ id: 'model|evening', status: 'faded', roundsAtDetection: 3, firstSeenAt: 1 })]

        // Act
        const updated = updateLifecycle({ records, findings, dataset, now: NOW })

        // Assert
        expect(updated[0]).toMatchObject({ status: 'new', roundsAtDetection: 300, firstSeenAt: NOW.getTime() })
    })

    it('confirms a non-model finding that is still found after the window', () => {
        // Arrange
        const dataset = eveningDataset()
        const statFinding: Finding = {
            id: 'stat|clustering', kind: 'why-you-miss', sentence: 'Your errors come in clusters.',
            effectPoints: null, evidence: [], basis: '', controllable: false,
        }
        const records = [record({ id: 'stat|clustering', roundsAtDetection: 0, effectPoints: null, sign: 1 })]

        // Act
        const updated = updateLifecycle({ records, findings: [statFinding], dataset, now: NOW })

        // Assert
        expect(updated[0]?.status).toBe('confirmed')
    })
})

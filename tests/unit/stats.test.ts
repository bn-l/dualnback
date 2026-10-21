import { addDays } from 'date-fns'
import { describe, expect, it } from 'vite-plus/test'
import type { Stat } from '../../src/domain/analysis-types'
import { STAT_GROUPS } from '../../src/domain/analysis-types'
import { computeStats, statFindings } from '../../src/domain/stats'
import { criterion, dPrime, runsTestZ, exGaussianTau } from '../../src/domain/stats/measures'
import {
    BASE,
    type Behaviour,
    allNumbers,
    buildDataset,
    bursty,
    emptyDataset,
    manyRounds,
    noisy,
    perfect,
    random,
    silent,
} from './fixtures-stats'

const NOW = addDays(BASE, 40)

const statById = (stats: readonly Stat[], id: string): Stat => {
    const stat = stats.find((candidate) => candidate.id === id)
    if (stat === undefined) {
        throw new Error(`No stat ${id}`)
    }
    return stat
}

const expectAllFinite = (stats: readonly Stat[]): void => {
    const numbers = allNumbers(stats)
    const broken = numbers.filter((value) => !Number.isFinite(value))
    expect(broken).toEqual([])
    stats.forEach((stat) => {
        expect(stat.display).not.toMatch(/NaN|Infinity|undefined|null/)
        expect(stat.meaning).not.toMatch(/NaN|Infinity|undefined|null/)
    })
}

describe('computeStats', () => {
    it('covers every group with unique ids, sentence-case names and no broken numbers on an empty dataset', () => {
        // Arrange
        const dataset = emptyDataset()

        // Act
        const stats = computeStats(dataset, NOW)

        // Assert
        expect(new Set(stats.map(({ id }) => id)).size).toBe(stats.length)
        expect(new Set(stats.map(({ group }) => group))).toEqual(new Set(STAT_GROUPS.map(({ id }) => id)))
        expect(stats.every(({ value }) => value === null)).toBe(true)
        expect(stats.every(({ trend }) => trend.length === 0)).toBe(true)
        expect(statById(stats, 'rt-position').display).toBe('Not enough rounds yet')
        expect(statById(stats, 'simple-rt').display).toBe('No reaction tests yet')
        expect(stats.every(({ name }) => name.charAt(0) === name.charAt(0).toUpperCase())).toBe(true)
        expectAllFinite(stats)
    })

    it('scores a single perfect round as 100% accurate without NaN anywhere', () => {
        // Arrange
        const dataset = buildDataset([{ behaviour: perfect }])

        // Act
        const stats = computeStats(dataset, NOW)

        // Assert
        expect(statById(stats, 'accuracy').value).toBe(1)
        expect(statById(stats, 'accuracy').display).toBe('100%')
        expect(statById(stats, 'false-alarms-position').value).toBe(0)
        expect(statById(stats, 'rating').value).toBe(dataset.rounds[0]?.ratingAfter?.rating)
        expectAllFinite(stats)
    })

    it('handles rounds with no presses at all: zero accuracy, finite sensitivity, cautious bias', () => {
        // Arrange
        const dataset = buildDataset(manyRounds(4, silent))

        // Act
        const stats = computeStats(dataset, NOW)

        // Assert
        expect(statById(stats, 'accuracy').value).toBe(0)
        expect(statById(stats, 'matches-caught-sound').value).toBe(0)
        expect(statById(stats, 'sensitivity-position').value).not.toBeNull()
        expect(statById(stats, 'caution-position').value).toBeGreaterThan(0)
        expect(statById(stats, 'rt-position').value).toBeNull()
        expect(statById(stats, 'hold-time').value).toBeNull()
        expectAllFinite(stats)
    })

    it('computes d′ and c with the log-linear correction (Hautus 1995)', () => {
        // Arrange
        const counts = { hits: 8, misses: 2, falseAlarms: 1, correctRejections: 9 }

        // Act
        const sensitivity = dPrime(counts)
        const bias = criterion(counts)

        // Assert: reference values from Python's statistics.NormalDist with H = 8.5/11, F = 1.5/11.
        // simple-statistics' probit is an approximation good to about 3 decimals.
        expect(sensitivity).toBeCloseTo(1.84466, 3)
        expect(bias).toBeCloseTo(0.17447, 3)
    })

    it('gives d′ of zero for a player who never presses, instead of infinity', () => {
        // Arrange
        const counts = { hits: 0, misses: 10, falseAlarms: 0, correctRejections: 10 }

        // Act
        const sensitivity = dPrime(counts)

        // Assert
        expect(sensitivity).toBeCloseTo(0, 6)
    })

    it('keeps every value and trend finite across a month of noisy play', () => {
        // Arrange
        const dataset = buildDataset(manyRounds(45, noisy()), {
            baselines: [{ id: 'b1', at: BASE.getTime(), deviceKey: 'test-device', reactionTimes: [250, 260, 270], misses: 0, anticipations: 0, medianRt: 260 }],
            screenViews: [0, 1, 2, 3].map((index) => ({
                id: `v${index}`, sessionId: 'session-0', screen: 'results', enteredAt: BASE.getTime() + index * 1000, leftAt: BASE.getTime() + index * 1000 + 6000,
            })),
        })

        // Act
        const stats = computeStats(dataset, NOW)

        // Assert
        expectAllFinite(stats)
        expect(statById(stats, 'rt-position').trend.length).toBeGreaterThan(5)
        expect(statById(stats, 'slow-tail-position').value).toBeGreaterThan(0)
        expect(statById(stats, 'consistency-sound').value).toBeGreaterThan(0)
        expect(statById(stats, 'rounds-played').value).toBe(45)
        expect(statById(stats, 'time-on-results').display).toBe('6 s')
        expect(statById(stats, 'simple-rt').display).toBe('260 ms')
        expect(statById(stats, 'break-length').display).toBe('40 s')
        expect(statById(stats, 'round-1').value).not.toBeNull()
        expect(statById(stats, 'learning-rate').value).not.toBeNull()
        // Days 11–14 of play fall inside the 30-day window ending on day 40.
        expect(statById(stats, 'rest-days').value).toBe(26)
    })

    it('leaves timing stats empty when every trial is flagged', () => {
        // Arrange
        const dataset = buildDataset(manyRounds(5, noisy()).map((options) => ({ ...options, flags: { hidden: true } })))

        // Act
        const stats = computeStats(dataset, NOW)

        // Assert
        expect(statById(stats, 'rt-position').value).toBeNull()
        expect(statById(stats, 'slow-tail-sound').value).toBeNull()
        expect(statById(stats, 'accuracy').value).not.toBeNull()
        expectAllFinite(stats)
    })

    it('reports zero spread and no slow tail when every reaction time is identical', () => {
        // Arrange
        const constant: Behaviour = ({ trial, sense }) => ({
            press: sense === 'position' ? trial.positionMatch : trial.soundMatch,
            rt: 500,
            hold: 100,
        })
        const dataset = buildDataset(manyRounds(4, constant))

        // Act
        const stats = computeStats(dataset, NOW)

        // Assert
        expect(statById(stats, 'rt-position').value).toBe(500)
        expect(statById(stats, 'rt-spread-position').value).toBe(0)
        expect(statById(stats, 'consistency-position').value).toBe(0)
        expect(statById(stats, 'slow-tail-position').value).toBeNull()
        expectAllFinite(stats)
    })

    it('finds no slow tail when reaction times are skewed left', () => {
        // Arrange
        const leftSkew: Behaviour = ({ trial, sense, rng }) => ({
            press: sense === 'position' ? trial.positionMatch : trial.soundMatch,
            rt: 900 + Math.log(1 - random(rng) * 0.999) * 150,
        })
        const dataset = buildDataset(manyRounds(6, leftSkew))

        // Act
        const stats = computeStats(dataset, NOW)

        // Assert
        expect(statById(stats, 'slow-tail-position').value).toBeNull()
        expect(statById(stats, 'slow-tail-position').display).toBe('Not enough rounds yet')
    })

    it('counts quits and where they happen', () => {
        // Arrange
        const rounds = [
            ...manyRounds(6, perfect),
            { behaviour: perfect, day: 1, minute: 30, index: 3, completed: false, quitAtTrial: 9 },
        ]
        const dataset = buildDataset(rounds)

        // Act
        const stats = computeStats(dataset, NOW)

        // Assert
        expect(statById(stats, 'quit-rate').value).toBeCloseTo(1 / 7)
        expect(statById(stats, 'quit-point').display).toBe('Trial 10')
        expect(statById(stats, 'rounds-played').value).toBe(6)
    })

    it('measures lure false alarms separately from plain non-matches', () => {
        // Arrange
        const lureChaser: Behaviour = ({ trial, sense, n }) => {
            const match = sense === 'position' ? trial.positionMatch : trial.soundMatch
            const lags = sense === 'position' ? trial.positionLags : trial.soundLags
            return { press: match || lags.includes(n + 1), rt: 500 }
        }
        const dataset = buildDataset(manyRounds(12, lureChaser))

        // Act
        const stats = computeStats(dataset, NOW)

        // Assert
        expect(statById(stats, 'lure-plus-1').value).toBe(1)
        expect(statById(stats, 'plain-false-alarms').value).toBe(0)
        expect(statById(stats, 'lure-minus-1').value).toBeLessThan(1)
    })
})

describe('statFindings', () => {
    it('returns nothing for an empty dataset or fewer than ten rounds', () => {
        // Arrange
        const empty = emptyDataset()
        const few = buildDataset(manyRounds(9, bursty))

        // Act
        const fromEmpty = statFindings(empty, NOW)
        const fromFew = statFindings(few, NOW)

        // Assert
        expect(fromEmpty).toEqual([])
        expect(fromFew).toEqual([])
    })

    it('finds clustered errors when lapses come in bursts', () => {
        // Arrange
        const dataset = buildDataset(manyRounds(30, bursty))

        // Act
        const findings = statFindings(dataset, NOW)

        // Assert
        const clustered = findings.find(({ id }) => id === 'why-errors-clustered')
        expect(clustered?.sentence).toBe('Your errors come in clusters. Those are lapses of focus, not memory limits.')
        expect(clustered?.evidence.length).toBeLessThanOrEqual(4)
        expect(clustered?.basis).toMatch(/^From 30 rounds over \d+ (days?|weeks?)\.$/)
    })

    it('does not call randomly scattered errors clustered', () => {
        // Arrange
        const dataset = buildDataset(manyRounds(30, noisy(0.75, 0.12)))

        // Act
        const findings = statFindings(dataset, NOW)

        // Assert
        expect(findings.map(({ id }) => id)).not.toContain('why-errors-clustered')
    })

    it('reports press order and the gap when position always goes first', () => {
        // Arrange
        const positionFirst: Behaviour = ({ trial, sense }) => ({
            press: sense === 'position' ? trial.positionMatch : trial.soundMatch,
            rt: sense === 'position' ? 450 : 750,
        })
        const dataset = buildDataset(manyRounds(40, positionFirst))

        // Act
        const findings = statFindings(dataset, NOW)

        // Assert
        const order = findings.find(({ id }) => id === 'timing-press-order')
        expect(order?.sentence).toBe('When both match, you press position first, and your sound press comes 300 ms later.')
    })

    it('flags slow presses as guesses when false alarms are slow and hits are quick', () => {
        // Arrange
        const slowGuesser: Behaviour = ({ trial, sense, rng }) => {
            const match = sense === 'position' ? trial.positionMatch : trial.soundMatch
            const guess = !match && random(rng) < 0.2
            return { press: match || guess, rt: guess ? 950 : 450, hold: guess ? 200 : 110 }
        }
        const dataset = buildDataset(manyRounds(20, slowGuesser))

        // Act
        const findings = statFindings(dataset, NOW)

        // Assert
        const slow = findings.find(({ id }) => id === 'timing-slow-presses')
        expect(slow?.sentence).toMatch(/^When you take longer than 800 ms to press, you're right only 0% of the time\. Slow presses are mostly guesses\.$/)
        expect(findings.find(({ id }) => id === 'timing-hold-wrong')?.sentence).toBe('You hold the key 90 ms longer on wrong answers.')
    })

    it('names the weak square when matches there are always missed', () => {
        // Arrange
        const blindCorner: Behaviour = ({ trial, sense }) => ({
            press: sense === 'position' ? trial.positionMatch && trial.position !== 6 : trial.soundMatch,
            rt: 450,
        })
        const dataset = buildDataset(manyRounds(40, blindCorner))

        // Act
        const findings = statFindings(dataset, NOW)

        // Assert
        const weak = findings.find(({ id }) => id === 'why-weak-square')
        expect(weak?.sentence).toMatch(/^The bottom left square is your weak spot\. You catch 0% of matches there, against 100% elsewhere\.$/)
        expect(weak?.controllable).toBe(false)
    })

    it('spots a cautious bias on sound', () => {
        // Arrange
        const cautious: Behaviour = ({ trial, sense, rng }) => ({
            press: sense === 'position' ? trial.positionMatch : trial.soundMatch && random(rng) < 0.5,
            rt: 450,
        })
        const dataset = buildDataset(manyRounds(20, cautious))

        // Act
        const findings = statFindings(dataset, NOW)

        // Assert
        expect(findings.find(({ id }) => id === 'why-cautious-sound')?.sentence)
            .toBe("You're cautious on sound: you'd rather miss than guess.")
    })

    it('compares today\'s reaction test with earlier ones', () => {
        // Arrange
        const earlier = [250, 255, 248, 252, 251, 249].map((medianRt, index) => ({
            id: `b${index}`, at: addDays(NOW, -(index + 1)).getTime(), deviceKey: 'd', reactionTimes: [], misses: 0, anticipations: 0, medianRt,
        }))
        const today = { id: 'today', at: NOW.getTime(), deviceKey: 'd', reactionTimes: [], misses: 0, anticipations: 0, medianRt: 280 }
        const dataset = buildDataset([], { baselines: [...earlier, today] })

        // Act
        const findings = statFindings(dataset, NOW)

        // Assert
        expect(findings.find(({ id }) => id === 'timing-baseline-today')?.sentence)
            .toBe('Your simple reaction time is 30 ms slower than usual today.')
    })

    it('produces only its own kinds of finding, with stable unique ids and finite evidence', () => {
        // Arrange
        const dataset = buildDataset(manyRounds(60, bursty))

        // Act
        const findings = statFindings(dataset, NOW)

        // Assert
        expect(findings.length).toBeGreaterThan(0)
        expect(new Set(findings.map(({ id }) => id)).size).toBe(findings.length)
        findings.forEach((finding) => {
            expect(['why-you-miss', 'timing', 'progress']).toContain(finding.kind)
            expect(finding.evidence.length).toBeLessThanOrEqual(4)
            expect(finding.evidence.every(({ value }) => Number.isFinite(value))).toBe(true)
            expect(finding.sentence).not.toMatch(/NaN|Infinity|undefined|!/)
        })
    })
})

describe('measures', () => {
    it('reads bunched errors as clustered and alternating ones as not', () => {
        // Arrange
        const bunched = [false, false, false, false, true, true, true, true, false, false, false, false]
        const alternating = [true, false, true, false, true, false, true, false, true, false, true, false]

        // Act
        const bunchedZ = runsTestZ(bunched)
        const alternatingZ = runsTestZ(alternating)

        // Assert
        expect(bunchedZ).toBeLessThan(-1.96)
        expect(alternatingZ).toBeGreaterThan(1.96)
    })

    it('refuses to run the runs test on too few errors', () => {
        // Arrange
        const oneError = [false, false, true, false, false]
        const noErrors = [false, false, false]

        // Act
        const results = [runsTestZ(oneError), runsTestZ(noErrors), runsTestZ([])]

        // Assert
        expect(results).toEqual([null, null, null])
    })

    it('finds a slow tail only in right-skewed reaction times', () => {
        // Arrange
        const rightSkewed = [400, 410, 420, 430, 440, 450, 460, 900, 1200]
        const constant = [500, 500, 500, 500]
        const tooFew = [400, 900]

        // Act
        const tails = [exGaussianTau(rightSkewed), exGaussianTau(constant), exGaussianTau(tooFew)]

        // Assert
        expect(tails[0]).toBeGreaterThan(0)
        expect(tails[1]).toBeNull()
        expect(tails[2]).toBeNull()
    })
})

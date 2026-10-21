import type { Sense } from '../data/schema'
import { SENSES } from '../data/schema'
import type { ScoredRound, ScoredTrial } from './scoring'
import { responseFor } from './scoring'
import { type ResponseEntry, THIRDS, hitRts, responsesOf, thirdOf } from './stats/derive'
import { LURE_OFFSETS, isLureAt, offsetLabel, roundClusterZ } from './stats/errors'
import { Z_95, coefficientOfVariation, exGaussianTau, medianOf } from './stats/measures'
import { senseName } from './stats/spec'

// The accuracy strip under a round's result has this many segments per sense.
export const SEGMENT_COUNT = 7

const MIN_RTS = { median: 3, spread: 5 }
// Errors in a third before it counts as a slip, and how many more than the other end.
const SLIP = { min: 2, margin: 1 }
const STEADY_MAX = 2
const LURE_MIN = 2
const HALF = 0.5
const FIRST = 0
const MIDDLE = 1
const LAST = THIRDS - 1

export interface RoundSummary {
    sentence: string
    // Share of trials answered right in each segment, per sense, 0–1.
    segments: Record<Sense, number[]>
}

export interface RoundDetail {
    lureErrors: Array<{ lag: number; label: string; count: number }>
    medianRt: number | null
    consistency: number | null
    slowTail: number | null
    clustering: 'clustered' | 'spread' | 'too-few'
    trials: ScoredTrial[]
}

const isError = (trial: ScoredTrial, sense: Sense): boolean => {
    const outcome = responseFor(trial, sense).outcome
    return outcome === 'miss' || outcome === 'false-alarm'
}

const segmentsFor = (scored: ScoredRound, sense: Sense): number[] =>
    Array.from({ length: SEGMENT_COUNT }, (_, segment) => {
        const inSegment = scored.trials.filter(({ trial }) =>
            Math.floor((trial.index * SEGMENT_COUNT) / Math.max(1, scored.trials.length)) === segment)
        return inSegment.length === 0
            ? 1
            : inSegment.filter((trial) => !isError(trial, sense)).length / inSegment.length
    })

type Verdict = 'clean' | 'slipped-late' | 'errors-early' | 'lures' | 'steady' | 'spread'

const lureErrorCount = (entries: readonly ResponseEntry[]): number =>
    entries.filter((entry) => entry.response.outcome === 'false-alarm' &&
        LURE_OFFSETS.some((offset) => isLureAt(entry, offset))).length

const verdictFor = (scored: ScoredRound, sense: Sense): { verdict: Verdict; errors: number; lures: number } => {
    const byThird = [FIRST, MIDDLE, LAST].map((third) =>
        scored.trials.filter((trial) => thirdOf(trial, scored) === third && isError(trial, sense)).length)
    const [first = 0, middle = 0, last = 0] = byThird
    const errors = first + middle + last
    const lures = lureErrorCount(responsesOf([scored], sense))
    const verdict: Verdict = errors === 0
        ? 'clean'
        : last >= SLIP.min && last > first + SLIP.margin && last > middle
            ? 'slipped-late'
            : first >= SLIP.min && first > last + SLIP.margin
                ? 'errors-early'
                : lures >= LURE_MIN && lures >= errors * HALF
                    ? 'lures'
                    : errors <= STEADY_MAX
                        ? 'steady'
                        : 'spread'
    return { verdict, errors, lures }
}

const phrase = (sense: Sense, result: { verdict: Verdict; errors: number; lures: number }): string => {
    const name = senseName(sense)
    switch (result.verdict) {
        case 'clean':
            return `${name} had no errors.`
        case 'slipped-late':
            return `${name} slipped in the last third.`
        case 'errors-early':
            return `${name} errors came early.`
        case 'lures':
            return `${name} lures caught you ${result.lures} times.`
        case 'steady':
            return `${name} held steady.`
        case 'spread':
            return `${name} had ${result.errors} errors spread through the round.`
    }
}

export const roundSummary = (scored: ScoredRound): RoundSummary => {
    const verdicts = SENSES.map((sense) => ({ sense, result: verdictFor(scored, sense) }))
    const shared = new Set(verdicts.map(({ result }) => result.verdict))
    const sentence = shared.size === 1 && shared.has('clean')
        ? 'No errors in either sense.'
        : shared.size === 1 && shared.has('steady')
            ? 'Both senses held steady.'
            : verdicts.map(({ sense, result }) => phrase(sense, result)).join(' ')
    return {
        sentence,
        segments: { position: segmentsFor(scored, 'position'), sound: segmentsFor(scored, 'sound') },
    }
}

export const roundDetail = (scored: ScoredRound): RoundDetail => {
    const entries = responsesOf([scored])
    const n = scored.round.step.n
    const rts = hitRts([scored])
    const z = roundClusterZ(scored)
    return {
        lureErrors: LURE_OFFSETS.filter((offset) => n + offset >= 1).map((offset) => ({
            lag: n + offset,
            label: offsetLabel(offset),
            count: entries.filter((entry) => !entry.match && entry.response.outcome === 'false-alarm' &&
                isLureAt(entry, offset)).length,
        })),
        medianRt: rts.length >= MIN_RTS.median ? medianOf(rts) : null,
        consistency: rts.length >= MIN_RTS.spread ? coefficientOfVariation(rts) : null,
        slowTail: rts.length >= MIN_RTS.spread ? exGaussianTau(rts) : null,
        clustering: z === null ? 'too-few' : z <= -Z_95 ? 'clustered' : 'spread',
        trials: scored.trials,
    }
}

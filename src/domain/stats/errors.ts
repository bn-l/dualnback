import type { Sense } from '../../data/schema'
import type { ScoredRound } from '../scoring'
import { type ResponseEntry, type Slice, isErrorTrial, responsesOf, rtsOf } from './derive'
import { decimal, percent, signedMs, absMs } from './display'
import { Z_95, combinedZ, meanOf, medianOf, ratio, runsTestZ } from './measures'
import type { StatSpec } from './spec'

const MIN = { lureTrials: 10, rts: 10, errors: 10, clusterRounds: 3 }
const AFTER_ERROR_WINDOW = 3
const DECIMALS = { runs: 1 }
const NEAR = 1
const FAR = 2

// Lures as offsets from N: N−2, N−1, N+1, N+2.
export const LURE_OFFSETS: readonly number[] = [-FAR, -NEAR, NEAR, FAR]

export const offsetLabel = (offset: number): string => (offset < 0 ? `N−${-offset}` : `N+${offset}`)

const lagsOf = (entry: ResponseEntry): readonly number[] =>
    entry.sense === 'position' ? entry.trial.trial.positionLags : entry.trial.trial.soundLags

export const isLureAt = (entry: ResponseEntry, offset: number): boolean => {
    const lag = entry.scored.round.step.n + offset
    return lag >= 1 && lagsOf(entry).includes(lag)
}

export interface LureRate {
    falseAlarms: number
    trials: number
    rate: number
}

// False-alarm rate on non-matches that repeat the stimulus from N + offset back.
export const lureRate = (scored: readonly ScoredRound[], offset: number, sense?: Sense): LureRate | null => {
    const lures = responsesOf(scored, sense).filter((entry) => !entry.match && isLureAt(entry, offset))
    const falseAlarms = lures.filter(({ response }) => response.outcome === 'false-alarm').length
    const rate = ratio(falseAlarms, lures.length)
    return rate !== null && lures.length >= MIN.lureTrials ? { falseAlarms, trials: lures.length, rate } : null
}

// False-alarm rate on non-matches that repeat nothing nearby.
export const plainRate = (scored: readonly ScoredRound[]): LureRate | null => {
    const plain = responsesOf(scored).filter((entry) => !entry.match && lagsOf(entry).length === 0)
    const falseAlarms = plain.filter(({ response }) => response.outcome === 'false-alarm').length
    const rate = ratio(falseAlarms, plain.length)
    return rate !== null && plain.length >= MIN.lureTrials ? { falseAlarms, trials: plain.length, rate } : null
}

export const roundClusterZ = (round: ScoredRound): number | null => runsTestZ(round.trials.map(isErrorTrial))

export const clusterZ = (scored: readonly ScoredRound[]): { z: number; rounds: number } | null => {
    const zs = scored.flatMap((round) => {
        const z = roundClusterZ(round)
        return z === null ? [] : [z]
    })
    const z = combinedZ(zs)
    return z !== null && zs.length >= MIN.clusterRounds ? { z, rounds: zs.length } : null
}

// Reaction times on trials right after an error, and right after a correct trial.
export const afterErrorRts = (scored: readonly ScoredRound[]): { afterError: number[]; afterCorrect: number[] } => {
    const followers = scored.flatMap((round) => {
        const pressedEntries = responsesOf([round]).filter(({ response }) => response.press !== null)
        return round.trials.flatMap((trial, position) => {
            const previous = round.trials[position - 1]
            return previous === undefined
                ? []
                : [{
                    afterError: isErrorTrial(previous),
                    rts: rtsOf(pressedEntries.filter((entry) => entry.trial === trial)),
                }]
        })
    })
    return {
        afterError: followers.filter(({ afterError }) => afterError).flatMap(({ rts }) => rts),
        afterCorrect: followers.filter(({ afterError }) => !afterError).flatMap(({ rts }) => rts),
    }
}

export const postErrorSlowing = (scored: readonly ScoredRound[]): number | null => {
    const { afterError, afterCorrect } = afterErrorRts(scored)
    const slowed = medianOf(afterError)
    const normal = medianOf(afterCorrect)
    return afterError.length >= MIN.rts && afterCorrect.length >= MIN.rts && slowed !== null && normal !== null
        ? slowed - normal
        : null
}

// Share of fully correct trials among the few right after an error, and overall.
export const afterErrorAccuracy = (scored: readonly ScoredRound[]): { after: number; overall: number } | null => {
    const trials = scored.flatMap((round) => round.trials)
    const following = scored.flatMap((round) => round.trials.flatMap((trial, position) =>
        isErrorTrial(trial) ? round.trials.slice(position + 1, position + 1 + AFTER_ERROR_WINDOW) : []))
    const errors = trials.filter(isErrorTrial).length
    const after = ratio(following.filter((trial) => !isErrorTrial(trial)).length, following.length)
    const overall = ratio(trials.filter((trial) => !isErrorTrial(trial)).length, trials.length)
    return errors >= MIN.errors && after !== null && overall !== null ? { after, overall } : null
}

const errorRuns = (round: ScoredRound): number[] =>
    round.trials.map(isErrorTrial).reduce<number[]>((runs, isError, position, all) => {
        if (!isError) {
            return runs
        }
        const continuing = position > 0 && all[position - 1] === true
        const last = runs[runs.length - 1]
        return continuing && last !== undefined ? [...runs.slice(0, -1), last + 1] : [...runs, 1]
    }, [])

export const meanErrorRun = (scored: readonly ScoredRound[]): number | null => {
    const runs = scored.flatMap(errorRuns)
    return runs.reduce((sum, run) => sum + run, 0) >= MIN.errors ? meanOf(runs) : null
}

const lureSpec = (offset: number): StatSpec => ({
    id: `lure-${offset < 0 ? 'minus' : 'plus'}-${Math.abs(offset)}`,
    group: 'errors',
    name: `${offsetLabel(offset)} lures`,
    technicalName: 'lure false-alarm rate',
    compute: (slice) => lureRate(slice.scored, offset)?.rate ?? null,
    display: (value) => percent(value),
    meaning: (value) => `You press on ${percent(value)} of non-matches that repeat the stimulus from ${offsetLabel(offset)} back.`,
    trend: 'daily',
    missing: { display: 'Not enough lures yet', meaning: 'This fills in as you meet more lures.' },
})

export const errorSpecs: readonly StatSpec[] = [
    ...LURE_OFFSETS.map(lureSpec),
    {
        id: 'plain-false-alarms',
        group: 'errors',
        name: 'Other non-matches',
        technicalName: 'false-alarm rate, no lure',
        compute: (slice) => plainRate(slice.scored)?.rate ?? null,
        display: (value) => percent(value),
        meaning: (value) => `On non-matches that repeat nothing nearby, you press ${percent(value)} of the time.`,
        trend: 'daily',
    },
    {
        id: 'clustering',
        group: 'errors',
        name: 'Error clustering',
        technicalName: 'Wald–Wolfowitz runs test',
        compute: (slice: Slice) => clusterZ(slice.scored)?.z ?? null,
        display: (value) => (value <= -Z_95 ? 'Clustered' : 'Not clustered'),
        meaning: (value) => value <= -Z_95
            ? 'Your errors bunch together, which points to lapses of focus more than memory limits.'
            : 'Your errors are spread through your rounds, which points to memory limits more than lapses of focus.',
        trend: 'daily',
    },
    {
        id: 'post-error-slowing',
        group: 'errors',
        name: 'After an error: speed',
        technicalName: 'post-error slowing',
        compute: (slice) => postErrorSlowing(slice.scored),
        display: (value) => signedMs(value),
        meaning: (value) => value >= 0
            ? `On the trial after an error, you press ${absMs(value)} slower than usual.`
            : `On the trial after an error, you press ${absMs(value)} faster than usual.`,
        trend: 'daily',
    },
    {
        id: 'after-error-accuracy',
        group: 'errors',
        name: 'After an error: accuracy',
        technicalName: null,
        compute: (slice) => afterErrorAccuracy(slice.scored)?.after ?? null,
        display: (value) => percent(value),
        meaning: (value, slice) => `On the ${AFTER_ERROR_WINDOW} trials after an error, ${percent(value)} are fully right, against ${percent(afterErrorAccuracy(slice.scored)?.overall ?? 0)} overall.`,
        trend: 'daily',
    },
    {
        id: 'recovery',
        group: 'errors',
        name: 'Recovery',
        technicalName: 'mean error run length',
        compute: (slice) => meanErrorRun(slice.scored),
        display: (value) => `${decimal(value, DECIMALS.runs)} trials`,
        meaning: (value) => `Once you slip, it takes ${decimal(value, DECIMALS.runs)} trials on average to get back on track.`,
        trend: 'daily',
    },
]

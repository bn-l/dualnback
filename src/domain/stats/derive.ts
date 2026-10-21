import type { Dataset } from '../../data/dataset'
import type {
    BaselineRecord,
    RoundRecord,
    ScreenViewRecord,
    Sense,
    SessionRecord,
} from '../../data/schema'
import { SENSES } from '../../data/schema'
import { dayKey } from '../format'
import { pointsFromResultDelta } from '../rating'
import type { Counts, Outcome, ScoredRound, ScoredTrial, SenseResponse } from '../scoring'
import { EARLY_PRESS_MS, isMatch, responseFor } from '../scoring'
import { meanOf } from './measures'

// The data a stat is computed over: everything, or one day of it for the trend.
export interface Slice {
    scored: ScoredRound[]
    // Every round, including ones quit part-way.
    rounds: RoundRecord[]
    sessions: SessionRecord[]
    baselines: BaselineRecord[]
    screenViews: ScreenViewRecord[]
}

export const fullSlice = (dataset: Dataset): Slice => ({
    scored: dataset.scored,
    rounds: dataset.rounds,
    sessions: dataset.sessions,
    baselines: dataset.baselines,
    screenViews: dataset.screenViews,
})

const byDay = <T>(items: readonly T[], at: (item: T) => number): Map<string, T[]> =>
    items.reduce((groups, item) => {
        const day = dayKey(at(item))
        const group = groups.get(day)
        if (group === undefined) {
            groups.set(day, [item])
        } else {
            group.push(item)
        }
        return groups
    }, new Map<string, T[]>())

export const dailySlices = (dataset: Dataset): Array<{ day: string; slice: Slice }> => {
    const scored = byDay(dataset.scored, ({ round }) => round.startedAt)
    const rounds = byDay(dataset.rounds, ({ startedAt }) => startedAt)
    const sessions = byDay(dataset.sessions, ({ startedAt }) => startedAt)
    const baselines = byDay(dataset.baselines, ({ at }) => at)
    const screenViews = byDay(dataset.screenViews, ({ enteredAt }) => enteredAt)
    const days = [...new Set([...rounds.keys(), ...baselines.keys()])].sort((a, b) => a.localeCompare(b))
    return days.map((day) => ({
        day,
        slice: {
            scored: scored.get(day) ?? [],
            rounds: rounds.get(day) ?? [],
            sessions: sessions.get(day) ?? [],
            baselines: baselines.get(day) ?? [],
            screenViews: screenViews.get(day) ?? [],
        },
    }))
}

export interface ResponseEntry {
    scored: ScoredRound
    trial: ScoredTrial
    sense: Sense
    response: SenseResponse
    match: boolean
}

// Every stat walks the same responses, once overall and once per day. Caching them per
// list of rounds keeps a year of play from rebuilding millions of entries.
const responseCache = new WeakMap<readonly ScoredRound[], Map<string, readonly ResponseEntry[]>>()

export const responsesOf = (scored: readonly ScoredRound[], only?: Sense): readonly ResponseEntry[] => {
    const key = only ?? 'both'
    const cached = responseCache.get(scored)?.get(key)
    if (cached !== undefined) {
        return cached
    }
    const entries = scored.flatMap((round) => round.trials.flatMap((trial) =>
        SENSES.filter((sense) => only === undefined || sense === only).map((sense) => ({
            scored: round,
            trial,
            sense,
            response: responseFor(trial, sense),
            match: isMatch(trial.trial, sense),
        }))))
    responseCache.set(scored, (responseCache.get(scored) ?? new Map<string, readonly ResponseEntry[]>()).set(key, entries))
    return entries
}

export const withOutcome = (entries: readonly ResponseEntry[], outcomes: readonly Outcome[]): ResponseEntry[] =>
    entries.filter(({ response }) => outcomes.includes(response.outcome))

// Reaction times worth timing: the trial's clock was trustworthy and the press wasn't a guess.
export const timedEntries = (entries: readonly ResponseEntry[]): ResponseEntry[] =>
    entries.filter(({ trial, response }) =>
        trial.timingUsable && response.rt !== null && response.rt >= EARLY_PRESS_MS && !response.late)

export const rtsOf = (entries: readonly ResponseEntry[]): number[] =>
    timedEntries(entries).flatMap(({ response }) => (response.rt === null ? [] : [response.rt]))

export const hitRts = (scored: readonly ScoredRound[], sense?: Sense): number[] =>
    rtsOf(withOutcome(responsesOf(scored, sense), ['hit']))

export const holdTimes = (entries: readonly ResponseEntry[]): number[] =>
    entries.flatMap(({ response }) => {
        const press = response.press
        return press !== null && press.upAt !== null && press.upAt >= press.downAt ? [press.upAt - press.downAt] : []
    })

export const pressed = (entries: readonly ResponseEntry[]): ResponseEntry[] =>
    entries.filter(({ response }) => response.press !== null)

const ZERO_COUNTS: Counts = { hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0 }

const addCounts = (a: Counts, b: Counts): Counts => ({
    hits: a.hits + b.hits,
    misses: a.misses + b.misses,
    falseAlarms: a.falseAlarms + b.falseAlarms,
    correctRejections: a.correctRejections + b.correctRejections,
})

export const countsOf = (scored: readonly ScoredRound[], only?: Sense): Counts =>
    scored.reduce((total, round) =>
        SENSES.filter((sense) => only === undefined || sense === only)
            .reduce((sum, sense) => addCounts(sum, round.counts[sense]), total), ZERO_COUNTS)

export const countsFromEntries = (entries: readonly ResponseEntry[]): Counts => ({
    hits: entries.filter(({ response }) => response.outcome === 'hit').length,
    misses: entries.filter(({ response }) => response.outcome === 'miss').length,
    falseAlarms: entries.filter(({ response }) => response.outcome === 'false-alarm').length,
    correctRejections: entries.filter(({ response }) => response.outcome === 'correct-rejection').length,
})

// Hits out of everything that wasn't a correct "no", as the rating uses.
export const accuracyFromCounts = (counts: Counts): number | null => {
    const events = counts.hits + counts.misses + counts.falseAlarms
    return events > 0 ? counts.hits / events : null
}

export const isErrorTrial = (trial: ScoredTrial): boolean =>
    SENSES.some((sense) => {
        const outcome = responseFor(trial, sense).outcome
        return outcome === 'miss' || outcome === 'false-alarm'
    })

export const residualOf = (round: RoundRecord): number | null =>
    round.result === null ? null : round.result - round.expected

// Average distance from what the rating predicted, in rating points.
export const residualPoints = (rounds: readonly RoundRecord[]): number | null => {
    const average = meanOf(rounds.flatMap((round) => {
        const residual = residualOf(round)
        return residual === null ? [] : [residual]
    }))
    return average === null ? null : pointsFromResultDelta(average)
}

export const THIRDS = 3

// 0, 1 or 2: which third of its round a trial falls in.
export const thirdOf = (trial: ScoredTrial, scored: ScoredRound): number =>
    Math.min(THIRDS - 1, Math.floor((trial.trial.index * THIRDS) / Math.max(1, scored.trials.length)))

export const lastRatingOf = (rounds: readonly RoundRecord[]): RoundRecord | null =>
    [...rounds]
        .filter(({ ratingAfter }) => ratingAfter !== null)
        .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null

// Rounds of one session in play order, completed or not.
export const roundsBySession = (rounds: readonly RoundRecord[]): RoundRecord[][] =>
    [...rounds.reduce((groups, round) =>
        groups.set(round.sessionId, [...(groups.get(round.sessionId) ?? []), round]), new Map<string, RoundRecord[]>())
        .values()]
        .map((group) => [...group].sort((a, b) => a.index - b.index))

// Completed rounds whose immediately preceding round(s) in the session finished below expected.
export const roundsAfterBelow = (rounds: readonly RoundRecord[], streak: number): RoundRecord[] =>
    roundsBySession(rounds).flatMap((session) => session.filter((round, position) => {
        const before = session.slice(Math.max(0, position - streak), position)
        return round.result !== null && before.length === streak && before.every((previous) => {
            const residual = residualOf(previous)
            return residual !== null && residual < 0
        })
    }))

export const firstRoundsOfDay = (rounds: readonly RoundRecord[]): Set<string> =>
    new Set([...rounds.reduce((firsts, round) => {
        const day = dayKey(round.startedAt)
        const current = firsts.get(day)
        return current === undefined || round.startedAt < current.startedAt ? firsts.set(day, round) : firsts
    }, new Map<string, RoundRecord>()).values()].map(({ id }) => id))

const MS_PER_HOUR = 3_600_000

export const hoursPlayed = (rounds: readonly RoundRecord[]): number =>
    rounds.reduce((sum, round) =>
        sum + (round.perfEnd !== null && round.perfEnd > round.perfStart ? round.perfEnd - round.perfStart : 0), 0) /
    MS_PER_HOUR

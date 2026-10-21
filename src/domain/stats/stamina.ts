import type { ScoredRound } from '../scoring'
import {
    THIRDS,
    type ResponseEntry,
    accuracyFromCounts,
    countsFromEntries,
    firstRoundsOfDay,
    pressed,
    residualPoints,
    responsesOf,
    rtsOf,
    thirdOf,
    withOutcome,
} from './derive'
import { absMs, absPercent, absPoints, points, signed, signedMs, signedPercent, wholeNumber } from './display'
import { difference, meanOf, medianOf } from './measures'
import type { StatSpec } from './spec'

const MIN = { events: 10, rts: 10, rounds: 5, touches: 10 }
const FIRST = 0
const LAST = THIRDS - 1
// Rounds from this one on are grouped together.
const LATE_ROUND = 6

const inThird = (entries: readonly ResponseEntry[], third: number): ResponseEntry[] =>
    entries.filter(({ trial, scored }) => thirdOf(trial, scored) === third)

export const thirdsAccuracy = (scored: readonly ScoredRound[]): { first: number; last: number } | null => {
    const entries = responsesOf(scored)
    const [first, last] = [FIRST, LAST].map((third) => countsFromEntries(inThird(entries, third)))
    if (first === undefined || last === undefined) {
        return null
    }
    const events = (counts: typeof first): number => counts.hits + counts.misses + counts.falseAlarms
    const firstAccuracy = accuracyFromCounts(first)
    const lastAccuracy = accuracyFromCounts(last)
    return events(first) >= MIN.events && events(last) >= MIN.events && firstAccuracy !== null && lastAccuracy !== null
        ? { first: firstAccuracy, last: lastAccuracy }
        : null
}

export const thirdsRt = (scored: readonly ScoredRound[]): { first: number; last: number } | null => {
    const hits = withOutcome(responsesOf(scored), ['hit'])
    const first = rtsOf(inThird(hits, FIRST))
    const last = rtsOf(inThird(hits, LAST))
    const firstMedian = medianOf(first)
    const lastMedian = medianOf(last)
    return first.length >= MIN.rts && last.length >= MIN.rts && firstMedian !== null && lastMedian !== null
        ? { first: firstMedian, last: lastMedian }
        : null
}

const roundsNumbered = (scored: readonly ScoredRound[], roundNumber: number): ScoredRound[] =>
    scored.filter(({ round }) =>
        roundNumber >= LATE_ROUND ? round.index + 1 >= LATE_ROUND : round.index + 1 === roundNumber)

export const residualForRoundNumber = (scored: readonly ScoredRound[], roundNumber: number): number | null => {
    const rounds = roundsNumbered(scored, roundNumber)
    return rounds.length >= MIN.rounds ? residualPoints(rounds.map(({ round }) => round)) : null
}

export const firstOfDayGap = (scored: readonly ScoredRound[]): number | null => {
    const firsts = firstRoundsOfDay(scored.map(({ round }) => round))
    const first = scored.filter(({ round }) => firsts.has(round.id)).map(({ round }) => round)
    const later = scored.filter(({ round }) => !firsts.has(round.id)).map(({ round }) => round)
    return first.length >= MIN.rounds && later.length >= MIN.rounds
        ? difference(residualPoints(first), residualPoints(later))
        : null
}

const touchDistances = (entries: readonly ResponseEntry[]): number[] =>
    pressed(entries).flatMap(({ response }) => {
        const press = response.press
        return press !== null && press.input !== 'keyboard' && press.offsetX !== null && press.offsetY !== null
            ? [Math.hypot(press.offsetX, press.offsetY)]
            : []
    })

export const touchDrift = (scored: readonly ScoredRound[]): number | null => {
    const entries = responsesOf(scored)
    const first = touchDistances(inThird(entries, FIRST))
    const last = touchDistances(inThird(entries, LAST))
    return first.length >= MIN.touches && last.length >= MIN.touches ? difference(meanOf(last), meanOf(first)) : null
}

const roundSpec = (roundNumber: number): StatSpec => {
    const label = roundNumber >= LATE_ROUND ? `Round ${roundNumber} and later` : `Round ${roundNumber}`
    return {
        id: roundNumber >= LATE_ROUND ? `round-${roundNumber}-plus` : `round-${roundNumber}`,
        group: 'stamina',
        name: `${label} of a session`,
        technicalName: 'result vs expected',
        compute: (slice) => residualForRoundNumber(slice.scored, roundNumber),
        display: (value) => points(value),
        meaning: (value) => `${label} of a session scores ${absPoints(value)} ${value >= 0 ? 'above' : 'below'} what your rating predicts.`,
        trend: 'daily',
    }
}

const ROUND_NUMBERS = Array.from({ length: LATE_ROUND }, (_, offset) => offset + 1)

export const staminaSpecs: readonly StatSpec[] = [
    {
        id: 'stamina-accuracy',
        group: 'stamina',
        name: 'Accuracy, last third vs first',
        technicalName: 'vigilance decrement',
        compute: (slice) => {
            const thirds = thirdsAccuracy(slice.scored)
            return thirds === null ? null : thirds.last - thirds.first
        },
        display: (value) => signedPercent(value),
        meaning: (value) => `Your accuracy in the last third of a round is ${absPercent(value)} ${value >= 0 ? 'higher' : 'lower'} than in the first third.`,
        trend: 'daily',
    },
    {
        id: 'stamina-rt',
        group: 'stamina',
        name: 'Speed, last third vs first',
        technicalName: null,
        compute: (slice) => {
            const thirds = thirdsRt(slice.scored)
            return thirds === null ? null : thirds.last - thirds.first
        },
        display: (value) => signedMs(value),
        meaning: (value) => `In the last third of a round, your reaction time is ${absMs(value)} ${value >= 0 ? 'slower' : 'faster'} than in the first third.`,
        trend: 'daily',
    },
    ...ROUND_NUMBERS.map(roundSpec),
    {
        id: 'first-round-of-day',
        group: 'stamina',
        name: 'First round of the day',
        technicalName: null,
        compute: (slice) => firstOfDayGap(slice.scored),
        display: (value) => points(value),
        meaning: (value) => `Your first round of the day scores ${absPoints(value)} ${value >= 0 ? 'above' : 'below'} your later rounds, against expectation.`,
        trend: 'none',
    },
    {
        id: 'touch-drift',
        group: 'stamina',
        name: 'Touch drift',
        technicalName: null,
        compute: (slice) => touchDrift(slice.scored),
        display: (value) => `${signed(value)} px`,
        meaning: (value) => `Late in a round, your presses land ${wholeNumber(Math.abs(value))} px ${value >= 0 ? 'further from' : 'closer to'} the button's center than early on.`,
        trend: 'daily',
        missing: { display: 'No touch presses yet', meaning: 'This fills in when you play with touch or a mouse.' },
    },
]

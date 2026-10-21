import type { Sense } from '../../data/schema'
import { SENSES } from '../../data/schema'
import { EARLY_PRESS_MS } from '../scoring'
import {
    type ResponseEntry,
    type Slice,
    hitRts,
    holdTimes,
    pressed,
    responsesOf,
    rtsOf,
    timedEntries,
    withOutcome,
} from './derive'
import { absMs, decimal, milliseconds, percent } from './display'
import { coefficientOfVariation, exGaussianTau, medianOf, ratio, sdOf } from './measures'
import { type StatSpec, senseName } from './spec'

const MIN = { rts: 10, presses: 10, bothMatched: 10, baselines: 1 }
const CONSISTENCY = { steady: 0.2, variable: 0.35 }
const DECIMALS = { cv: 2 }
const HALF = 0.5
// Speed bands for "how often your presses are right at different speeds".
export const SPEED_BANDS = { fast: 500, slow: 800 }

// Of the presses in an RT band, the share that were hits rather than false alarms.
export const rightShare = (entries: readonly ResponseEntry[], band: { min: number; max: number }): {
    share: number
    count: number
} | null => {
    const inBand = timedEntries(pressed(entries)).filter(({ response }) =>
        response.rt !== null && response.rt >= band.min && response.rt < band.max)
    const share = ratio(inBand.filter(({ response }) => response.outcome === 'hit').length, inBand.length)
    return share !== null && inBand.length >= MIN.presses ? { share, count: inBand.length } : null
}

export const BANDS = {
    fast: { min: EARLY_PRESS_MS, max: SPEED_BANDS.fast },
    medium: { min: SPEED_BANDS.fast, max: SPEED_BANDS.slow },
    slow: { min: SPEED_BANDS.slow, max: Number.POSITIVE_INFINITY },
}

export interface PressOrder {
    positionFirst: number
    total: number
    gaps: number[]
}

// On trials where both senses matched and both were caught: who went first, and the gap.
export const pressOrder = (entries: readonly ResponseEntry[]): PressOrder => {
    const pairs = entries
        .filter(({ sense, trial, response }) =>
            sense === 'position' && trial.trial.positionMatch && trial.trial.soundMatch &&
            response.outcome === 'hit' && trial.sound.outcome === 'hit')
        .flatMap(({ response, trial }) =>
            response.press !== null && trial.sound.press !== null
                ? [{ position: response.press.downAt, sound: trial.sound.press.downAt }]
                : [])
    return {
        positionFirst: pairs.filter(({ position, sound }) => position < sound).length,
        total: pairs.length,
        gaps: pairs.map(({ position, sound }) => Math.abs(sound - position)),
    }
}

export const holdBy = (entries: readonly ResponseEntry[], outcome: 'hit' | 'false-alarm'): number[] =>
    holdTimes(withOutcome(entries, [outcome]))

const latestBaseline = (slice: Slice): number | null => {
    const latest = [...slice.baselines]
        .filter(({ medianRt }) => medianRt !== null)
        .sort((a, b) => b.at - a.at)[0]
    return latest?.medianRt ?? null
}

const atLeast = (values: readonly number[], count: number): readonly number[] | null =>
    values.length >= count ? values : null

const senseSpecs = (sense: Sense): StatSpec[] => {
    const name = senseName(sense)
    const word = sense === 'position' ? 'position' : 'sound'
    const rts = (slice: Slice): readonly number[] | null => atLeast(hitRts(slice.scored, sense), MIN.rts)
    return [
        {
            id: `rt-${sense}`,
            group: 'speed',
            name: `${name} reaction time`,
            technicalName: 'median RT, hits',
            compute: (slice) => {
                const values = rts(slice)
                return values === null ? null : medianOf(values)
            },
            display: (value) => milliseconds(value),
            meaning: (value) => `Your typical ${word} press on a match comes ${milliseconds(value)} after the stimulus.`,
            trend: 'daily',
        },
        {
            id: `rt-spread-${sense}`,
            group: 'speed',
            name: `${name} reaction time spread`,
            technicalName: 'standard deviation',
            compute: (slice) => {
                const values = rts(slice)
                return values === null ? null : sdOf(values)
            },
            display: (value) => milliseconds(value),
            meaning: (value) => `Your ${word} reaction times usually vary by about ${milliseconds(value)} either way.`,
            trend: 'daily',
        },
        {
            id: `rt-false-alarm-${sense}`,
            group: 'speed',
            name: `${name} false-alarm reaction time`,
            technicalName: 'median RT, false alarms',
            compute: (slice) => {
                const values = atLeast(rtsOf(withOutcome(responsesOf(slice.scored, sense), ['false-alarm'])), MIN.rts)
                return values === null ? null : medianOf(values)
            },
            display: (value) => milliseconds(value),
            meaning: (value) => `When you press ${word} on a non-match, it typically takes ${milliseconds(value)}.`,
            trend: 'daily',
        },
        {
            id: `consistency-${sense}`,
            group: 'speed',
            name: `${name} consistency`,
            technicalName: 'coefficient of variation',
            compute: (slice) => {
                const values = rts(slice)
                return values === null ? null : coefficientOfVariation(values)
            },
            display: (value) => decimal(value, DECIMALS.cv),
            meaning: (value) => {
                const verdict = value < CONSISTENCY.steady ? 'steady' : value < CONSISTENCY.variable ? 'fairly steady' : 'variable'
                return `Your ${word} reaction times vary by ${percent(value)} of their typical value, which is ${verdict}.`
            },
            trend: 'daily',
        },
        {
            id: `slow-tail-${sense}`,
            group: 'speed',
            name: `${name} slow tail`,
            technicalName: 'ex-Gaussian τ',
            compute: (slice) => {
                const values = rts(slice)
                return values === null ? null : exGaussianTau(values)
            },
            display: (value) => milliseconds(value),
            meaning: (value) => `Your slowest ${word} presses stretch about ${milliseconds(value)} beyond your typical speed. A bigger tail means more brief lapses.`,
            trend: 'daily',
        },
    ]
}

const bandSpec = (key: keyof typeof BANDS, label: string): StatSpec => ({
    id: `right-when-${key}`,
    group: 'speed',
    name: `Right when ${label}`,
    technicalName: 'conditional accuracy',
    compute: (slice) => rightShare(responsesOf(slice.scored), BANDS[key])?.share ?? null,
    display: (value) => percent(value),
    meaning: (value) => `${percent(value)} of your presses ${label} are right.`,
    trend: 'daily',
})

export const speedSpecs: readonly StatSpec[] = [
    ...SENSES.flatMap(senseSpecs),
    {
        id: 'anticipations',
        group: 'speed',
        name: 'Anticipations',
        technicalName: 'anticipatory responses',
        compute: (slice) => {
            const presses = pressed(responsesOf(slice.scored))
            const early = presses.filter(({ response }) =>
                !response.late && response.rt !== null && response.rt < EARLY_PRESS_MS)
            return presses.length >= MIN.presses ? ratio(early.length, presses.length) : null
        },
        display: (value) => percent(value),
        meaning: (value) => `${percent(value)} of your presses come under ${EARLY_PRESS_MS} ms after the stimulus, too soon to be a response to it.`,
        trend: 'daily',
    },
    {
        id: 'hold-time',
        group: 'speed',
        name: 'Hold time',
        technicalName: 'key or touch duration',
        compute: (slice) => medianOf(atLeast(holdTimes(pressed(responsesOf(slice.scored))), MIN.presses) ?? []),
        display: (value) => milliseconds(value),
        meaning: (value) => `You typically hold a press down for ${milliseconds(value)}.`,
        trend: 'daily',
    },
    {
        id: 'hold-right',
        group: 'speed',
        name: 'Hold time on right presses',
        technicalName: null,
        compute: (slice) => medianOf(atLeast(holdBy(responsesOf(slice.scored), 'hit'), MIN.presses) ?? []),
        display: (value) => milliseconds(value),
        meaning: (value) => `On presses that catch a match, you hold for ${milliseconds(value)}.`,
        trend: 'daily',
    },
    {
        id: 'hold-wrong',
        group: 'speed',
        name: 'Hold time on wrong presses',
        technicalName: null,
        compute: (slice) => medianOf(atLeast(holdBy(responsesOf(slice.scored), 'false-alarm'), MIN.presses) ?? []),
        display: (value) => milliseconds(value),
        meaning: (value) => `On false alarms, you hold for ${milliseconds(value)}.`,
        trend: 'daily',
    },
    {
        id: 'press-order',
        group: 'speed',
        name: 'Press order',
        technicalName: null,
        compute: (slice) => {
            const order = pressOrder(responsesOf(slice.scored))
            return order.total >= MIN.bothMatched ? ratio(order.positionFirst, order.total) : null
        },
        display: (value) => (value >= HALF ? `Position first, ${percent(value)}` : `Sound first, ${percent(1 - value)}`),
        meaning: (value) => value >= HALF
            ? `When both senses match, you press position first ${percent(value)} of the time.`
            : `When both senses match, you press sound first ${percent(1 - value)} of the time.`,
        trend: 'daily',
    },
    {
        id: 'press-gap',
        group: 'speed',
        name: 'Gap between presses',
        technicalName: null,
        compute: (slice) => {
            const order = pressOrder(responsesOf(slice.scored))
            return order.total >= MIN.bothMatched ? medianOf(order.gaps) : null
        },
        display: (value) => milliseconds(value),
        meaning: (value) => `When both senses match, your second press follows the first by ${milliseconds(value)}.`,
        trend: 'daily',
    },
    bandSpec('fast', `under ${SPEED_BANDS.fast} ms`),
    bandSpec('medium', `between ${SPEED_BANDS.fast} and ${SPEED_BANDS.slow} ms`),
    bandSpec('slow', `over ${SPEED_BANDS.slow} ms`),
    {
        id: 'late-presses',
        group: 'speed',
        name: 'Late presses',
        technicalName: null,
        compute: (slice) => {
            const presses = pressed(responsesOf(slice.scored))
            return presses.length >= MIN.presses
                ? ratio(presses.filter(({ response }) => response.late).length, presses.length)
                : null
        },
        display: (value) => percent(value),
        meaning: (value) => `${percent(value)} of your presses land after the next stimulus has already appeared.`,
        trend: 'daily',
    },
    {
        id: 'simple-rt',
        group: 'speed',
        name: 'Simple reaction time',
        technicalName: 'simple RT, daily baseline',
        compute: (slice) => (slice.baselines.length >= MIN.baselines ? latestBaseline(slice) : null),
        display: (value) => milliseconds(value),
        meaning: (value) => `In your latest reaction test, you pressed ${absMs(value)} after the square appeared, at the median.`,
        trend: 'daily',
        missing: {
            display: 'No reaction tests yet',
            meaning: 'Take the 30-second reaction test before your first session of the day.',
        },
    },
]

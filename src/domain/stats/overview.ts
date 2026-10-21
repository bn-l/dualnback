import { getHours } from 'date-fns'
import type { Dataset } from '../../data/dataset'
import { SENSES, type Sense } from '../../data/schema'
import type { StatGroup, TrendPoint } from '../analysis-types'
import { dayKey } from '../format'
import { LURE_OFFSETS, lureRate, offsetLabel, plainRate } from './errors'
import { THIRDS, accuracyFromCounts, countsFromEntries, countsOf, dailySlices, hitRts, responsesOf, thirdOf } from './derive'
import { medianOf } from './measures'
import { senseName } from './spec'

// The chart at the top of each stats group: the group's story in one picture. Lines follow
// a value day by day; columns compare a few categories against zero.

export type Unit = 'percent' | 'ms' | 'rating' | 'rounds'

export interface Series {
    // Position and Sound lines are drawn in their own colours; null is the plain ink line.
    sense: Sense | null
    label: string
    points: readonly TrendPoint[]
}

export interface Column {
    label: string
    value: number | null
}

export type Overview =
    | { kind: 'lines'; caption: string; unit: Unit; series: Series[] }
    | { kind: 'columns'; caption: string; unit: Unit; columns: Column[] }

// Fewer days than this and a line says nothing.
const MIN_DAYS = 2
// Each day needs this many timed hits for its median to mean something.
const MIN_DAILY_RTS = 5
const HOURS_PER_BIN = 4
const HOURS_PER_DAY = 24
const NOON = 12
const THIRD_NAMES = ['Start', 'Middle', 'End']

// Each day's value averaged with the days played either side of it, so the line shows the
// drift rather than every good and bad day.
const SMOOTHING_REACH = 2

export const smooth = (points: readonly TrendPoint[]): TrendPoint[] =>
    points.map(({ day }, index) => {
        const window = points.slice(Math.max(0, index - SMOOTHING_REACH), index + SMOOTHING_REACH + 1)
        return { day, value: window.reduce((sum, { value }) => sum + value, 0) / window.length }
    })

const daily = (dataset: Dataset, value: (scored: Dataset['scored']) => number | null): TrendPoint[] =>
    dailySlices(dataset).flatMap(({ day, slice }) => {
        const result = value(slice.scored)
        return result === null || slice.scored.length === 0 ? [] : [{ day, value: result }]
    })

const perSense = (dataset: Dataset, value: (scored: Dataset['scored'], sense: Sense) => number | null): Series[] =>
    SENSES.map((sense) => ({ sense, label: senseName(sense), points: smooth(daily(dataset, (scored) => value(scored, sense))) }))

const enoughDays = (series: readonly Series[]): boolean => series.some(({ points }) => points.length >= MIN_DAYS)

const lines = (caption: string, unit: Unit, series: Series[]): Overview | null =>
    enoughDays(series) ? { kind: 'lines', caption, unit, series } : null

// Columns without enough data are left out, like N−2 at 2-back, which is the current item.
const columns = (caption: string, unit: Unit, list: Column[]): Overview | null => {
    const shown = list.filter(({ value }) => value !== null)
    return shown.length === 0 ? null : { kind: 'columns', caption, unit, columns: shown }
}

// The rating each day finished on.
export const closingRatings = (dataset: Dataset): TrendPoint[] =>
    [...dataset.rounds.reduce((days, round) =>
        round.ratingAfter === null ? days : days.set(dayKey(round.startedAt), round.ratingAfter.rating), new Map<string, number>())]
        .map(([day, value]) => ({ day, value }))

const accuracyByThird = (dataset: Dataset): Column[] => {
    const entries = responsesOf(dataset.scored)
    return THIRD_NAMES.slice(0, THIRDS).map((label, third) => ({
        label,
        value: accuracyFromCounts(countsFromEntries(entries.filter(({ trial, scored }) => thirdOf(trial, scored) === third))),
    }))
}

const hourLabel = (hour: number): string => `${hour % NOON === 0 ? NOON : hour % NOON}${hour < NOON ? 'am' : 'pm'}`

// Rounds started in each four hours of the day, from midnight.
const roundsByTimeOfDay = (dataset: Dataset): Column[] =>
    Array.from({ length: HOURS_PER_DAY / HOURS_PER_BIN }, (_, bin) => ({
        label: hourLabel(bin * HOURS_PER_BIN),
        value: dataset.rounds.length === 0 ? null
            : dataset.rounds.filter(({ startedAt }) => Math.floor(getHours(startedAt) / HOURS_PER_BIN) === bin).length,
    }))

const falseAlarmsByLure = (dataset: Dataset): Column[] => [
    ...LURE_OFFSETS.map((offset) => ({ label: offsetLabel(offset), value: lureRate(dataset.scored, offset)?.rate ?? null })),
    { label: 'Other', value: plainRate(dataset.scored)?.rate ?? null },
]

export const overviewFor = (group: StatGroup, dataset: Dataset): Overview | null => {
    switch (group) {
        case 'accuracy':
            return lines('Accuracy over the days you played, each day averaged with the days either side.', 'percent',
                perSense(dataset, (scored, sense) => accuracyFromCounts(countsOf(scored, sense))))
        case 'speed':
            return lines('Reaction time on the matches you caught, each day averaged with the days either side.', 'ms',
                perSense(dataset, (scored, sense) => {
                    const rts = hitRts(scored, sense)
                    return rts.length >= MIN_DAILY_RTS ? medianOf(rts) : null
                }))
        case 'errors':
            return columns('How often a near repeat fooled you. N−1 is the item from one step too recent; Other repeats nothing nearby.', 'percent',
                falseAlarmsByLure(dataset))
        case 'stamina':
            return columns('Accuracy in each third of a round.', 'percent', accuracyByThird(dataset))
        case 'habits':
            return columns('Rounds started in each four hours of the day.', 'rounds', roundsByTimeOfDay(dataset))
        case 'progress':
            return lines('Your rating at the end of each day you played.', 'rating',
                [{ sense: null, label: 'Rating', points: closingRatings(dataset) }])
    }
}

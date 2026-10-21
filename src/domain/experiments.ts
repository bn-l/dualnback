import { differenceInCalendarDays, parseISO } from 'date-fns'
import { uniformInt } from 'pure-rand/distribution/uniformInt'
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus'
import { mean, sampleVariance } from 'simple-statistics'
import type { Dataset } from '../data/dataset'
import type { ExperimentRecord } from '../data/schema'
import { pointsFromResultDelta } from './rating'

type Condition = 'a' | 'b'

const MIN_ROUNDS_PER_CONDITION = 5
const Z_95 = 1.96
const ROUND_TO = 5
const HALF = 2

export interface ExperimentResult {
    sentence: string
    // Condition A minus condition B, in rating points; null until there's enough data.
    pointsDifference: number | null
    interval: { low: number; high: number } | null
    rounds: Record<Condition, number>
    enoughData: boolean
    // The 95% interval excludes zero.
    clear: boolean
}

// Half the days get each condition (A gets the extra day of an odd length), in an order
// shuffled by the experiment's seed, so both conditions get a mix of weekdays and weekends
// and the schedule is the same every time it's asked for.
const schedule = (experiment: ExperimentRecord): Condition[] => {
    const rng = xoroshiro128plus(experiment.seed)
    const days = Array.from({ length: experiment.days }, (_, index): Condition =>
        index < Math.ceil(experiment.days / HALF) ? 'a' : 'b')
    return days.reduce<Condition[]>((order, _, index) => {
        const swapWith = uniformInt(rng, index, days.length - 1)
        const current = order[index]
        const other = order[swapWith]
        if (current !== undefined && other !== undefined) {
            order[index] = other
            order[swapWith] = current
        }
        return order
    }, [...days])
}

export const conditionFor = (experiment: ExperimentRecord, day: string): Condition | null => {
    const index = differenceInCalendarDays(parseISO(day), parseISO(experiment.startDay))
    return index < 0 || index >= experiment.days ? null : schedule(experiment)[index] ?? null
}

const nearestFive = (points: number): number => Math.max(ROUND_TO, Math.round(Math.abs(points) / ROUND_TO) * ROUND_TO)

const quoted = (label: string): string => `“${label}”`

export const experimentResult = (experiment: ExperimentRecord, dataset: Dataset): ExperimentResult => {
    const sessions = new Map(dataset.sessions.map((session) => [session.id, session]))
    const residualsFor = (condition: Condition): number[] => dataset.scored.flatMap(({ round }) => {
        const assignment = sessions.get(round.sessionId)?.experiment
        return assignment?.experimentId === experiment.id && assignment.condition === condition && round.result !== null
            ? [round.result - round.expected]
            : []
    })
    const a = residualsFor('a')
    const b = residualsFor('b')
    const rounds = { a: a.length, b: b.length }
    const labelA = quoted(experiment.conditionA)
    const labelB = quoted(experiment.conditionB)

    if (a.length < MIN_ROUNDS_PER_CONDITION || b.length < MIN_ROUNDS_PER_CONDITION) {
        return {
            sentence: `Not enough rounds yet: ${a.length} with ${labelA} and ${b.length} with ${labelB}. ` +
                `Each needs at least ${MIN_ROUNDS_PER_CONDITION}.`,
            pointsDifference: null,
            interval: null,
            rounds,
            enoughData: false,
            clear: false,
        }
    }
    const difference = mean(a) - mean(b)
    const standardError = Math.sqrt(sampleVariance(a) / a.length + sampleVariance(b) / b.length)
    const interval = {
        low: pointsFromResultDelta(difference - Z_95 * standardError),
        high: pointsFromResultDelta(difference + Z_95 * standardError),
    }
    const points = pointsFromResultDelta(difference)
    const clear = interval.low > 0 || interval.high < 0
    const [better, worse] = points > 0 ? [labelA, labelB] : [labelB, labelA]
    return {
        sentence: clear
            ? `${better} scored about ${nearestFive(points)} points higher than ${worse}.`
            : `No clear difference between ${labelA} and ${labelB}.`,
        pointsDifference: Math.round(points),
        interval,
        rounds,
        enoughData: true,
        clear,
    }
}

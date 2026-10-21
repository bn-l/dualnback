import type { Sense } from '../../data/schema'
import type { Stat, StatGroup, TrendPoint } from '../analysis-types'
import type { Slice } from './derive'
import { finiteOrNull } from './measures'

export interface StatSpec {
    id: string
    group: StatGroup
    name: string
    technicalName: string | null
    compute: (slice: Slice) => number | null
    // Both get the slice too, for stats whose wording depends on the data (which squares).
    display: (value: number, slice: Slice) => string
    meaning: (value: number, slice: Slice) => string
    // Some stats only mean something across days (rest days, time between sessions).
    trend: 'daily' | 'none'
    // What to show when there isn't enough data; defaults to rounds.
    missing?: { display: string; meaning: string }
}

const NOT_ENOUGH = {
    display: 'Not enough rounds yet',
    meaning: 'This fills in as you play more rounds.',
}

export const toStat = (spec: StatSpec, overall: Slice, days: ReadonlyArray<{ day: string; slice: Slice }>): Stat => {
    const value = finiteOrNull(spec.compute(overall))
    const missing = spec.missing ?? NOT_ENOUGH
    const trend: TrendPoint[] = spec.trend === 'daily'
        ? days.flatMap(({ day, slice }) => {
            const daily = finiteOrNull(spec.compute(slice))
            return daily === null ? [] : [{ day, value: daily }]
        })
        : []
    return {
        id: spec.id,
        group: spec.group,
        name: spec.name,
        technicalName: spec.technicalName,
        value,
        display: value === null ? missing.display : spec.display(value, overall),
        meaning: value === null ? missing.meaning : spec.meaning(value, overall),
        trend,
    }
}

export const senseName = (sense: Sense): string => (sense === 'position' ? 'Position' : 'Sound')

// Shapes shared by the stats and insights modules and the screens that show them.

export type StatGroup = 'accuracy' | 'speed' | 'errors' | 'stamina' | 'habits' | 'progress'

export const STAT_GROUPS: ReadonlyArray<{ id: StatGroup; name: string }> = [
    { id: 'accuracy', name: 'Accuracy' },
    { id: 'speed', name: 'Speed' },
    { id: 'errors', name: 'Errors' },
    { id: 'stamina', name: 'Stamina' },
    { id: 'habits', name: 'Habits' },
    { id: 'progress', name: 'Progress' },
]

export interface TrendPoint {
    // Local calendar day, yyyy-MM-dd.
    day: string
    value: number
}

export interface Stat {
    id: string
    group: StatGroup
    // Plain language first ("slow tail"); the technical name goes underneath.
    name: string
    technicalName: string | null
    value: number | null
    // Ready to show: "412 ms", "83%", "1.9". "Not enough data yet" style text when null.
    display: string
    // One sentence about what the value means for you.
    meaning: string
    trend: TrendPoint[]
}

export type FindingKind = 'helps-hurts' | 'why-you-miss' | 'how-you-play' | 'timing' | 'progress'

export interface Evidence {
    label: string
    value: number
    display: string
}

export interface Finding {
    // Stable across recomputation, so a finding's status can be tracked over time.
    id: string
    kind: FindingKind
    sentence: string
    effectPoints: number | null
    // Bars shown under the sentence; at most four.
    evidence: Evidence[]
    // "From 41 rounds over 3 weeks."
    basis: string
    // Something you could change, which makes it a candidate for a self-experiment.
    controllable: boolean
}

import { addDays, addMinutes } from 'date-fns'
import { uniformFloat64 } from 'pure-rand/distribution/uniformFloat64'
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus'
import { type Dataset, scoreAll } from '../../src/data/dataset'
import type {
    DeviceInfo,
    ExperimentAssignment,
    ExperimentRecord,
    RoundRecord,
    SessionRecord,
} from '../../src/data/schema'
import { LADDER } from '../../src/domain/difficulty'
import type { Factor } from '../../src/domain/factors'

export const DEVICE: DeviceInfo = {
    key: 'laptop',
    userAgent: 'test',
    screenWidth: 1440,
    screenHeight: 900,
    pixelRatio: 2,
    coarsePointer: false,
    colorScheme: 'light',
    orientation: 'landscape',
}

const STEP = LADDER[8] ?? LADDER[0]
if (STEP === undefined) {
    throw new Error('ladder is empty')
}

export const PHONE: DeviceInfo = {
    key: 'phone',
    userAgent: 'test',
    screenWidth: 390,
    screenHeight: 844,
    pixelRatio: 3,
    coarsePointer: true,
    colorScheme: 'light',
    orientation: 'portrait',
}

export const session = (overrides: Partial<SessionRecord> & Pick<SessionRecord, 'id' | 'startedAt'>): SessionRecord => ({
    appOpenedAt: overrides.startedAt,
    perfAnchor: 0,
    endedAt: null,
    timeZone: 'Australia/Sydney',
    utcOffsetMinutes: 660,
    device: DEVICE,
    appVersion: 'test',
    experiment: null,
    forecast: null,
    note: null,
    ...overrides,
})

export const round = (
    overrides: Partial<RoundRecord> & Pick<RoundRecord, 'id' | 'sessionId' | 'startedAt' | 'index'>,
): RoundRecord => ({
    stretch: false,
    step: STEP,
    trialCount: 23,
    seed: 1,
    generatorVersion: 1,
    appVersion: 'test',
    perfStart: 0,
    perfEnd: 0,
    completed: true,
    quitAtTrial: null,
    breakBeforeMs: overrides.index === 0 ? null : 20_000,
    refreshHz: 60,
    audio: { sampleRate: 44100, baseLatency: 0, outputLatency: 0 },
    ratingBefore: { rating: 1400, rd: 60, vol: 0.06 },
    ratingAfter: { rating: 1400, rd: 60, vol: 0.06 },
    expected: 0.5,
    accuracy: 0.75,
    result: 0.5,
    ...overrides,
})

export const datasetOf = (parts: {
    sessions: SessionRecord[]
    rounds: RoundRecord[]
    experiments?: ExperimentRecord[]
}): Dataset => ({
    sessions: parts.sessions,
    rounds: parts.rounds,
    trials: [],
    presses: [],
    focusEvents: [],
    screenViews: [],
    baselines: [],
    experiments: parts.experiments ?? [],
    scored: scoreAll(parts.rounds, [], []),
})

export const EMPTY: Dataset = datasetOf({ sessions: [], rounds: [] })

// Roughly normal noise: the sum of three uniforms, scaled to ±scale at the extremes.
export const noiseSource = (seed: number): ((scale: number) => number) => {
    const rng = xoroshiro128plus(seed)
    return (scale) => ((uniformFloat64(rng) + uniformFloat64(rng) + uniformFloat64(rng)) / 3 - 0.5) * 2 * scale
}

export const coinSource = (seed: number): (() => boolean) => {
    const rng = xoroshiro128plus(seed)
    return () => uniformFloat64(rng) < 0.5
}

export interface DayPlan {
    hour: number
    device?: DeviceInfo
    experiment?: ExperimentAssignment | null
}

export interface SimulatedRound {
    day: number
    roundIndex: number
    plan: DayPlan
}

// One session a day, `roundsPerSession` rounds two minutes apart. Each round's result is
// 0.5 (a draw) plus the planted effect plus noise, and the rating climbs by `ratingPerDay`.
export const simulate = (options: {
    days: number
    roundsPerSession: number
    start?: Date
    plan: (day: number) => DayPlan
    effect: (round: SimulatedRound) => number
    seed?: number
    noise?: number
    ratingPerDay?: number
    experiments?: ExperimentRecord[]
}): Dataset => {
    const start = options.start ?? new Date(2026, 0, 5)
    const noise = noiseSource(options.seed ?? 7)
    const plans = Array.from({ length: options.days }, (_, day) => options.plan(day))
    const sessions = plans.map((plan, day) => {
        const startedAt = addMinutes(addDays(start, day), plan.hour * 60).getTime()
        return session({ id: `s${day}`, startedAt, device: plan.device ?? DEVICE, experiment: plan.experiment ?? null })
    })
    const rounds = plans.flatMap((plan, day) => Array.from({ length: options.roundsPerSession }, (_, roundIndex) => {
        const startedAt = (sessions[day]?.startedAt ?? 0) + roundIndex * 120_000
        const rating = 1400 + day * (options.ratingPerDay ?? 0)
        const result = Math.max(0, Math.min(1,
            0.5 + options.effect({ day, roundIndex, plan }) + noise(options.noise ?? 0.15)))
        return round({
            id: `s${day}r${roundIndex}`,
            sessionId: `s${day}`,
            startedAt,
            index: roundIndex,
            result,
            ratingBefore: { rating, rd: 60, vol: 0.06 },
            ratingAfter: { rating, rd: 60, vol: 0.06 },
        })
    }))
    return datasetOf({ sessions, rounds, experiments: options.experiments })
}

export const factor = (id: string, type: Factor['type'] = 'binary', question: string | null = null): Factor => ({
    id,
    label: id,
    comparison: `not ${id}`,
    short: id,
    controllable: true,
    kind: 'helps-hurts',
    type,
    question,
    reportable: true,
})

export const allFinite = (values: readonly number[]): boolean => values.every(Number.isFinite)

import { addDays, addMinutes } from 'date-fns'
import { uniformFloat64 } from 'pure-rand/distribution/uniformFloat64'
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus'
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator'
import type { Dataset } from '../../src/data/dataset'
import { scoreAll } from '../../src/data/dataset'
import type {
    BaselineRecord,
    InputType,
    PressRecord,
    RatingState,
    RoundRecord,
    ScreenViewRecord,
    Sense,
    SessionRecord,
    TrialFlags,
    TrialRecord,
} from '../../src/data/schema'
import { SENSES } from '../../src/data/schema'
import { LADDER } from '../../src/domain/difficulty'
import { INITIAL_RATING, expectedResult, rateRound, resultFromAccuracy } from '../../src/domain/rating'
import { scoreRound } from '../../src/domain/scoring'
import { type PlannedTrial, GENERATOR_VERSION, generateRound } from '../../src/domain/sequence'

// Builds realistic datasets for the stats tests: trials come from the real generator, and
// presses from a behaviour function deciding, per trial and sense, whether and how to press.

export const BASE = new Date(2026, 0, 5, 9, 0, 0)

export interface Decision {
    press: boolean
    rt?: number
    hold?: number
    input?: InputType
    offset?: { x: number; y: number }
}

export interface BehaviourContext {
    trial: PlannedTrial
    sense: Sense
    n: number
    previousError: boolean
    roundNumber: number
    rng: RandomGenerator
}

export type Behaviour = (context: BehaviourContext) => Decision

export interface RoundOptions {
    behaviour: Behaviour
    day?: number
    minute?: number
    sessionId?: string
    index?: number
    seed?: number
    stepIndex?: number
    completed?: boolean
    quitAtTrial?: number
    flags?: Partial<TrialFlags>
    breakBeforeMs?: number | null
}

export interface Extras {
    baselines?: BaselineRecord[]
    screenViews?: ScreenViewRecord[]
}

const NO_FLAGS: TrialFlags = { hidden: false, blurred: false, droppedFrames: false, audioGlitch: false, earlyPress: false }

export const random = (rng: RandomGenerator): number => uniformFloat64(rng)

// Behaviours ----------------------------------------------------------------------------

export const perfect: Behaviour = ({ trial, sense, rng }) => ({
    press: sense === 'position' ? trial.positionMatch : trial.soundMatch,
    rt: 400 + random(rng) * 200,
    hold: 120,
})

export const silent: Behaviour = () => ({ press: false })

// Catches most matches, false-alarms now and then, with a right-skewed RT distribution.
export const noisy = (hitRate = 0.8, falseAlarmRate = 0.1): Behaviour => ({ trial, sense, rng }) => {
    const match = sense === 'position' ? trial.positionMatch : trial.soundMatch
    const roll = random(rng)
    const tail = -Math.log(1 - random(rng) * 0.999) * 150
    return {
        press: match ? roll < hitRate : roll < falseAlarmRate,
        rt: 350 + random(rng) * 100 + tail,
        hold: 100 + random(rng) * 60,
    }
}

// Errors arrive in bursts: once an error happens, the next trial is likely wrong too.
export const bursty: Behaviour = (context) => {
    const { trial, sense, previousError, rng } = context
    const match = sense === 'position' ? trial.positionMatch : trial.soundMatch
    const lapse = previousError ? random(rng) < 0.85 : random(rng) < 0.04
    return { press: lapse ? !match : match, rt: 450 + random(rng) * 100, hold: 120 }
}

// Builder -------------------------------------------------------------------------------

interface Built {
    round: RoundRecord
    trials: TrialRecord[]
    presses: PressRecord[]
}

const roundStart = (options: RoundOptions): Date =>
    addMinutes(addDays(BASE, options.day ?? 0), options.minute ?? 0)

const buildRound = (options: RoundOptions, context: { roundNumber: number; rating: RatingState }): Built => {
    const step = LADDER[options.stepIndex ?? 4] ?? LADDER[0]
    if (step === undefined) {
        throw new Error('Ladder is empty')
    }
    const seed = options.seed ?? 1000 + context.roundNumber
    const planned = generateRound(step, seed)
    const rng = xoroshiro128plus(seed + 7)
    const sessionId = options.sessionId ?? `session-${options.day ?? 0}`
    const id = `round-${context.roundNumber}`
    const perfStart = 1000 + context.roundNumber * 200_000
    const lastTrial = options.completed === false ? (options.quitAtTrial ?? 5) : planned.length
    const kept = planned.slice(0, lastTrial)

    const decided = kept.reduce<{ trials: TrialRecord[]; presses: PressRecord[]; previousError: boolean }>(
        (state, trial) => {
            const onset = perfStart + trial.index * step.intervalMs
            const decisions = SENSES.map((sense) => ({
                sense,
                decision: options.behaviour({
                    trial, sense, n: step.n, previousError: state.previousError, roundNumber: context.roundNumber, rng,
                }),
            }))
            const presses = decisions.flatMap(({ sense, decision }, offset): PressRecord[] => {
                if (!decision.press) {
                    return []
                }
                const downAt = onset + (decision.rt ?? 450)
                return [{
                    id: `${id}:${trial.index}:${offset}`,
                    roundId: id,
                    sessionId,
                    seq: trial.index * 2 + offset,
                    sense,
                    input: decision.input ?? 'keyboard',
                    key: sense === 'position' ? 'KeyA' : 'KeyL',
                    repeat: false,
                    downAt,
                    upAt: downAt + (decision.hold ?? 110),
                    offsetX: decision.offset?.x ?? null,
                    offsetY: decision.offset?.y ?? null,
                    contactWidth: null,
                    contactHeight: null,
                    pressure: null,
                }]
            })
            const error = decisions.some(({ sense, decision }) =>
                decision.press !== (sense === 'position' ? trial.positionMatch : trial.soundMatch))
            const record: TrialRecord = {
                id: `${id}:${trial.index}`,
                roundId: id,
                sessionId,
                index: trial.index,
                position: trial.position,
                sound: trial.sound,
                positionMatch: trial.positionMatch,
                soundMatch: trial.soundMatch,
                positionLags: trial.positionLags,
                soundLags: trial.soundLags,
                gridDistance: trial.gridDistance,
                soundAlike: trial.soundAlike,
                scheduledOnset: onset,
                visualOnset: onset,
                audioOnset: onset,
                droppedFrames: 0,
                flags: { ...NO_FLAGS, ...options.flags },
            }
            return { trials: [...state.trials, record], presses: [...state.presses, ...presses], previousError: error }
        }, { trials: [], presses: [], previousError: false })

    const startedAt = roundStart(options).getTime()
    const completed = options.completed !== false
    const expected = expectedResult(context.rating, step.rating)
    const draft: RoundRecord = {
        id,
        sessionId,
        index: options.index ?? 0,
        stretch: false,
        step,
        trialCount: planned.length,
        seed,
        generatorVersion: GENERATOR_VERSION,
        appVersion: 'test',
        startedAt,
        perfStart,
        perfEnd: perfStart + kept.length * step.intervalMs,
        completed,
        quitAtTrial: completed ? null : lastTrial,
        breakBeforeMs: options.breakBeforeMs ?? null,
        refreshHz: 60,
        audio: { sampleRate: 44100, baseLatency: 0.01, outputLatency: 0.02 },
        ratingBefore: context.rating,
        ratingAfter: null,
        expected,
        accuracy: null,
        result: null,
    }
    if (!completed) {
        return { round: draft, trials: decided.trials, presses: decided.presses }
    }
    const accuracy = scoreRound(draft, decided.trials, decided.presses).accuracy
    const result = resultFromAccuracy(accuracy)
    return {
        round: { ...draft, accuracy, result, ratingAfter: rateRound(context.rating, step, result) },
        trials: decided.trials,
        presses: decided.presses,
    }
}

export const buildDataset = (rounds: readonly RoundOptions[], extras: Extras = {}): Dataset => {
    const ordered = [...rounds].sort((a, b) => roundStart(a).getTime() - roundStart(b).getTime())
    const built = ordered.reduce<{ items: Built[]; rating: RatingState }>((state, options) => {
        const item = buildRound(options, { roundNumber: state.items.length, rating: state.rating })
        return { items: [...state.items, item], rating: item.round.ratingAfter ?? state.rating }
    }, { items: [], rating: INITIAL_RATING })

    const roundRecords = built.items.map(({ round }) => round)
    const trials = built.items.flatMap((item) => item.trials)
    const presses = built.items.flatMap((item) => item.presses)
    const sessionIds = [...new Set(roundRecords.map(({ sessionId }) => sessionId))]
    const sessions: SessionRecord[] = sessionIds.map((sessionId) => {
        const first = roundRecords.filter((round) => round.sessionId === sessionId)
            .sort((a, b) => a.startedAt - b.startedAt)[0]
        const startedAt = (first?.startedAt ?? BASE.getTime()) - 60_000
        return {
            id: sessionId,
            appOpenedAt: startedAt - 10_000,
            startedAt,
            perfAnchor: 0,
            endedAt: null,
            timeZone: 'Australia/Sydney',
            utcOffsetMinutes: 660,
            device: {
                key: 'test-device',
                userAgent: 'test',
                screenWidth: 1280,
                screenHeight: 800,
                pixelRatio: 2,
                coarsePointer: false,
                colorScheme: 'light',
                orientation: 'landscape',
            },
            appVersion: 'test',
            experiment: null,
            forecast: null,
            note: null,
        }
    })
    return {
        sessions,
        rounds: roundRecords,
        trials,
        presses,
        focusEvents: [],
        screenViews: extras.screenViews ?? [],
        baselines: extras.baselines ?? [],
        experiments: [],
        scored: scoreAll(roundRecords, trials, presses),
    }
}

// Rounds spread over consecutive days, a few per session.
export const manyRounds = (count: number, behaviour: Behaviour, perSession = 3): RoundOptions[] =>
    Array.from({ length: count }, (_, number) => ({
        behaviour,
        day: Math.floor(number / perSession),
        minute: (number % perSession) * 3,
        index: number % perSession,
        seed: 5000 + number,
        breakBeforeMs: number % perSession === 0 ? null : 40_000,
    }))

export const emptyDataset = (): Dataset => buildDataset([])

// Every numeric value anywhere in a stat list, for NaN / Infinity checks.
export const allNumbers = (values: ReadonlyArray<{ value: number | null; trend: ReadonlyArray<{ value: number }> }>): number[] =>
    values.flatMap((stat) => [...(stat.value === null ? [] : [stat.value]), ...stat.trend.map(({ value }) => value)])

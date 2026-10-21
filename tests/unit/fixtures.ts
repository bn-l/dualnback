import type { PressRecord, RoundRecord, Sense, TrialRecord } from '../../src/data/schema'
import { stepForRating } from '../../src/domain/difficulty'
import { INITIAL_RATING } from '../../src/domain/rating'
import type { PlannedTrial } from '../../src/domain/sequence'

export const INTERVAL = 3000

export const makeRound = (overrides: Partial<RoundRecord> = {}): RoundRecord => ({
    id: 'round-1',
    sessionId: 'session-1',
    index: 0,
    stretch: false,
    step: stepForRating(1200),
    trialCount: 22,
    seed: 1,
    generatorVersion: 1,
    appVersion: 'test',
    startedAt: Date.UTC(2026, 9, 1, 9),
    perfStart: 0,
    perfEnd: 66000,
    completed: true,
    quitAtTrial: null,
    breakBeforeMs: null,
    refreshHz: 60,
    audio: { sampleRate: 44100, baseLatency: 0.01, outputLatency: 0.02 },
    ratingBefore: INITIAL_RATING,
    ratingAfter: INITIAL_RATING,
    expected: 0.5,
    accuracy: 1,
    result: 1,
    ...overrides,
})

export const makeTrial = (planned: Pick<PlannedTrial, 'index' | 'positionMatch' | 'soundMatch'>, overrides: Partial<TrialRecord> = {}): TrialRecord => ({
    id: `round-1:${planned.index}`,
    roundId: 'round-1',
    sessionId: 'session-1',
    index: planned.index,
    position: 0,
    sound: 0,
    positionMatch: planned.positionMatch,
    soundMatch: planned.soundMatch,
    positionLags: [],
    soundLags: [],
    gridDistance: null,
    soundAlike: null,
    scheduledOnset: planned.index * INTERVAL,
    visualOnset: planned.index * INTERVAL,
    audioOnset: planned.index * INTERVAL,
    droppedFrames: 0,
    flags: { hidden: false, blurred: false, droppedFrames: false, audioGlitch: false, earlyPress: false },
    ...overrides,
})

let pressSeq = 0

export const makePress = (sense: Sense | null, downAt: number, overrides: Partial<PressRecord> = {}): PressRecord => {
    pressSeq += 1
    return {
        id: `round-1:p${pressSeq}`,
        roundId: 'round-1',
        sessionId: 'session-1',
        seq: pressSeq,
        sense,
        input: 'keyboard',
        key: sense === 'position' ? 'KeyA' : sense === 'sound' ? 'KeyL' : 'KeyX',
        repeat: false,
        downAt,
        upAt: downAt + 90,
        offsetX: null,
        offsetY: null,
        contactWidth: null,
        contactHeight: null,
        pressure: null,
        ...overrides,
    }
}

// Runs inside the browser (imported through the dev server) to fill IndexedDB with weeks
// of realistic play, built with the app's own generator, scoring and rating code. Evening
// sessions are planted to be worse, so the insights have something real to find.
import { startOfDay } from 'date-fns'
import { uniformFloat64 } from 'pure-rand/distribution/uniformFloat64'
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus'
import { store } from '../../src/app/state'
import type {
    BaselineRecord,
    PressRecord,
    RoundRecord,
    ScreenViewRecord,
    SessionRecord,
    TrialRecord,
} from '../../src/data/schema'
import { SENSES } from '../../src/data/schema'
import { stepForRating, stretchStep } from '../../src/domain/difficulty'
import { INITIAL_RATING, expectedResult, rateRound, resultFromAccuracy } from '../../src/domain/rating'
import { scoreRound } from '../../src/domain/scoring'
import { GENERATOR_VERSION, generateRound, trialCountFor } from '../../src/domain/sequence'

const DAY = 86_400_000
const HOUR = 3_600_000

export interface SeedOptions {
    sessions: number
    seed: number
    // How many rating points of true skill an evening session costs.
    eveningCost: number
}

// The simulated player has a true skill that improves a little each day, plus day-to-day
// form. Against a step, they aim for the accuracy Glicko-2 would expect at that skill, so
// the only systematic effect in the data is the planted one.
const START_SKILL = 1300
const SKILL_PER_DAY = 3
const FORM_SD = 30
const FALSE_ALARM_RATE = 0.03
const NON_MATCH_SHARE = 16 / 6

const normal = (random: () => number): number =>
    Math.sqrt(-2 * Math.log(Math.max(1e-12, random()))) * Math.cos(2 * Math.PI * random())

const hitChanceFor = (skill: number, stepRating: number): number => {
    const expected = expectedResult({ rating: skill, rd: 50, vol: 0.06 }, stepRating)
    const accuracy = (expected + 1) / 2
    return Math.max(0.05, Math.min(0.99, accuracy * (1 + NON_MATCH_SHARE * FALSE_ALARM_RATE)))
}

export const seed = async ({ sessions, seed: seedValue, eveningCost }: SeedOptions): Promise<{ rounds: number; evenings: number }> => {
    const rng = xoroshiro128plus(seedValue)
    const random = (): number => uniformFloat64(rng)
    const now = Date.now()
    const records: {
        sessions: SessionRecord[]
        rounds: RoundRecord[]
        trials: TrialRecord[]
        presses: PressRecord[]
        baselines: BaselineRecord[]
        screenViews: ScreenViewRecord[]
    } = { sessions: [], rounds: [], trials: [], presses: [], baselines: [], screenViews: [] }
    let rating = INITIAL_RATING
    let eveningSessions = 0

    for (let day = 0; day < sessions; day += 1) {
        const sessionId = `seed-session-${day}`
        // Every seeded session is before today; 40% of them are in the evening.
        const evening = random() < 0.4
        eveningSessions += evening ? 1 : 0
        const hour = evening ? 19 + Math.floor(random() * 3) : 8 + Math.floor(random() * 8)
        const startedAt = startOfDay(now).getTime() - (sessions - day) * DAY + hour * HOUR
        const skill = START_SKILL + day * SKILL_PER_DAY + normal(random) * FORM_SD - (evening ? eveningCost : 0)
        records.sessions.push({
            id: sessionId,
            appOpenedAt: startedAt - 20_000,
            startedAt,
            perfAnchor: 0,
            endedAt: startedAt + 8 * 60_000,
            timeZone: 'Australia/Sydney',
            utcOffsetMinutes: 660,
            device: {
                key: 'mac-pointer-1512x982',
                userAgent: 'seed',
                screenWidth: 1512,
                screenHeight: 982,
                pixelRatio: 2,
                coarsePointer: false,
                colorScheme: 'light',
                orientation: 'landscape',
            },
            appVersion: 'seed',
            experiment: null,
            forecast: { rating: rating.rating, reason: null },
            note: null,
        })
        records.baselines.push({
            id: `seed-baseline-${day}`,
            at: startedAt - 60_000,
            deviceKey: 'mac-pointer-1512x982',
            reactionTimes: Array.from({ length: 12 }, () => 240 + random() * 80 + (evening ? 25 : 0)),
            misses: 0,
            anticipations: 0,
            medianRt: 270 + (evening ? 25 : 0) + random() * 10,
        })

        for (let index = 0; index < 5; index += 1) {
            const base = stepForRating(rating.rating)
            const step = index === 4 ? stretchStep(base) : base
            const roundSeed = Math.floor(random() * 2 ** 31)
            const planned = generateRound(step, roundSeed)
            const roundId = `${sessionId}-round-${index}`
            const roundStart = startedAt + index * 90_000
            const perfStart = index * 90_000
            const hitChance = hitChanceFor(skill, step.rating)
            const trials: TrialRecord[] = planned.map((trial) => {
                const onset = perfStart + 1000 + trial.index * step.intervalMs
                return {
                    id: `${roundId}:${trial.index}`,
                    roundId,
                    sessionId,
                    ...trial,
                    scheduledOnset: onset,
                    visualOnset: onset - 4,
                    audioOnset: onset + 3,
                    droppedFrames: 0,
                    flags: { hidden: false, blurred: false, droppedFrames: false, audioGlitch: false, earlyPress: false },
                }
            })
            const presses: PressRecord[] = trials.flatMap((trial) => SENSES.flatMap((sense): PressRecord[] => {
                const match = sense === 'position' ? trial.positionMatch : trial.soundMatch
                const lure = (sense === 'position' ? trial.positionLags : trial.soundLags).length > 0
                const press = match ? random() < hitChance : random() < (lure ? 2 * FALSE_ALARM_RATE : FALSE_ALARM_RATE)
                if (!press) {
                    return []
                }
                const downAt = (trial.visualOnset ?? trial.scheduledOnset) + 380 + random() * random() * 900 + (evening ? 60 : 0)
                return [{
                    id: `${roundId}:p${trial.index}-${sense}`,
                    roundId,
                    sessionId,
                    seq: trial.index * 2 + (sense === 'position' ? 0 : 1),
                    sense,
                    input: 'keyboard',
                    key: sense === 'position' ? 'KeyA' : 'KeyL',
                    repeat: false,
                    downAt,
                    upAt: downAt + 70 + random() * 60 + (match ? 0 : 35),
                    offsetX: null,
                    offsetY: null,
                    contactWidth: null,
                    contactHeight: null,
                    pressure: null,
                }]
            }))
            const draft: RoundRecord = {
                id: roundId,
                sessionId,
                index,
                stretch: index === 4,
                step,
                trialCount: trialCountFor(step.n),
                seed: roundSeed,
                generatorVersion: GENERATOR_VERSION,
                appVersion: 'seed',
                startedAt: roundStart,
                perfStart,
                perfEnd: perfStart + 1000 + planned.length * step.intervalMs,
                completed: true,
                quitAtTrial: null,
                breakBeforeMs: index === 0 ? null : 15_000 + random() * 40_000,
                refreshHz: 60,
                audio: { sampleRate: 48000, baseLatency: 0.005, outputLatency: 0.02 },
                ratingBefore: rating,
                ratingAfter: null,
                expected: expectedResult(rating, step.rating),
                accuracy: null,
                result: null,
            }
            const accuracy = scoreRound(draft, trials, presses).accuracy
            const result = resultFromAccuracy(accuracy)
            const ratingAfter = rateRound(rating, step, result)
            records.rounds.push({
                ...draft,
                accuracy,
                result,
                ratingAfter,
            })
            records.trials.push(...trials)
            records.presses.push(...presses)
            records.screenViews.push({ id: `${roundId}-view`, sessionId, screen: 'results', enteredAt: roundStart + 70_000, leftAt: roundStart + 75_000 })
            rating = ratingAfter
        }
    }

    await store.transaction('rw', [store.sessions, store.rounds, store.trials, store.presses, store.baselines, store.screenViews, store.settings], async () => {
        await store.sessions.bulkPut(records.sessions)
        await store.rounds.bulkPut(records.rounds)
        await store.trials.bulkPut(records.trials)
        await store.presses.bulkPut(records.presses)
        await store.baselines.bulkPut(records.baselines)
        await store.screenViews.bulkPut(records.screenViews)
        await store.settings.put({
            key: 'settings',
            dailyBaseline: true,
            soundOn: true,
            rating,
            ratingUpdatedAt: now - DAY,
        })
    })
    return { rounds: records.rounds.length, evenings: eveningSessions }
}

import { createEffect, createRoot, on, untrack } from 'solid-js'
import { differenceInCalendarDays } from 'date-fns'
import { median } from 'simple-statistics'
import { loadDataset } from '../data/dataset'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../data/db'
import type {
    DifficultyStep,
    ExperimentAssignment,
    ExperimentRecord,
    Forecast,
    RatingState,
    RoundRecord,
    ScreenViewRecord,
    Sense,
    SessionRecord,
} from '../data/schema'
import { stepForRating, stretchStep } from '../domain/difficulty'
import { conditionFor } from '../domain/experiments'
import { modelFindings, updateLifecycle } from '../domain/findings'
import { forecastSession } from '../domain/forecast'
import { dayKey } from '../domain/format'
import { afterIdleDays, expectedResult, rateRound, resultFromAccuracy } from '../domain/rating'
import { scoreRound } from '../domain/scoring'
import { GENERATOR_VERSION, generateRound, trialCountFor } from '../domain/sequence'
import { statFindings } from '../domain/stats'
import { LETTERS } from '../domain/letters'
import { audioInfo, createLetterBank, resumeAudio, scheduleLetter, setSoundOn } from '../engine/audio'
import type { BaselineCapture } from '../engine/baseline'
import { deviceInfo } from '../engine/device'
import { buildFocusRecords, buildPressRecords, buildTrialRecords } from '../engine/records'
import { type RoundCapture, type RunningRound, runRound } from '../engine/round-runner'
import { log } from '../log'
import {
    APP_OPENED_AT,
    type Screen,
    dataset,
    findingRecords,
    go,
    letterBank,
    screen,
    session,
    setDataset,
    setFindingRecords,
    setLetterBank,
    setProblem,
    setSession,
    setSettings,
    settings,
    store,
} from './state'

export const ROUNDS_PER_SESSION = 5
export const APP_VERSION = '1.0.0'

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)

const report = (scope: string, what: string) => (error: unknown): void => {
    log.error(scope, what, error)
    setProblem(`${what}: ${errorText(error)}`)
}

// ---------- startup ----------

export const loadApp = async (): Promise<void> => {
    const [loadedSettings, loadedDataset, loadedFindings] = await Promise.all([
        loadSettings(store),
        loadDataset(store),
        store.findings.toArray(),
    ])
    setSettings(loadedSettings)
    setDataset(loadedDataset)
    setFindingRecords(loadedFindings)
    log.info('app', 'loaded', { rounds: loadedDataset.rounds.length, sessions: loadedDataset.sessions.length })
    createLetterBank()
        .then((bank) => {
            setLetterBank(bank)
        })
        .catch(report('audio', 'The letter sounds could not load'))
}

// Time spent on each screen, for the habits stats.
const views: { current: ScreenViewRecord | null } = { current: null }

const recordView = (name: string): void => {
    const now = Date.now()
    const previous = views.current
    if (previous !== null) {
        void store.screenViews.put({ ...previous, leftAt: now }).catch(report('views', 'Could not save screen time'))
    }
    const next: ScreenViewRecord = {
        id: crypto.randomUUID(),
        sessionId: untrack(session)?.record.id ?? null,
        screen: name,
        enteredAt: now,
        leftAt: null,
    }
    views.current = next
    void store.screenViews.put(next).catch(report('views', 'Could not save screen time'))
}

export const trackScreenViews = (): (() => void) => createRoot((dispose) => {
    createEffect(on(screen, ({ name }) => recordView(name)))
    return dispose
})

// ---------- session start ----------

const today = (): string => dayKey(Date.now())

export const playedToday = (): boolean =>
    (dataset()?.sessions ?? []).some((record) => dayKey(record.startedAt) === today())

const needsBaseline = (): boolean => {
    const key = deviceInfo().key
    return settings().dailyBaseline &&
        !(dataset()?.baselines ?? []).some((baseline) => baseline.deviceKey === key && dayKey(baseline.at) === today())
}

export const activeExperiment = (): ExperimentRecord | null =>
    (dataset()?.experiments ?? []).find((experiment) =>
        experiment.stoppedAt === null && conditionFor(experiment, today()) !== null) ?? null

export const todaysAssignment = (): ExperimentAssignment | null => {
    const experiment = activeExperiment()
    const condition = experiment === null ? null : conditionFor(experiment, today())
    return experiment === null || condition === null ? null : { experimentId: experiment.id, condition }
}

export interface SessionStart {
    idleDays: number
    rating: RatingState
    forecast: Forecast | null
}

// What a session started now begins with: the rating after any days off, and today's
// forecast. The round intro shows it before the session exists.
export const sessionStart = (now = Date.now()): SessionStart => {
    const current = settings()
    const idleDays = current.ratingUpdatedAt === null
        ? 0
        : Math.max(0, differenceInCalendarDays(now, current.ratingUpdatedAt) - 1)
    const rating = afterIdleDays(current.rating, idleDays)
    const data = dataset()
    return { idleDays, rating, forecast: data === null ? null : forecastSession({ dataset: data, rating, now: new Date(now) }) }
}

const createSession = async (): Promise<void> => {
    const now = Date.now()
    const { idleDays, rating, forecast } = sessionStart(now)
    setSettings(await saveSettings(store, { rating, ratingUpdatedAt: now }))
    const data = dataset()
    const record: SessionRecord = {
        id: crypto.randomUUID(),
        appOpenedAt: APP_OPENED_AT,
        startedAt: now,
        perfAnchor: performance.now(),
        endedAt: null,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        utcOffsetMinutes: -new Date(now).getTimezoneOffset(),
        device: deviceInfo(),
        appVersion: APP_VERSION,
        experiment: todaysAssignment(),
        forecast,
        note: null,
    }
    await store.sessions.put(record)
    if (data !== null) {
        setDataset({ ...data, sessions: [...data.sessions, record] })
    }
    setSession({ record, rounds: [], lastScored: null, lastRoundEndedAt: null })
    log.info('session', 'started', { idleDays, rating: rating.rating, forecast: record.forecast })
}

export const beginSession = async (): Promise<void> => {
    const bank = letterBank()
    if (bank === null) {
        setProblem('The letter sounds are still loading. Try again in a moment.')
        return
    }
    // Starting audio has to happen inside the tap or key press that starts the session.
    await resumeAudio(bank)
    go({ name: needsBaseline() ? 'baseline' : 'ready' })
}

// The session itself starts with its first round, so leaving from the round intro leaves
// nothing behind.
export const startFirstRound = async (): Promise<void> => {
    if (session() === null) {
        await createSession()
    }
    go({ name: 'play' })
}

export const finishBaseline = async (capture: BaselineCapture | null): Promise<void> => {
    if (capture !== null) {
        const record = {
            id: crypto.randomUUID(),
            at: Date.now(),
            deviceKey: deviceInfo().key,
            reactionTimes: capture.reactionTimes,
            misses: capture.misses,
            anticipations: capture.anticipations,
            medianRt: capture.reactionTimes.length === 0 ? null : median(capture.reactionTimes),
        }
        await store.baselines.put(record)
        const data = dataset()
        if (data !== null) {
            setDataset({ ...data, baselines: [...data.baselines, record] })
        }
    }
    go({ name: 'ready' })
}

// ---------- how to play ----------

// Opened by a tap or key press, which is what lets the letters play.
export const openHowToPlay = async (back: Screen): Promise<void> => {
    const bank = letterBank()
    if (bank !== null) {
        await resumeAudio(bank)
    }
    go({ name: 'how-to-play', back })
}

// One letter, now, as a round would play it (and not at all with the sound off).
export const sayLetter = (letter: string): void => {
    const bank = letterBank()
    const index = LETTERS.indexOf(letter)
    if (bank === null || index < 0) {
        log.warn('how to play', 'letter not played', { letter, loaded: bank !== null })
        return
    }
    setSoundOn(bank, settings().soundOn)
    scheduleLetter(bank, index, bank.context.currentTime)
}

// ---------- rounds ----------

export interface RoundElements {
    cells: readonly HTMLElement[]
    buttons: Record<Sense, HTMLElement>
    // The keys of the play screen's own buttons (pause, sound, settings).
    controlKeys: readonly string[]
    onTrial: (index: number) => void
}

const randomSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now()

export const nextStep = (): { step: DifficultyStep; stretch: boolean } => {
    const index = session()?.rounds.length ?? 0
    const base = stepForRating(settings().rating.rating)
    const stretch = index === ROUNDS_PER_SESSION - 1
    return { step: stretch ? stretchStep(base) : base, stretch }
}

interface RoundPlan {
    round: Omit<RoundRecord, 'perfEnd' | 'completed' | 'quitAtTrial' | 'refreshHz' | 'accuracy' | 'result' | 'ratingAfter'>
    planned: ReturnType<typeof generateRound>
}

const saveRound = async (plan: RoundPlan, capture: RoundCapture): Promise<void> => {
    const { round: draft, planned } = plan
    const ids = { roundId: draft.id, sessionId: draft.sessionId }
    const trials = buildTrialRecords({
        ...ids,
        planned,
        timings: capture.timings,
        presses: capture.presses,
        focusEvents: capture.focusEvents,
        perfEnd: capture.perfEnd,
        lastTrial: capture.trialsRun - 1,
    })
    const presses = buildPressRecords(ids, capture.presses)
    const focusEvents = buildFocusRecords(draft.id, capture.focusEvents)
    const unscored: RoundRecord = {
        ...draft,
        perfEnd: capture.perfEnd,
        completed: capture.completed,
        quitAtTrial: capture.quitAtTrial,
        refreshHz: capture.refreshHz,
        accuracy: null,
        result: null,
        ratingAfter: null,
    }
    const accuracy = capture.completed ? scoreRound(unscored, trials, presses).accuracy : null
    // With the letters off, the Sound half can't be played, so the round isn't rated.
    const muted = trials.some(({ flags }) => flags.muted === true)
    const result = accuracy === null || muted ? null : resultFromAccuracy(accuracy)
    const ratingAfter = result === null ? null : rateRound(draft.ratingBefore, draft.step, result)
    const round: RoundRecord = { ...unscored, accuracy, result, ratingAfter }
    const now = Date.now()

    await store.transaction('rw', [store.rounds, store.trials, store.presses, store.focusEvents, store.settings], async () => {
        await store.rounds.put(round)
        await store.trials.bulkPut(trials)
        await store.presses.bulkPut(presses)
        await store.focusEvents.bulkPut(focusEvents)
        if (ratingAfter !== null) {
            setSettings(await saveSettings(store, { rating: ratingAfter, ratingUpdatedAt: now }))
        }
    })

    // As in scoreAll: only rated rounds count toward the stats.
    const scored = round.completed && round.result !== null ? scoreRound(round, trials, presses) : null
    const data = dataset()
    if (data !== null) {
        setDataset({
            ...data,
            rounds: [...data.rounds, round],
            trials: [...data.trials, ...trials],
            presses: [...data.presses, ...presses],
            focusEvents: [...data.focusEvents, ...focusEvents],
            scored: scored === null ? data.scored : [...data.scored, scored],
        })
    }
    const active = session()
    if (active !== null) {
        setSession({ ...active, rounds: [...active.rounds, round], lastScored: scored, lastRoundEndedAt: now })
    }
    log.info('round', 'saved', { accuracy, result, muted, rating: ratingAfter?.rating, presses: presses.length })
    // Someone who left the round for settings returns to the results from there.
    if (screen().name === 'play') {
        go({ name: 'results' })
    }
}

export const startRound = (elements: RoundElements): RunningRound | null => {
    const active = session()
    const bank = letterBank()
    if (active === null || bank === null) {
        setProblem('There is no session to play in. Start one from the home screen.')
        return null
    }
    const { step, stretch } = nextStep()
    const seed = randomSeed()
    const planned = generateRound(step, seed)
    const startedAt = Date.now()
    const ratingBefore = settings().rating
    const plan: RoundPlan = {
        planned,
        round: {
            id: crypto.randomUUID(),
            sessionId: active.record.id,
            index: active.rounds.length,
            stretch,
            step,
            trialCount: trialCountFor(step.n),
            seed,
            generatorVersion: GENERATOR_VERSION,
            appVersion: APP_VERSION,
            startedAt,
            perfStart: performance.now(),
            breakBeforeMs: active.lastRoundEndedAt === null ? null : startedAt - active.lastRoundEndedAt,
            audio: audioInfo(bank.context),
            ratingBefore,
            expected: expectedResult(ratingBefore, step.rating),
        },
    }
    const soundOn = settings().soundOn
    setSoundOn(bank, soundOn)
    const running = runRound({ bank, planned, intervalMs: step.intervalMs, soundOn, ...elements })
    running.done
        .then(async (capture) => saveRound({ ...plan, round: { ...plan.round, perfStart: capture.perfStart } }, capture))
        .catch(report('round', 'The round could not be saved'))
    return running
}

// ---------- session end ----------

const refreshFindings = async (): Promise<void> => {
    const data = dataset()
    if (data === null) {
        return
    }
    const now = new Date()
    const current = [...modelFindings(data, now), ...statFindings(data, now)]
    const records = updateLifecycle({ records: findingRecords(), findings: current, dataset: data, now })
    await store.findings.bulkPut(records)
    setFindingRecords(records)
    log.info('findings', 'updated', { current: current.length, stored: records.length })
}

export const endSession = async (): Promise<void> => {
    const active = session()
    if (active === null) {
        go({ name: 'home' })
        return
    }
    const record = { ...active.record, endedAt: Date.now() }
    await store.sessions.put(record)
    setSession({ ...active, record })
    const data = dataset()
    if (data !== null) {
        setDataset({ ...data, sessions: data.sessions.map((existing) => existing.id === record.id ? record : existing) })
    }
    go({ name: 'session-end' })
    await refreshFindings().catch(report('findings', 'Findings could not be updated'))
}

export const saveNote = async (note: string): Promise<void> => {
    const active = session()
    if (active !== null && note.trim() !== '') {
        const record = { ...active.record, note: note.trim() }
        await store.sessions.put(record)
        const data = dataset()
        if (data !== null) {
            setDataset({ ...data, sessions: data.sessions.map((existing) => existing.id === record.id ? record : existing) })
        }
    }
    setSession(null)
    go({ name: 'home' })
}

// ---------- settings, experiments ----------

export const updateSettings = async (changes: Parameters<typeof saveSettings>[1]): Promise<void> => {
    setSettings(await saveSettings(store, changes))
}

// The letters go quiet (or come back) at once; the setting is saved after.
export const setSound = async (soundOn: boolean): Promise<void> => {
    const bank = letterBank()
    if (bank !== null) {
        setSoundOn(bank, soundOn)
    }
    await updateSettings({ soundOn })
}

export const createExperiment = async (fields: Pick<ExperimentRecord, 'question' | 'conditionA' | 'conditionB' | 'days'>): Promise<void> => {
    const record: ExperimentRecord = {
        ...fields,
        id: crypto.randomUUID(),
        startDay: today(),
        seed: randomSeed(),
        createdAt: Date.now(),
        stoppedAt: null,
    }
    await store.experiments.put(record)
    const data = dataset()
    if (data !== null) {
        setDataset({ ...data, experiments: [...data.experiments, record] })
    }
}

export const stopExperiment = async (experiment: ExperimentRecord): Promise<void> => {
    const record = { ...experiment, stoppedAt: Date.now() }
    await store.experiments.put(record)
    const data = dataset()
    if (data !== null) {
        setDataset({ ...data, experiments: data.experiments.map((existing) => existing.id === record.id ? record : existing) })
    }
}

export const deleteEverything = async (): Promise<void> => {
    await Promise.all(store.tables.map(async (table) => table.clear()))
    // The screen being left must not be written back after the wipe.
    views.current = null
    setSettings(DEFAULT_SETTINGS)
    setFindingRecords([])
    setSession(null)
    setDataset(await loadDataset(store))
    log.warn('app', 'all data deleted')
    go({ name: 'home' })
}

import { createEffect, createRoot, on, untrack } from 'solid-js'
import { differenceInCalendarDays } from 'date-fns'
import { median } from 'simple-statistics'
import { type Dataset, loadDataset } from '../data/dataset'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../data/db'
import type {
    DifficultyStep,
    ExperimentAssignment,
    ExperimentRecord,
    FocusEventRecord,
    Forecast,
    PressRecord,
    RatingState,
    RoundRecord,
    ScreenViewRecord,
    Sense,
    SessionRecord,
    TrialRecord,
} from '../data/schema'
import { stepForRating, stretchStep } from '../domain/difficulty'
import { conditionFor } from '../domain/experiments'
import { modelFindings, updateLifecycle } from '../domain/findings'
import { forecastSession } from '../domain/forecast'
import { dayKey } from '../domain/format'
import { afterIdleDays, expectedResult, rateRound, resultFromAccuracy } from '../domain/rating'
import { scoreRound } from '../domain/scoring'
import { roundEndedAt, settleSessions } from '../domain/sessions'
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

// Audio can only start inside a tap or key press, so the presses that start a session and
// each round wake it. After a reload it stays asleep until then.
const wakeAudio = async (): Promise<boolean> => {
    const bank = letterBank()
    if (bank === null) {
        setProblem('The letter sounds are still loading. Try again in a moment.')
        return false
    }
    await resumeAudio(bank)
    return true
}

export const beginSession = async (): Promise<void> => {
    if (await wakeAudio()) {
        go({ name: needsBaseline() ? 'baseline' : 'ready' })
    }
}

// The session itself starts with its first round, so leaving from the round intro leaves
// nothing behind.
export const startFirstRound = async (): Promise<void> => {
    if (!await wakeAudio()) {
        return
    }
    if (session() === null) {
        await createSession()
    }
    go({ name: 'play' })
}

export const playNextRound = async (): Promise<void> => {
    if (await wakeAudio()) {
        go({ name: 'play' })
    }
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

interface RoundRecords {
    round: RoundRecord
    trials: TrialRecord[]
    presses: PressRecord[]
    focusEvents: FocusEventRecord[]
    muted: boolean
}

// Every record a round makes, from a capture taken at its end or partway through.
const roundRecords = (plan: RoundPlan, capture: RoundCapture): RoundRecords => {
    const draft = { ...plan.round, perfStart: capture.perfStart }
    const ids = { roundId: draft.id, sessionId: draft.sessionId }
    const trials = buildTrialRecords({
        ...ids,
        planned: plan.planned,
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
    return { round: { ...unscored, accuracy, result, ratingAfter }, trials, presses, focusEvents, muted }
}

const writeRound = async ({ round, trials, presses, focusEvents }: RoundRecords): Promise<void> => {
    await store.rounds.put(round)
    await store.trials.bulkPut(trials)
    await store.presses.bulkPut(presses)
    await store.focusEvents.bulkPut(focusEvents)
}

const saveRound = async (records: RoundRecords): Promise<void> => {
    const { round, trials, presses, focusEvents, muted } = records
    const now = Date.now()
    await store.transaction('rw', [store.rounds, store.trials, store.presses, store.focusEvents, store.settings], async () => {
        await writeRound(records)
        if (round.ratingAfter !== null) {
            setSettings(await saveSettings(store, { rating: round.ratingAfter, ratingUpdatedAt: now }))
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
    log.info('round', 'saved', { accuracy: round.accuracy, result: round.result, muted, rating: round.ratingAfter?.rating, presses: presses.length })
    // Someone who left the round for settings returns to the results from there.
    if (screen().name === 'play') {
        go({ name: 'results' })
    }
}

// A round in progress is saved as it goes: as what pausing at that moment would save, at
// its start, just after each square goes out, and whenever the page is hidden or unloaded.
// So a refresh, a closed tab or a crash loses at most the trial that was showing.
const CHECKPOINT_DELAY_MS = 600

interface RoundProgress {
    writes: Promise<void>
    ended: boolean
    running: RunningRound | null
}

const saveProgress = async (records: RoundRecords): Promise<void> => {
    await store.transaction('rw', [store.rounds, store.trials, store.presses, store.focusEvents], async () => writeRound(records))
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

    // Writes run one after another and the final save comes last, so a late checkpoint
    // can't overwrite the finished round.
    const progress: RoundProgress = { writes: Promise.resolve(), ended: false, running: null }
    const enqueue = (write: () => Promise<void>): void => {
        progress.writes = progress.writes.then(write)
    }
    const checkpoint = (): void => enqueue(async () => {
        const capture = progress.ended ? null : progress.running?.snapshot()
        if (capture !== null && capture !== undefined) {
            await saveProgress(roundRecords(plan, capture))
                .catch((error: unknown) => log.error('round', 'progress could not be saved', error))
        }
    })
    const onHidden = (): void => {
        if (document.visibilityState === 'hidden') {
            checkpoint()
        }
    }

    const soundOn = settings().soundOn
    setSoundOn(bank, soundOn)
    progress.running = runRound({
        bank,
        planned,
        intervalMs: step.intervalMs,
        soundOn,
        ...elements,
        onTrial: (index) => {
            elements.onTrial(index)
            setTimeout(checkpoint, CHECKPOINT_DELAY_MS)
        },
    })
    checkpoint()
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', checkpoint)
    progress.running.done
        .then((capture) => {
            progress.ended = true
            document.removeEventListener('visibilitychange', onHidden)
            window.removeEventListener('pagehide', checkpoint)
            enqueue(async () => saveRound(roundRecords(plan, capture)).catch(report('round', 'The round could not be saved')))
        })
        .catch(report('round', 'The round could not be saved'))
    return progress.running
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

// ---------- startup ----------

// Back in the session that was open when the page went away: its rounds so far (the last
// one saved as far as it got), on that round's results.
const resumeSession = (record: SessionRecord, data: Dataset): void => {
    const rounds = data.rounds.filter(({ sessionId }) => sessionId === record.id).sort((a, b) => a.index - b.index)
    const last = rounds.at(-1)
    setSession({
        record,
        rounds,
        lastScored: last === undefined ? null : data.scored.find(({ round }) => round.id === last.id) ?? null,
        lastRoundEndedAt: last === undefined ? null : roundEndedAt(last),
    })
    go(last === undefined ? { name: 'ready' } : { name: 'results' })
    log.info('session', 'resumed after the page went away', { rounds: rounds.length, lastCompleted: last?.completed })
}

// Sessions left open when the page went away: the latest is picked up again if it was in
// use lately, the rest are closed where they stopped (see domain/sessions.ts).
const settleOpenSessions = async (loaded: Dataset): Promise<{ data: Dataset; resume: SessionRecord | null }> => {
    const { resume, closed } = settleSessions(loaded.sessions, loaded.rounds, Date.now())
    if (closed.length === 0) {
        return { data: loaded, resume }
    }
    await store.sessions.bulkPut(closed)
    log.info('session', 'closed sessions left open', closed.map(({ id, endedAt }) => ({ id, endedAt })))
    const byId = new Map(closed.map((record) => [record.id, record]))
    return { data: { ...loaded, sessions: loaded.sessions.map((record) => byId.get(record.id) ?? record) }, resume }
}

export const loadApp = async (): Promise<void> => {
    const [loadedSettings, loadedDataset, loadedFindings] = await Promise.all([
        loadSettings(store),
        loadDataset(store),
        store.findings.toArray(),
    ])
    setSettings(loadedSettings)
    setFindingRecords(loadedFindings)
    const { data, resume } = await settleOpenSessions(loadedDataset)
    setDataset(data)
    log.info('app', 'loaded', { rounds: data.rounds.length, sessions: data.sessions.length })
    if (resume !== null) {
        resumeSession(resume, data)
    }
    // Closing sessions changes what the findings are drawn from.
    if (data !== loadedDataset) {
        void refreshFindings().catch(report('findings', 'Findings could not be updated'))
    }
    createLetterBank()
        .then((bank) => {
            setLetterBank(bank)
        })
        .catch(report('audio', 'The letter sounds could not load'))
}

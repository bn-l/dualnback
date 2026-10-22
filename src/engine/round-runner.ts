import { median } from 'simple-statistics'
import type { Sense } from '../data/schema'
import type { PlannedTrial } from '../domain/sequence'
import { log } from '../log'
import { type LetterBank, MS_PER_SECOND, pageTimeOf, scheduleLetter } from './audio'
import { type Capture, type CapturedFocusEvent, type CapturedPress, startCapture } from './capture'

// Quiet time before the first stimulus, which also gives the frame-rate estimate a start.
const LEAD_IN_SECONDS = 1
// How long the square stays lit.
const STIMULUS_MS = 500
// Frame intervals used to estimate the display's refresh rate.
const FRAME_SAMPLES = 30
// A frame interval this many times the typical one means frames were dropped.
const DROP_FACTOR = 1.5
const FALLBACK_HZ = 60
const FALLBACK_FRAME_MS = MS_PER_SECOND / FALLBACK_HZ
// If the page is hidden at the end, animation frames stop; this timer still ends the round.
const END_GRACE_MS = 500
// Sound running this far behind the plan (an output device waking up, say) is logged.
const DRIFT_WARN_MS = 40

export interface TrialTiming {
    scheduledOnset: number
    visualOnset: number | null
    audioOnset: number | null
    droppedFrames: number
}

export interface RoundCapture {
    perfStart: number
    perfEnd: number
    completed: boolean
    quitAtTrial: number | null
    // How many trials were reached before the round ended or was stopped.
    trialsRun: number
    refreshHz: number | null
    timings: TrialTiming[]
    presses: CapturedPress[]
    focusEvents: CapturedFocusEvent[]
}

export interface RunOptions {
    bank: LetterBank
    planned: readonly PlannedTrial[]
    intervalMs: number
    cells: readonly HTMLElement[]
    buttons: Record<Sense, HTMLElement>
    controlKeys: readonly string[]
    // Whether the letters can be heard as the round starts.
    soundOn: boolean
    onTrial: (index: number) => void
}

export interface RunningRound {
    done: Promise<RoundCapture>
    quit: () => void
    // What quitting now would capture, without stopping: what's saved as the round goes, so a
    // refresh or a closed tab loses at most the last trial.
    snapshot: () => RoundCapture
    // Records the sound button being pressed, for the trials it affects.
    soundChanged: (on: boolean) => void
}

interface LoopState {
    shown: number
    lit: HTMLElement | null
    lastFrame: number | null
    frameId: number
    driftLogged: boolean
    finished: boolean
    capture: Capture | null
    endTimer: ReturnType<typeof setTimeout> | null
}

// Runs one round. Trials are timed by the audio clock, which doesn't drift: every sound is
// scheduled up front, and each square is lit on the animation frame that will reach the
// screen at its sound's onset. The visual onset recorded is that frame's timestamp.
export const runRound = ({ bank, planned, intervalMs, cells, buttons, controlKeys, soundOn, onTrial }: RunOptions): RunningRound => {
    const { context } = bank
    const firstAudioTime = context.currentTime + LEAD_IN_SECONDS
    const audioTimes = planned.map((_, index) => firstAudioTime + (index * intervalMs) / MS_PER_SECOND)
    const sources = planned.map((trial, index) => scheduleLetter(bank, trial.sound, audioTimes[index] ?? firstAudioTime))
    const perfStart = performance.now()
    const timings: TrialTiming[] = audioTimes.map((time) => ({
        scheduledOnset: pageTimeOf(context, time),
        visualOnset: null,
        audioOnset: null,
        droppedFrames: 0,
    }))
    const lastAudioTime = audioTimes[audioTimes.length - 1] ?? firstAudioTime
    // When the round ends, by the audio clock as it stands now.
    const endAt = (): number => pageTimeOf(context, lastAudioTime) + intervalMs
    const frameIntervals: number[] = []
    const audioEvents: CapturedFocusEvent[] = soundOn ? [] : [{ type: 'sound-off', at: perfStart }]
    const { promise, resolve } = Promise.withResolvers<RoundCapture>()
    const state: LoopState = {
        shown: -1,
        lit: null,
        lastFrame: null,
        frameId: 0,
        driftLogged: false,
        finished: false,
        capture: null,
        endTimer: null,
    }

    const typicalFrame = (): number =>
        frameIntervals.length === 0 ? FALLBACK_FRAME_MS : median(frameIntervals.slice(0, FRAME_SAMPLES))

    const unlight = (): void => {
        state.lit?.removeAttribute('data-lit')
        state.lit = null
    }

    // The browser reports a state change after the fact, so the resume that the tap starting
    // the round makes arrives here once the round is under way. Only real changes count.
    let audioState = context.state
    const onAudioState = (): void => {
        if (context.state === audioState) {
            return
        }
        audioState = context.state
        audioEvents.push({ type: context.state === 'running' ? 'audio-running' : 'audio-interrupted', at: performance.now() })
        log.warn('round', 'audio state changed mid-round', context.state)
    }

    // The round as it stands: all of it if completed, else up to the trial showing now. Copies,
    // so a snapshot taken mid-round doesn't change as the round goes on.
    const captureNow = (completed: boolean): RoundCapture => {
        const reached = completed ? planned.length - 1 : state.shown
        return {
            perfStart,
            perfEnd: performance.now(),
            completed,
            quitAtTrial: completed ? null : Math.max(0, state.shown),
            trialsRun: reached + 1,
            refreshHz: frameIntervals.length === 0 ? null : MS_PER_SECOND / typicalFrame(),
            // Sounds play even while the page is hidden, so trials that never got a frame
            // still have a sound onset: the scheduled one.
            timings: timings.map((timing, index) => ({
                ...timing,
                audioOnset: timing.audioOnset ?? (index <= reached ? timing.scheduledOnset : null),
            })),
            presses: (state.capture?.presses ?? []).map((press) => ({ ...press })),
            focusEvents: [...(state.capture?.focusEvents ?? []), ...audioEvents].sort((a, b) => a.at - b.at),
        }
    }

    const finish = (completed: boolean): void => {
        if (state.finished) {
            return
        }
        state.finished = true
        cancelAnimationFrame(state.frameId)
        if (state.endTimer !== null) {
            clearTimeout(state.endTimer)
        }
        context.removeEventListener('statechange', onAudioState)
        state.capture?.stop()
        unlight()
        if (!completed) {
            sources.forEach((source) => source.stop())
        }
        resolve(captureNow(completed))
    }

    const frame = (now: number): void => {
        if (state.finished) {
            return
        }
        if (state.lastFrame !== null) {
            const elapsed = now - state.lastFrame
            frameIntervals.push(elapsed)
            const current = timings[state.shown]
            if (current !== undefined && elapsed > typicalFrame() * DROP_FACTOR) {
                current.droppedFrames += Math.round(elapsed / typicalFrame()) - 1
            }
        }
        state.lastFrame = now
        const frameMs = typicalFrame()
        // Each square is lit against when its sound will be heard by the audio clock as it
        // stands now, not as planned at the start, so a stalled clock can't split them.
        const due = audioTimes.findLastIndex((time) => pageTimeOf(context, time) <= now + frameMs)
        const dueTiming = timings[due]
        const duePlanned = planned[due]
        if (due > state.shown && dueTiming !== undefined && duePlanned !== undefined) {
            unlight()
            const cell = cells[duePlanned.position]
            cell?.setAttribute('data-lit', '')
            state.lit = cell ?? null
            dueTiming.visualOnset = now
            dueTiming.audioOnset = pageTimeOf(context, audioTimes[due] ?? firstAudioTime)
            state.shown = due
            onTrial(due)
            const drift = dueTiming.audioOnset - dueTiming.scheduledOnset
            if (drift > DRIFT_WARN_MS && !state.driftLogged) {
                state.driftLogged = true
                log.warn('round', 'sound is running behind the plan; squares follow the sound', { trial: due, driftMs: Math.round(drift) })
            }
        }
        const shownOnset = timings[state.shown]?.visualOnset
        if (state.lit !== null && shownOnset != null && now + frameMs >= shownOnset + STIMULUS_MS) {
            unlight()
        }
        if (now >= endAt()) {
            finish(true)
            return
        }
        state.frameId = requestAnimationFrame(frame)
    }

    state.capture = startCapture({ buttons, controlKeys })
    context.addEventListener('statechange', onAudioState)
    state.endTimer = setTimeout(() => finish(true), endAt() - performance.now() + END_GRACE_MS)
    state.frameId = requestAnimationFrame(frame)
    log.info('round', 'started', { trials: planned.length, intervalMs })

    return {
        done: promise,
        quit: () => finish(false),
        snapshot: () => captureNow(false),
        soundChanged: (on) => {
            audioEvents.push({ type: on ? 'sound-on' : 'sound-off', at: performance.now() })
            log.info('round', on ? 'sound turned on' : 'sound turned off', { trial: state.shown })
        },
    }
}

import type { FocusEventRecord, FocusEventType, PressRecord, Sense, TrialFlags, TrialRecord } from '../data/schema'
import { EARLY_PRESS_MS } from '../domain/scoring'
import type { PlannedTrial } from '../domain/sequence'
import type { CapturedFocusEvent, CapturedPress } from './capture'
import type { TrialTiming } from './round-runner'

interface Interval {
    from: number
    to: number
}

// Turns "went away" / "came back" events into the stretches of time spent away. A stretch
// still open at the end of the round runs to the end.
const awayIntervals = (
    events: readonly CapturedFocusEvent[],
    pair: { away: FocusEventType; back: FocusEventType },
    end: number,
): Interval[] => {
    const { open, intervals } = events.reduce<{ open: number | null; intervals: Interval[] }>((state, event) => {
        if (event.type === pair.away && state.open === null) {
            return { open: event.at, intervals: state.intervals }
        }
        if (event.type === pair.back && state.open !== null) {
            return { open: null, intervals: [...state.intervals, { from: state.open, to: event.at }] }
        }
        return state
    }, { open: null, intervals: [] })
    return open === null ? intervals : [...intervals, { from: open, to: end }]
}

// A letter is lost if the sound was off at any point in its first quarter second, the time
// it takes to make one out. Sound turned off in the silence between letters loses none.
const RECOGNISE_MS = 250

const overlaps = (intervals: readonly Interval[], window: Interval): boolean =>
    intervals.some(({ from, to }) => from < window.to && to >= window.from)

export interface BuildOptions {
    roundId: string
    sessionId: string
    planned: readonly PlannedTrial[]
    timings: readonly TrialTiming[]
    presses: readonly CapturedPress[]
    focusEvents: readonly CapturedFocusEvent[]
    perfEnd: number
    // Trials after this one never ran (the round was stopped).
    lastTrial: number
}

const onsetOf = (timing: TrialTiming, sense: Sense): number =>
    (sense === 'position' ? timing.visualOnset : timing.audioOnset) ?? timing.scheduledOnset

export const buildTrialRecords = (options: BuildOptions): TrialRecord[] => {
    const { roundId, sessionId, planned, timings, presses, focusEvents, perfEnd, lastTrial } = options
    const hidden = awayIntervals(focusEvents, { away: 'hidden', back: 'visible' }, perfEnd)
    const blurred = awayIntervals(focusEvents, { away: 'blur', back: 'focus' }, perfEnd)
    const audioDown = awayIntervals(focusEvents, { away: 'audio-interrupted', back: 'audio-running' }, perfEnd)
    const soundOff = awayIntervals(focusEvents, { away: 'sound-off', back: 'sound-on' }, perfEnd)
    const answers = presses.filter((press) => !press.repeat && press.sense !== null)

    return planned.slice(0, lastTrial + 1).map((trial, index) => {
        const timing = timings[index]
        if (timing === undefined) {
            throw new Error(`Trial ${index} has no timing`)
        }
        const window = { from: timing.scheduledOnset, to: timings[index + 1]?.scheduledOnset ?? perfEnd }
        const onset = timing.audioOnset ?? timing.scheduledOnset
        const heard = { from: onset, to: onset + RECOGNISE_MS }
        const flags: TrialFlags = {
            hidden: overlaps(hidden, window),
            blurred: overlaps(blurred, window),
            droppedFrames: timing.droppedFrames > 0,
            audioGlitch: overlaps(audioDown, window),
            muted: overlaps(soundOff, heard),
            earlyPress: answers.some((press) => {
                const sinceOnset = press.downAt - onsetOf(timing, press.sense ?? 'position')
                return sinceOnset >= 0 && sinceOnset < EARLY_PRESS_MS
            }),
        }
        return {
            id: `${roundId}:${index}`,
            roundId,
            sessionId,
            ...trial,
            scheduledOnset: timing.scheduledOnset,
            visualOnset: timing.visualOnset,
            audioOnset: timing.audioOnset,
            droppedFrames: timing.droppedFrames,
            flags,
        }
    })
}

export const buildPressRecords = (
    ids: { roundId: string; sessionId: string },
    presses: readonly CapturedPress[],
): PressRecord[] =>
    presses.map((press, seq) => ({ id: `${ids.roundId}:p${seq}`, roundId: ids.roundId, sessionId: ids.sessionId, seq, ...press }))

export const buildFocusRecords = (roundId: string, events: readonly CapturedFocusEvent[]): FocusEventRecord[] =>
    events.map((event, index) => ({ id: `${roundId}:f${index}`, roundId, ...event }))

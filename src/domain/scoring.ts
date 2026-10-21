import type { PressRecord, RoundRecord, Sense, TrialRecord } from '../data/schema'
import { SENSES } from '../data/schema'

export type Outcome = 'hit' | 'miss' | 'false-alarm' | 'correct-rejection'

// A press this soon after a stimulus can't be a response to it: it's either a guess or a
// late press meant for the trial before.
export const EARLY_PRESS_MS = 100

export interface SenseResponse {
    outcome: Outcome
    press: PressRecord | null
    // From the onset of this sense's stimulus to the press.
    rt: number | null
    // The press landed after the next stimulus had already appeared.
    late: boolean
}

export interface ScoredTrial {
    trial: TrialRecord
    position: SenseResponse
    sound: SenseResponse
    // False when something during the trial makes its timing unreliable.
    timingUsable: boolean
}

export interface Counts {
    hits: number
    misses: number
    falseAlarms: number
    correctRejections: number
}

export interface ScoredRound {
    round: RoundRecord
    trials: ScoredTrial[]
    counts: Record<Sense, Counts>
    accuracy: number
    // Double presses and keys that are neither Position nor Sound.
    extraPresses: PressRecord[]
}

export const onsetFor = (trial: TrialRecord, sense: Sense): number =>
    (sense === 'position' ? trial.visualOnset : trial.audioOnset) ?? trial.scheduledOnset

export const isMatch = (trial: TrialRecord, sense: Sense): boolean =>
    sense === 'position' ? trial.positionMatch : trial.soundMatch

interface Attributed {
    press: PressRecord
    trialIndex: number
    late: boolean
}

// The trial a press belongs to: the last one whose stimulus had appeared, unless the
// press came too soon after it and the trial before still has no press for this sense.
const attribute = (trials: readonly TrialRecord[], sense: Sense, presses: readonly PressRecord[]): Attributed[] =>
    presses.reduce<Attributed[]>((attributed, press) => {
        const current = trials.findLastIndex((trial) => onsetFor(trial, sense) <= press.downAt)
        const currentTrial = trials[current]
        if (currentTrial === undefined) {
            return attributed
        }
        const tooSoon = press.downAt - onsetFor(currentTrial, sense) < EARLY_PRESS_MS
        const previousTaken = attributed.some((entry) => entry.trialIndex === current - 1)
        const late = tooSoon && current > 0 && !previousTaken
        return [...attributed, { press, trialIndex: late ? current - 1 : current, late }]
    }, [])

const outcomeOf = (match: boolean, pressed: boolean): Outcome =>
    match ? (pressed ? 'hit' : 'miss') : (pressed ? 'false-alarm' : 'correct-rejection')

const countOutcomes = (responses: readonly SenseResponse[]): Counts => ({
    hits: responses.filter(({ outcome }) => outcome === 'hit').length,
    misses: responses.filter(({ outcome }) => outcome === 'miss').length,
    falseAlarms: responses.filter(({ outcome }) => outcome === 'false-alarm').length,
    correctRejections: responses.filter(({ outcome }) => outcome === 'correct-rejection').length,
})

// Correct "no" answers are left out: most trials are non-matches, so counting them would
// inflate accuracy.
export const accuracyOf = (counts: readonly Counts[]): number => {
    const hits = counts.reduce((sum, { hits: value }) => sum + value, 0)
    const errors = counts.reduce((sum, { misses, falseAlarms }) => sum + misses + falseAlarms, 0)
    return hits + errors === 0 ? 1 : hits / (hits + errors)
}

const timingUsable = (trial: TrialRecord): boolean =>
    !trial.flags.hidden && !trial.flags.blurred && !trial.flags.droppedFrames && !trial.flags.audioGlitch

export const scoreRound = (
    round: RoundRecord,
    trials: readonly TrialRecord[],
    presses: readonly PressRecord[],
): ScoredRound => {
    const ordered = [...trials].sort((a, b) => a.index - b.index)
    const counted = presses.filter((press) => !press.repeat).sort((a, b) => a.downAt - b.downAt)

    const bySense = Object.fromEntries(SENSES.map((sense) => {
        const attributed = attribute(ordered, sense, counted.filter((press) => press.sense === sense))
        const first = new Map<number, Attributed>()
        attributed.forEach((entry) => {
            if (!first.has(entry.trialIndex)) {
                first.set(entry.trialIndex, entry)
            }
        })
        const responses = ordered.map((trial, index): SenseResponse => {
            const entry = first.get(index)
            return {
                outcome: outcomeOf(isMatch(trial, sense), entry !== undefined),
                press: entry?.press ?? null,
                rt: entry === undefined ? null : entry.press.downAt - onsetFor(trial, sense),
                late: entry?.late ?? false,
            }
        })
        const doubles = attributed.filter((entry) => first.get(entry.trialIndex) !== entry)
        return [sense, { responses, doubles: doubles.map(({ press }) => press) }]
    }))

    const position = bySense.position
    const sound = bySense.sound
    if (position === undefined || sound === undefined) {
        throw new Error('Scoring is missing a sense')
    }
    const scored = ordered.map((trial, index): ScoredTrial => {
        const positionResponse = position.responses[index]
        const soundResponse = sound.responses[index]
        if (positionResponse === undefined || soundResponse === undefined) {
            throw new Error(`Trial ${index} has no response`)
        }
        return { trial, position: positionResponse, sound: soundResponse, timingUsable: timingUsable(trial) }
    })
    const counts = { position: countOutcomes(position.responses), sound: countOutcomes(sound.responses) }
    return {
        round,
        trials: scored,
        counts,
        accuracy: accuracyOf([counts.position, counts.sound]),
        extraPresses: [
            ...position.doubles,
            ...sound.doubles,
            ...presses.filter((press) => press.sense === null),
        ],
    }
}

export const responseFor = (trial: ScoredTrial, sense: Sense): SenseResponse =>
    sense === 'position' ? trial.position : trial.sound

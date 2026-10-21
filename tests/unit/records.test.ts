import { describe, expect, it } from 'vite-plus/test'
import { stepForRating } from '../../src/domain/difficulty'
import { generateRound } from '../../src/domain/sequence'
import { buildTrialRecords } from '../../src/engine/records'
import type { CapturedFocusEvent } from '../../src/engine/capture'
import type { TrialTiming } from '../../src/engine/round-runner'

const INTERVAL = 2500
// The plan made at round start was off: every letter was heard this long before its
// planned onset, and its square lit with it.
const EARLY = 400

const planned = generateRound(stepForRating(1200), 11).slice(0, 4)

const timings: TrialTiming[] = planned.map((_, index) => ({
    scheduledOnset: 1000 + index * INTERVAL,
    visualOnset: 1000 + index * INTERVAL - EARLY,
    audioOnset: 1000 + index * INTERVAL - EARLY,
    droppedFrames: 0,
}))

const build = (focusEvents: CapturedFocusEvent[]) => buildTrialRecords({
    roundId: 'r',
    sessionId: 's',
    planned,
    timings,
    presses: [],
    focusEvents,
    perfEnd: 1000 + planned.length * INTERVAL - EARLY,
    lastTrial: planned.length - 1,
})

describe('the muted flag', () => {
    it('marks the trials whose letters played after the sound went off, by when they were heard', () => {
        // Arrange: off just after the second letter was heard, which is before its planned
        // onset, so a planned window would wrongly count the first trial as muted.
        const offAt = 1000 + INTERVAL - EARLY + 50

        // Act
        const trials = build([{ type: 'sound-off', at: offAt }])

        // Assert
        expect(trials.map(({ flags }) => flags.muted)).toEqual([false, true, true, true])
    })

    it('leaves a letter alone when the sound goes off in the silence after it', () => {
        // Arrange: off a moment before the second letter, long after the first one ended.
        const offAt = 1000 + INTERVAL - EARLY - 1

        // Act
        const trials = build([{ type: 'sound-off', at: offAt }])

        // Assert
        expect(trials.map(({ flags }) => flags.muted)).toEqual([false, true, true, true])
    })

    it('clears once the sound is back on', () => {
        // Arrange
        const events: CapturedFocusEvent[] = [
            { type: 'sound-off', at: 1000 - EARLY + 100 },
            { type: 'sound-on', at: 1000 + INTERVAL - EARLY - 100 },
        ]

        // Act
        const trials = build(events)

        // Assert
        expect(trials.map(({ flags }) => flags.muted)).toEqual([true, false, false, false])
    })

    it('marks every trial of a round that started with the sound off', () => {
        // Arrange
        const events: CapturedFocusEvent[] = [{ type: 'sound-off', at: 0 }]

        // Act
        const trials = build(events)

        // Assert
        expect(trials.every(({ flags }) => flags.muted)).toBe(true)
    })
})

import { describe, expect, it } from 'vite-plus/test'
import { scoreRound } from '../../src/domain/scoring'
import { INTERVAL, makePress, makeRound, makeTrial } from './fixtures'

const plain = (index: number): { index: number; positionMatch: boolean; soundMatch: boolean } =>
    ({ index, positionMatch: false, soundMatch: false })

describe('scoreRound', () => {
    it('scores hits, misses, false alarms and correct rejections per sense', () => {
        // Arrange
        const trials = [
            makeTrial(plain(0)),
            makeTrial({ index: 1, positionMatch: true, soundMatch: false }),
            makeTrial({ index: 2, positionMatch: false, soundMatch: true }),
            makeTrial(plain(3)),
        ]
        const presses = [
            makePress('position', INTERVAL + 400),
            makePress('sound', 3 * INTERVAL + 500),
        ]

        // Act
        const scored = scoreRound(makeRound(), trials, presses)

        // Assert
        expect(scored.counts.position).toEqual({ hits: 1, misses: 0, falseAlarms: 0, correctRejections: 3 })
        expect(scored.counts.sound).toEqual({ hits: 0, misses: 1, falseAlarms: 1, correctRejections: 2 })
        expect(scored.accuracy).toBeCloseTo(1 / 3)
        expect(scored.trials[1]?.position.rt).toBe(400)
    })

    it('gives a press made within 100 ms of a new stimulus to the trial before', () => {
        // Arrange
        const trials = [makeTrial({ index: 0, positionMatch: false, soundMatch: false }), makeTrial({ index: 1, positionMatch: true, soundMatch: false }), makeTrial(plain(2))]
        const presses = [makePress('position', 2 * INTERVAL + 40)]

        // Act
        const scored = scoreRound(makeRound(), trials, presses)

        // Assert
        expect(scored.trials[1]?.position.outcome).toBe('hit')
        expect(scored.trials[1]?.position.late).toBe(true)
        expect(scored.trials[1]?.position.rt).toBe(INTERVAL + 40)
        expect(scored.trials[2]?.position.outcome).toBe('correct-rejection')
    })

    it('keeps an early press on the current trial when the trial before already has one', () => {
        // Arrange
        const trials = [makeTrial(plain(0)), makeTrial({ index: 1, positionMatch: true, soundMatch: false }), makeTrial(plain(2))]
        const presses = [makePress('position', INTERVAL + 300), makePress('position', 2 * INTERVAL + 30)]

        // Act
        const scored = scoreRound(makeRound(), trials, presses)

        // Assert
        expect(scored.trials[1]?.position.outcome).toBe('hit')
        expect(scored.trials[2]?.position.outcome).toBe('false-alarm')
        expect(scored.trials[2]?.position.late).toBe(false)
    })

    it('counts only the first press per trial and keeps doubles, repeats and wrong keys out of the score', () => {
        // Arrange
        const trials = [makeTrial(plain(0)), makeTrial({ index: 1, positionMatch: true, soundMatch: false })]
        const presses = [
            makePress('position', INTERVAL + 300),
            makePress('position', INTERVAL + 600),
            makePress('position', INTERVAL + 700, { repeat: true }),
            makePress(null, INTERVAL + 800),
        ]

        // Act
        const scored = scoreRound(makeRound(), trials, presses)

        // Assert
        expect(scored.counts.position.hits).toBe(1)
        expect(scored.counts.position.falseAlarms).toBe(0)
        expect(scored.extraPresses).toHaveLength(2)
    })

    it('ignores presses before the first stimulus and handles a round with no presses', () => {
        // Arrange
        const trials = [makeTrial(plain(0)), makeTrial({ index: 1, positionMatch: true, soundMatch: true })]

        // Act
        const early = scoreRound(makeRound(), trials, [makePress('sound', -500)])
        const silent = scoreRound(makeRound(), trials, [])

        // Assert
        expect(early.counts.sound.falseAlarms).toBe(0)
        expect(silent.accuracy).toBe(0)
        expect(silent.counts.position.misses).toBe(1)
    })

    it('marks timing unusable on flagged trials and uses each sense its own onset', () => {
        // Arrange
        const trials = [
            makeTrial({ index: 0, positionMatch: true, soundMatch: true }, { visualOnset: 10, audioOnset: 40, flags: { hidden: true, blurred: false, droppedFrames: false, audioGlitch: false, earlyPress: false } }),
        ]
        const presses = [makePress('position', 410), makePress('sound', 440)]

        // Act
        const scored = scoreRound(makeRound(), trials, presses)

        // Assert
        expect(scored.trials[0]?.timingUsable).toBe(false)
        expect(scored.trials[0]?.position.rt).toBe(400)
        expect(scored.trials[0]?.sound.rt).toBe(400)
    })
})

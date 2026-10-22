import { describe, expect, it } from 'vite-plus/test'
import type { SessionRecord } from '../../src/data/schema'
import { RESUME_WITHIN_MS, lastActivity, roundEndedAt, settleSessions } from '../../src/domain/sessions'
import { makeRound } from './fixtures'

const START = Date.UTC(2026, 9, 21, 9)
const MINUTE = 60_000

const makeSession = (id: string, startedAt: number, endedAt: number | null = null): SessionRecord => ({
    id,
    appOpenedAt: startedAt,
    startedAt,
    perfAnchor: 0,
    endedAt,
    timeZone: 'UTC',
    utcOffsetMinutes: 0,
    device: {
        key: 'test', userAgent: 'test', screenWidth: 1, screenHeight: 1, pixelRatio: 1,
        coarsePointer: false, colorScheme: 'light', orientation: 'landscape',
    },
    appVersion: 'test',
    experiment: null,
    forecast: null,
    note: null,
})

describe('roundEndedAt', () => {
    it('is the round start plus how long it ran, including a round saved partway through', () => {
        // Arrange
        const finished = makeRound({ startedAt: START, perfStart: 5000, perfEnd: 71_000 })
        const cutShort = makeRound({ startedAt: START, perfStart: 5000, perfEnd: 17_000, completed: false })
        const neverSaved = makeRound({ startedAt: START, perfStart: 5000, perfEnd: null })

        // Act
        const ends = [finished, cutShort, neverSaved].map(roundEndedAt)

        // Assert
        expect(ends).toEqual([START + 66_000, START + 12_000, START])
    })
})

describe('settleSessions', () => {
    it('picks up the latest open session when it was in use within the half hour', () => {
        // Arrange
        const session = makeSession('s1', START)
        const rounds = [makeRound({ sessionId: 's1', startedAt: START + MINUTE, perfStart: 0, perfEnd: 30_000 })]
        const now = START + MINUTE + 30_000 + RESUME_WITHIN_MS - 1

        // Act
        const settled = settleSessions([session], rounds, now)

        // Assert
        expect(settled.resume?.id).toBe('s1')
        expect(settled.closed).toEqual([])
    })

    it('closes an open session that has sat for longer, at the end of its last round', () => {
        // Arrange
        const session = makeSession('s1', START)
        const rounds = [makeRound({ sessionId: 's1', startedAt: START + MINUTE, perfStart: 0, perfEnd: 30_000 })]
        const now = START + MINUTE + 30_000 + RESUME_WITHIN_MS + 1

        // Act
        const settled = settleSessions([session], rounds, now)

        // Assert
        expect(settled.resume).toBeNull()
        expect(settled.closed.map(({ id, endedAt }) => ({ id, endedAt }))).toEqual([{ id: 's1', endedAt: START + MINUTE + 30_000 }])
    })

    it('resumes only the latest of several open sessions and closes the others; ended ones are left alone', () => {
        // Arrange
        const older = makeSession('old', START)
        const ended = makeSession('done', START + 10 * MINUTE, START + 20 * MINUTE)
        const latest = makeSession('new', START + 40 * MINUTE)
        const now = START + 45 * MINUTE

        // Act
        const settled = settleSessions([latest, ended, older], [], now)

        // Assert
        expect(settled.resume?.id).toBe('new')
        expect(settled.closed.map(({ id, endedAt }) => ({ id, endedAt }))).toEqual([{ id: 'old', endedAt: START }])
    })

    it('does nothing when every session was ended', () => {
        // Arrange
        const sessions = [makeSession('a', START, START + MINUTE), makeSession('b', START + 2 * MINUTE, START + 3 * MINUTE)]

        // Act
        const settled = settleSessions(sessions, [], START + 4 * MINUTE)

        // Assert
        expect(settled).toEqual({ resume: null, closed: [] })
    })

    it("takes a session's last activity from its own rounds only", () => {
        // Arrange
        const session = makeSession('s1', START)
        const rounds = [
            makeRound({ id: 'mine', sessionId: 's1', startedAt: START + MINUTE, perfStart: 0, perfEnd: 10_000 }),
            makeRound({ id: 'other', sessionId: 's2', startedAt: START + 50 * MINUTE, perfStart: 0, perfEnd: 10_000 }),
        ]

        // Act
        const last = lastActivity(session, rounds)

        // Assert
        expect(last).toBe(START + MINUTE + 10_000)
    })
})

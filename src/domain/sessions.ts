import type { RoundRecord, SessionRecord } from '../data/schema'

// What to do, when the app opens, with sessions that were never ended: the page was
// refreshed, the tab closed or the phone died partway through. The latest one is picked up
// again if it was in use within the last half hour; the rest are closed where they stopped.
const RESUME_MINUTES = 30
const MS_PER_MINUTE = 60_000
export const RESUME_WITHIN_MS = RESUME_MINUTES * MS_PER_MINUTE

// When a round stopped, on the wall clock: its start plus how long it ran. A round saved
// partway through has run until its last save.
export const roundEndedAt = (round: RoundRecord): number =>
    round.startedAt + ((round.perfEnd ?? round.perfStart) - round.perfStart)

export const lastActivity = (session: SessionRecord, rounds: readonly RoundRecord[]): number =>
    Math.max(session.startedAt, ...rounds.filter(({ sessionId }) => sessionId === session.id).map(roundEndedAt))

export interface Settled {
    resume: SessionRecord | null
    // With endedAt set to when each was last in use.
    closed: SessionRecord[]
}

export const settleSessions = (sessions: readonly SessionRecord[], rounds: readonly RoundRecord[], now: number): Settled => {
    const open = sessions.filter(({ endedAt }) => endedAt === null).sort((a, b) => a.startedAt - b.startedAt)
    const latest = open.at(-1)
    const resume = latest !== undefined && now - lastActivity(latest, rounds) <= RESUME_WITHIN_MS ? latest : null
    return {
        resume,
        closed: open
            .filter((record) => record !== resume)
            .map((record) => ({ ...record, endedAt: lastActivity(record, rounds) })),
    }
}

import { subDays } from 'date-fns'
import type { Dataset } from '../data/dataset'
import type { FindingRecord } from '../data/schema'
import { pointsFromResultDelta } from './rating'

const WEEK_DAYS = 7

export interface BestRound {
    roundId: string
    at: number
    n: number
    rating: number
    pointsAboveExpected: number
}

export interface WeeklyReport {
    from: Date
    to: Date
    // Rating at the end of the week minus at its start; null with no rounds.
    ratingChange: number | null
    sessions: number
    rounds: number
    bestRound: BestRound | null
    // The most recent finding that was new or newly confirmed this week.
    finding: FindingRecord | null
    // Mean absolute gap between each session's forecast and its ending rating.
    forecastError: number | null
    forecastsCompared: number
}

export const weeklyReport = (options: { dataset: Dataset; findings: FindingRecord[]; now: Date }): WeeklyReport => {
    const { dataset, findings, now } = options
    const from = subDays(now, WEEK_DAYS)
    const inWeek = (at: number): boolean => at >= from.getTime() && at <= now.getTime()
    const rounds = dataset.scored.map(({ round }) => round).filter(({ startedAt }) => inWeek(startedAt))

    const first = rounds[0]
    const last = rounds.at(-1)
    const ratingChange = first === undefined || last === undefined
        ? null
        : Math.round((last.ratingAfter?.rating ?? last.ratingBefore.rating) - first.ratingBefore.rating)

    const bestRound = rounds
        .flatMap((round): BestRound[] => round.result === null ? [] : [{
            roundId: round.id,
            at: round.startedAt,
            n: round.step.n,
            rating: Math.round(round.ratingAfter?.rating ?? round.ratingBefore.rating),
            pointsAboveExpected: Math.round(pointsFromResultDelta(round.result - round.expected)),
        }])
        .sort((a, b) => b.pointsAboveExpected - a.pointsAboveExpected)[0] ?? null

    const sessionIds = new Set(rounds.map(({ sessionId }) => sessionId))
    const forecastGaps = dataset.sessions
        .filter(({ id }) => sessionIds.has(id))
        .flatMap((session) => {
            const ending = rounds.filter(({ sessionId }) => sessionId === session.id).at(-1)?.ratingAfter?.rating
            return session.forecast === null || ending === undefined ? [] : [Math.abs(session.forecast.rating - ending)]
        })

    const finding = findings
        .filter(({ status, updatedAt }) => status !== 'faded' && inWeek(updatedAt))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null

    return {
        from,
        to: now,
        ratingChange,
        sessions: sessionIds.size,
        rounds: rounds.length,
        bestRound,
        finding,
        forecastError: forecastGaps.length === 0
            ? null
            : Math.round(forecastGaps.reduce((sum, gap) => sum + gap, 0) / forecastGaps.length),
        forecastsCompared: forecastGaps.length,
    }
}

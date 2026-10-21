import { differenceInCalendarDays, subDays } from 'date-fns'
import { dayKey } from '../format'
import { type Slice, residualPoints, roundsAfterBelow, roundsBySession } from './derive'
import { absPoints, decimal, hoursOrDays, percent, points, seconds, wholeNumber } from './display'
import { medianOf, ratio } from './measures'
import type { StatSpec } from './spec'

const MIN = { rounds: 5, quits: 1, sessions: 3, views: 3 }
const WINDOW_DAYS = 30
const WEEK_WINDOW_DAYS = 28
const DAYS_PER_WEEK = 7
const DECIMALS = { perWeek: 1 }
const RESULT_SCREENS = ['results', 'detail']
const STREAK = { one: 1, two: 2 }

export const afterBelow = (slice: Slice, streak: number): number | null => {
    const rounds = roundsAfterBelow(slice.rounds, streak)
    return rounds.length >= MIN.rounds ? residualPoints(rounds) : null
}

export const sessionGaps = (slice: Slice): number[] =>
    [...slice.sessions]
        .sort((a, b) => a.startedAt - b.startedAt)
        .flatMap((session, position, all) => {
            const previous = all[position - 1]
            return previous === undefined ? [] : [session.startedAt - previous.startedAt]
        })

export const restDays = (slice: Slice, now: Date): number | null => {
    const played = new Set(slice.rounds.map(({ startedAt }) => dayKey(startedAt)))
    const firstPlayed = [...slice.rounds].sort((a, b) => a.startedAt - b.startedAt)[0]
    if (firstPlayed === undefined) {
        return null
    }
    const span = Math.min(WINDOW_DAYS, differenceInCalendarDays(now, firstPlayed.startedAt) + 1)
    return Array.from({ length: Math.max(0, span) }, (_, back) => dayKey(subDays(now, back)))
        .filter((day) => !played.has(day)).length
}

const quits = (slice: Slice): number[] =>
    slice.rounds.flatMap(({ completed, quitAtTrial }) => (!completed && quitAtTrial !== null ? [quitAtTrial + 1] : []))

export const habitSpecs = (now: Date): StatSpec[] => [
    {
        id: 'quit-rate',
        group: 'habits',
        name: 'Rounds quit',
        technicalName: null,
        compute: (slice) => (slice.rounds.length >= MIN.rounds
            ? ratio(slice.rounds.filter(({ completed }) => !completed).length, slice.rounds.length)
            : null),
        display: (value) => percent(value),
        meaning: (value) => `You quit ${percent(value)} of the rounds you start.`,
        trend: 'daily',
    },
    {
        id: 'quit-point',
        group: 'habits',
        name: 'Where you quit',
        technicalName: null,
        compute: (slice) => {
            const quitTrials = quits(slice)
            return quitTrials.length >= MIN.quits ? medianOf(quitTrials) : null
        },
        display: (value) => `Trial ${wholeNumber(value)}`,
        meaning: (value) => `When you quit a round, it's usually around trial ${wholeNumber(value)}.`,
        trend: 'none',
        missing: { display: 'No quits yet', meaning: "You haven't quit a round." },
    },
    {
        id: 'after-one-below',
        group: 'habits',
        name: 'After a round below expected',
        technicalName: 'result vs expected',
        compute: (slice) => afterBelow(slice, STREAK.one),
        display: (value) => points(value),
        meaning: (value) => `Right after a round below expected, your next round scores ${absPoints(value)} ${value >= 0 ? 'above' : 'below'} expected.`,
        trend: 'none',
    },
    {
        id: 'after-two-below',
        group: 'habits',
        name: 'After two rounds below expected',
        technicalName: 'result vs expected',
        compute: (slice) => afterBelow(slice, STREAK.two),
        display: (value) => points(value),
        meaning: (value) => `After two rounds in a row below expected, your next round scores ${absPoints(value)} ${value >= 0 ? 'above' : 'below'} expected.`,
        trend: 'none',
    },
    {
        id: 'break-length',
        group: 'habits',
        name: 'Break between rounds',
        technicalName: null,
        compute: (slice) => {
            const breaks = slice.rounds.flatMap(({ index, breakBeforeMs }) =>
                index > 0 && breakBeforeMs !== null && breakBeforeMs >= 0 ? [breakBeforeMs] : [])
            return breaks.length >= MIN.rounds ? medianOf(breaks) : null
        },
        display: (value) => seconds(value),
        meaning: (value) => `You usually wait ${seconds(value)} before starting the next round.`,
        trend: 'daily',
    },
    {
        id: 'time-between-sessions',
        group: 'habits',
        name: 'Time between sessions',
        technicalName: null,
        compute: (slice) => {
            const gaps = sessionGaps(slice)
            return gaps.length >= MIN.sessions - 1 ? medianOf(gaps) : null
        },
        display: (value) => hoursOrDays(value),
        meaning: (value) => `Your sessions are usually ${hoursOrDays(value)} apart.`,
        trend: 'none',
        missing: { display: 'Not enough sessions yet', meaning: 'This fills in after a few sessions.' },
    },
    {
        id: 'rest-days',
        group: 'habits',
        name: 'Rest days',
        technicalName: null,
        compute: (slice) => restDays(slice, now),
        display: (value) => `${wholeNumber(value)} ${value === 1 ? 'day' : 'days'}`,
        meaning: (value) => `You took ${wholeNumber(value)} ${value === 1 ? 'day' : 'days'} off in the last ${WINDOW_DAYS} days.`,
        trend: 'none',
        missing: { display: 'No sessions yet', meaning: 'This fills in once you start playing.' },
    },
    {
        id: 'sessions-per-week',
        group: 'habits',
        name: 'Sessions per week',
        technicalName: null,
        compute: (slice) => {
            const since = subDays(now, WEEK_WINDOW_DAYS).getTime()
            return slice.sessions.length > 0
                ? slice.sessions.filter(({ startedAt }) => startedAt >= since).length / (WEEK_WINDOW_DAYS / DAYS_PER_WEEK)
                : null
        },
        display: (value) => decimal(value, DECIMALS.perWeek),
        meaning: (value) => `Over the last four weeks you've averaged ${decimal(value, DECIMALS.perWeek)} sessions a week.`,
        trend: 'none',
        missing: { display: 'No sessions yet', meaning: 'This fills in once you start playing.' },
    },
    {
        id: 'rounds-per-session',
        group: 'habits',
        name: 'Rounds per session',
        technicalName: null,
        compute: (slice) => {
            const counts = roundsBySession(slice.rounds).map((session) => session.filter(({ completed }) => completed).length)
            return counts.length > 0 ? medianOf(counts) : null
        },
        display: (value) => wholeNumber(value),
        meaning: (value) => `You usually finish ${wholeNumber(value)} ${Math.round(value) === 1 ? 'round' : 'rounds'} per session.`,
        trend: 'daily',
        missing: { display: 'No sessions yet', meaning: 'This fills in once you start playing.' },
    },
    {
        id: 'time-on-results',
        group: 'habits',
        name: 'Time reading results',
        technicalName: null,
        compute: (slice) => {
            const durations = slice.screenViews.flatMap(({ screen, enteredAt, leftAt }) =>
                RESULT_SCREENS.some((prefix) => screen.startsWith(prefix)) && leftAt !== null && leftAt >= enteredAt
                    ? [leftAt - enteredAt]
                    : [])
            return durations.length >= MIN.views ? medianOf(durations) : null
        },
        display: (value) => seconds(value),
        meaning: (value) => `You usually spend ${seconds(value)} on a round's results.`,
        trend: 'daily',
    },
]

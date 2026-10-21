import { type Slice, hoursPlayed, lastRatingOf } from './derive'
import { duration, signed, wholeNumber } from './display'
import type { StatSpec } from './spec'

const MIN = { rounds: 10, hours: 0.25, rts: 10 }
// Two rating deviations either side covers about 95%.
const RD_SPAN = 2

export const learningRate = (slice: Slice): number | null => {
    const ordered = [...slice.scored].sort((a, b) => a.round.startedAt - b.round.startedAt)
    const first = ordered[0]?.round
    const last = ordered[ordered.length - 1]?.round
    const hours = hoursPlayed(ordered.map(({ round }) => round))
    return first !== undefined && last?.ratingAfter != null && ordered.length >= MIN.rounds && hours >= MIN.hours
        ? (last.ratingAfter.rating - first.ratingBefore.rating) / hours
        : null
}

export const progressSpecs: readonly StatSpec[] = [
    {
        id: 'rating',
        group: 'progress',
        name: 'Rating',
        technicalName: 'Glicko-2 rating',
        compute: (slice) => lastRatingOf(slice.rounds)?.ratingAfter?.rating ?? null,
        display: (value) => wholeNumber(value),
        meaning: (value) => `Your rating is ${wholeNumber(value)}.`,
        trend: 'daily',
        missing: { display: 'No rounds yet', meaning: 'Your rating appears after your first round.' },
    },
    {
        id: 'rating-uncertainty',
        group: 'progress',
        name: 'Rating uncertainty',
        technicalName: 'rating deviation (RD) × 2',
        compute: (slice) => {
            const rd = lastRatingOf(slice.rounds)?.ratingAfter?.rd ?? null
            return rd === null ? null : rd * RD_SPAN
        },
        display: (value) => `±${wholeNumber(value)}`,
        meaning: (value, slice) => {
            const rating = lastRatingOf(slice.rounds)?.ratingAfter?.rating ?? null
            return rating === null
                ? `Your true rating is very likely within ${wholeNumber(value)} points of the number shown.`
                : `Your true rating is very likely within ${wholeNumber(value)} points of ${wholeNumber(rating)}.`
        },
        trend: 'daily',
        missing: { display: 'No rounds yet', meaning: 'This appears after your first round.' },
    },
    {
        id: 'learning-rate',
        group: 'progress',
        name: 'Learning rate',
        technicalName: 'rating change per hour played',
        compute: learningRate,
        display: (value) => `${signed(value)} per hour`,
        meaning: (value) => `Each hour of play has moved your rating by ${signed(value)} points on average.`,
        trend: 'none',
    },
    {
        id: 'rounds-played',
        group: 'progress',
        name: 'Rounds played',
        technicalName: null,
        compute: (slice) => (slice.scored.length > 0 ? slice.scored.length : null),
        display: (value) => wholeNumber(value),
        meaning: (value) => `You've completed ${wholeNumber(value)} ${value === 1 ? 'round' : 'rounds'}.`,
        trend: 'daily',
        missing: { display: 'No rounds yet', meaning: 'Finish a round to start your history.' },
    },
    {
        id: 'time-played',
        group: 'progress',
        name: 'Time played',
        technicalName: null,
        compute: (slice) => (slice.rounds.length > 0 ? hoursPlayed(slice.rounds) : null),
        display: (value) => duration(value),
        meaning: (value) => `You've spent ${duration(value)} in rounds.`,
        trend: 'daily',
        missing: { display: 'No rounds yet', meaning: 'Finish a round to start your history.' },
    },
]

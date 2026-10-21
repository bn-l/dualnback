import type { Dataset } from '../data/dataset'
import type { Forecast, RatingState } from '../data/schema'
import { factorModelInputs, upcomingContext, valuesFor } from './factors'
import { isEstablished } from './findings'
import { fitModel } from './model'
import { pointsFromResultDelta } from './rating'

// A contributor has to move the forecast at least this much to be named as the reason.
const MIN_REASON_POINTS = 5
const ROUND_TO = 5

const nearestFive = (points: number): number => Math.round(Math.abs(points) / ROUND_TO) * ROUND_TO

// How each factor reads as a reason: "mostly because of playing after 6pm".
const PHRASES: Readonly<Record<string, string>> = {
    'morning': 'playing before 10am',
    'evening': 'playing after 6pm',
    'weekend': 'it being the weekend',
    'first-of-day': 'this being your first round of the day',
    'long-gap': 'the days off since your last session',
}

// The forecast is your rating plus what today's known conditions are worth according to
// the model. Only established effects count (enough rounds, 95% interval clear of zero), so
// noise doesn't nudge the forecast or get named as its reason. The model's intercept (how
// far you generally run ahead of your rating) is left out, so it speaks only about today.
export const forecastSession = (options: {
    dataset: Dataset
    rating: RatingState
    now: Date
}): Forecast => {
    const { dataset, rating, now } = options
    const { table, definitions } = factorModelInputs(dataset)
    const fit = fitModel(table)
    const today = upcomingContext({ dataset, now })
    const values = valuesFor(definitions, today)

    const contributions = fit.coefficients
        .filter(isEstablished)
        .map(({ factor, mean }) => ({ factor, value: values[factor.id] ?? 0, mean }))
        .filter(({ value }) => value !== 0)
        .map(({ factor, value, mean }) => ({ factor, value, delta: mean * value }))
    const totalPoints = pointsFromResultDelta(contributions.reduce((sum, { delta }) => sum + delta, 0))
    const forecastRating = Math.round(rating.rating + totalPoints)

    const biggest = contributions
        .map((contribution) => ({ ...contribution, points: pointsFromResultDelta(contribution.delta) }))
        .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))[0]
    if (biggest === undefined || Math.abs(biggest.points) < MIN_REASON_POINTS) {
        return { rating: forecastRating, reason: null }
    }
    const phrase = PHRASES[biggest.factor.id] ?? biggest.factor.short
    const size = nearestFive(totalPoints)
    const reason = size === 0
        ? `That's about level with your rating: ${phrase} and the rest cancel out.`
        : `That's about ${size} ${totalPoints < 0 ? 'below' : 'above'} your rating, mostly because of ${phrase}.`
    return { rating: forecastRating, reason }
}

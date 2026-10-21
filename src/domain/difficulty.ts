import type { DifficultyStep } from '../data/schema'

// The ladder: every N has four steps, harder by a shorter interval and more lures.
// Neighbouring steps are 50 points apart, and each N adds 200.
const MIN_N = 1
const MAX_N = 9
const BASE_RATING = 1000
const RATING_PER_N = 200
const RATING_PER_SUBSTEP = 50
const MATCH_RATE = 0.3
const SLOW_INTERVAL_MS = 3000
const FAST_INTERVAL_MS = 2500
const FEW_LURES = 0.1
const MANY_LURES = 0.25

const SUBSTEPS: ReadonlyArray<Pick<DifficultyStep, 'intervalMs' | 'lureRate'>> = [
    { intervalMs: SLOW_INTERVAL_MS, lureRate: FEW_LURES },
    { intervalMs: SLOW_INTERVAL_MS, lureRate: MANY_LURES },
    { intervalMs: FAST_INTERVAL_MS, lureRate: FEW_LURES },
    { intervalMs: FAST_INTERVAL_MS, lureRate: MANY_LURES },
]

const nValues = Array.from({ length: MAX_N - MIN_N + 1 }, (_, offset) => MIN_N + offset)

export const LADDER: readonly DifficultyStep[] = nValues
    .flatMap((n) => SUBSTEPS.map((substep, substepIndex) => ({ n, substep, substepIndex })))
    .map(({ n, substep, substepIndex }, index) => ({
        index,
        n,
        ...substep,
        matchRate: MATCH_RATE,
        rating: BASE_RATING + (n - MIN_N) * RATING_PER_N + substepIndex * RATING_PER_SUBSTEP,
    }))

const stepAt = (index: number): DifficultyStep => {
    const step = LADDER[Math.max(0, Math.min(LADDER.length - 1, index))]
    if (step === undefined) {
        throw new Error(`Difficulty ladder has no step ${index}`)
    }
    return step
}

// The step whose rating is closest to the player's; ties go to the easier step.
export const stepForRating = (rating: number): DifficultyStep =>
    LADDER.reduce((best, step) =>
        Math.abs(step.rating - rating) < Math.abs(best.rating - rating) ? step : best, stepAt(0))

export const stretchStep = (step: DifficultyStep): DifficultyStep => stepAt(step.index + 1)

// The rating of N-back at default settings, used for goals like "5-back".
export const ratingForN = (n: number): number => stepAt((n - MIN_N) * SUBSTEPS.length).rating

export const N_RANGE = { min: MIN_N, max: MAX_N }

import { glicko2 } from 'glicko2-lite'
import type { DifficultyStep, RatingState } from '../data/schema'

export const INITIAL_RATING: RatingState = { rating: 1200, rd: 350, vol: 0.06 }

// Difficulty steps are fixed opponents: with one player, their ratings can't be learned.
const STEP_RD = 50
const TAU = 0.5
const MAX_RD = INITIAL_RATING.rd
// Glicko-2 works on a scale where 1500 is 0 and 400/ln(10) points is 1.
const GLICKO_BASE = 1500
const ELO_CLASS_WIDTH = 400
const GLICKO_SCALE = ELO_CLASS_WIDTH / Math.LN10
// Maps accuracy onto a result: slope 2 through (0.75, 0.5).
const RESULT_SLOPE = 2
const DRAW = 0.5
// Score differences are capped just short of a certain win or loss, which has no rating.
const MAX_SCORE_DELTA = 0.49
const THREE = 3

const toGlicko = (rating: number): number => (rating - GLICKO_BASE) / GLICKO_SCALE

const g = (phi: number): number => 1 / Math.sqrt(1 + (THREE * phi * phi) / (Math.PI * Math.PI))

// Glicko-2's expected result against a difficulty step.
export const expectedResult = (player: RatingState, opponentRating: number): number => {
    const phi = STEP_RD / GLICKO_SCALE
    return 1 / (1 + Math.exp(-g(phi) * (toGlicko(player.rating) - toGlicko(opponentRating))))
}

// 75% accuracy is a draw, 100% a win, 50% or below a loss.
export const resultFromAccuracy = (accuracy: number): number =>
    Math.max(0, Math.min(1, RESULT_SLOPE * accuracy - 1))

export const rateRound = (player: RatingState, step: DifficultyStep, result: number): RatingState =>
    glicko2(player.rating, player.rd, player.vol, [[step.rating, STEP_RD, result]], { tau: TAU })

// Uncertainty grows for every full day without play, as Glicko-2 does for empty rating periods.
export const afterIdleDays = (player: RatingState, days: number): RatingState =>
    Array.from({ length: Math.max(0, Math.floor(days)) }).reduce<RatingState>((state) => {
        const idle = glicko2(state.rating, state.rd, state.vol, [], { tau: TAU })
        return { ...idle, rd: Math.min(MAX_RD, idle.rd) }
    }, player)

// How many rating points a difference in average result is worth, measured around a draw.
export const pointsFromResultDelta = (delta: number): number => {
    const capped = Math.max(-MAX_SCORE_DELTA, Math.min(MAX_SCORE_DELTA, delta))
    return GLICKO_SCALE * Math.log((DRAW + capped) / (DRAW - capped))
}

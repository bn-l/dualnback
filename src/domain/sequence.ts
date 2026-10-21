import { uniformInt } from 'pure-rand/distribution/uniformInt'
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus'
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator'
import type { DifficultyStep } from '../data/schema'
import { LETTERS, SQUARE_COUNT, gridDistance, soundsAlike } from './letters'

// Bump whenever generation changes, so rounds from different generators can be told apart.
export const GENERATOR_VERSION = 1

const BASE_TRIALS = 20
// Lures are recorded at every lag up to N + 2.
const LAG_REACH = 2

export const trialCountFor = (n: number): number => BASE_TRIALS + n

export interface PlannedTrial {
    index: number
    position: number
    sound: number
    positionMatch: boolean
    soundMatch: boolean
    positionLags: number[]
    soundLags: number[]
    gridDistance: number | null
    soundAlike: boolean | null
}

const shuffled = (rng: RandomGenerator, items: readonly number[]): number[] =>
    items.reduce<number[]>((result, _, index) => {
        const swapWith = uniformInt(rng, index, items.length - 1)
        const current = result[index]
        const other = result[swapWith]
        if (current !== undefined && other !== undefined) {
            result[index] = other
            result[swapWith] = current
        }
        return result
    }, [...items])

const pick = <T>(rng: RandomGenerator, items: readonly T[]): T => {
    const item = items[uniformInt(rng, 0, items.length - 1)]
    if (item === undefined) {
        throw new Error('Cannot pick from an empty list')
    }
    return item
}

interface SenseSpec {
    n: number
    count: number
    alphabetSize: number
    matchRate: number
    lureRate: number
}

// One sense's stimuli: an exact number of N-back matches, an exact share of the remaining
// trials turned into N−1 / N+1 lures, and random non-matching stimuli everywhere else.
const senseSequence = (rng: RandomGenerator, spec: SenseSpec): number[] => {
    const { n, count, alphabetSize, matchRate, lureRate } = spec
    const eligible = Array.from({ length: count - n }, (_, offset) => n + offset)
    const matchCount = Math.round(matchRate * eligible.length)
    const [matches, rest] = ((order) => [new Set(order.slice(0, matchCount)), order.slice(matchCount)])(
        shuffled(rng, eligible))
    const lures = new Set(shuffled(rng, rest).slice(0, Math.round(lureRate * rest.length)))
    const alphabet = Array.from({ length: alphabetSize }, (_, value) => value)

    return Array.from({ length: count }).reduce<number[]>((sequence, _, index) => {
        const nBack = index >= n ? sequence[index - n] : undefined
        const lureLags = [n - 1, n + 1].filter((lag) =>
            lag >= 1 && index - lag >= 0 && sequence[index - lag] !== nBack)
        const lureLag = lures.has(index) && lureLags.length > 0 ? pick(rng, lureLags) : null
        const next = matches.has(index) && nBack !== undefined
            ? nBack
            : lureLag !== null
                ? sequence[index - lureLag]
                : pick(rng, alphabet.filter((value) => value !== nBack))
        if (next === undefined) {
            throw new Error(`Sequence generation lost track at trial ${index}`)
        }
        return [...sequence, next]
    }, [])
}

const lagsOf = (sequence: readonly number[], index: number, n: number): number[] =>
    Array.from({ length: n + LAG_REACH }, (_, offset) => offset + 1)
        .filter((lag) => lag !== n && index - lag >= 0 && sequence[index - lag] === sequence[index])

export const generateRound = (step: DifficultyStep, seed: number): PlannedTrial[] => {
    const rng = xoroshiro128plus(seed)
    const { n } = step
    const count = trialCountFor(n)
    const common = { n, count, matchRate: step.matchRate, lureRate: step.lureRate }
    const positions = senseSequence(rng, { ...common, alphabetSize: SQUARE_COUNT })
    const sounds = senseSequence(rng, { ...common, alphabetSize: LETTERS.length })

    return positions.map((position, index) => {
        const sound = sounds[index] ?? 0
        const positionBack = index >= n ? positions[index - n] : undefined
        const soundBack = index >= n ? sounds[index - n] : undefined
        return {
            index,
            position,
            sound,
            positionMatch: positionBack === position,
            soundMatch: soundBack === sound,
            positionLags: lagsOf(positions, index, n),
            soundLags: lagsOf(sounds, index, n),
            gridDistance: positionBack === undefined ? null : gridDistance(position, positionBack),
            soundAlike: soundBack === undefined ? null : soundsAlike(sound, soundBack),
        }
    })
}

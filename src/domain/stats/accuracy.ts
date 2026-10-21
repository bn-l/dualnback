import type { Sense } from '../../data/schema'
import { SENSES } from '../../data/schema'
import { LETTERS, SQUARE_COUNT } from '../letters'
import {
    type ResponseEntry,
    type Slice,
    accuracyFromCounts,
    countsFromEntries,
    countsOf,
    responsesOf,
} from './derive'
import { decimal, percent, signedPercent, absPercent, wholeNumber } from './display'
import { criterion, dPrime, ratio } from './measures'
import { type StatSpec, senseName } from './spec'

const MIN = { matches: 10, trials: 10, falseAlarms: 5 }
const CUTOFF = { clearSensitivity: 2, someSensitivity: 1, bias: 0.2 }
const DECIMALS = { short: 1 }

export const SQUARE_NAMES: readonly string[] = [
    'Top left', 'Top middle', 'Top right',
    'Middle left', 'Center', 'Middle right',
    'Bottom left', 'Bottom middle', 'Bottom right',
]

export const squareName = (square: number): string => SQUARE_NAMES[square] ?? `Square ${square + 1}`

export const letterName = (letter: number): string => (LETTERS[letter] ?? '?').toUpperCase()

const stimulusName = (sense: Sense, stimulus: number): string =>
    sense === 'position' ? squareName(stimulus) : letterName(stimulus)

const stimulusOf = (entry: ResponseEntry): number =>
    entry.sense === 'position' ? entry.trial.trial.position : entry.trial.trial.sound

// The stimulus N trials back from this entry's trial, if there was one.
export const nBackStimulus = (entry: ResponseEntry): number | null => {
    const back = entry.scored.trials[entry.trial.trial.index - entry.scored.round.step.n]
    return back === undefined ? null : entry.sense === 'position' ? back.trial.position : back.trial.sound
}

const falseAlarms = (slice: Slice, sense: Sense): ResponseEntry[] =>
    responsesOf(slice.scored, sense).filter(({ response }) => response.outcome === 'false-alarm')

const nonMatches = (slice: Slice, sense: Sense): ResponseEntry[] =>
    responsesOf(slice.scored, sense).filter(({ match }) => !match)

interface Confusion {
    pair: [number, number]
    count: number
    share: number
}

// The pair of stimuli most often mistaken for each other in false alarms.
export const topConfusion = (slice: Slice, sense: Sense): Confusion | null => {
    const alarms = falseAlarms(slice, sense)
    const tally = alarms.reduce((counts, entry) => {
        const back = nBackStimulus(entry)
        if (back === null) {
            return counts
        }
        const [low, high] = [Math.min(back, stimulusOf(entry)), Math.max(back, stimulusOf(entry))]
        const key = `${low}:${high}`
        const current = counts.get(key)
        return counts.set(key, { pair: [low, high], count: (current?.count ?? 0) + 1 })
    }, new Map<string, { pair: [number, number]; count: number }>())
    const top = [...tally.values()].sort((a, b) => b.count - a.count || a.pair[0] - b.pair[0])[0]
    return top === undefined || alarms.length < MIN.falseAlarms
        ? null
        : { ...top, share: top.count / alarms.length }
}

const hitRate = (entries: readonly ResponseEntry[]): number | null => {
    const counts = countsFromEntries(entries)
    return ratio(counts.hits, counts.hits + counts.misses)
}

const bothMatch = (entry: ResponseEntry): boolean => entry.trial.trial.positionMatch && entry.trial.trial.soundMatch

// Hit rate on trials where both senses match, minus where only one does.
export const bothMatchCost = (slice: Slice): number | null => {
    const matches = responsesOf(slice.scored).filter(({ match }) => match)
    const both = matches.filter(bothMatch)
    const single = matches.filter((entry) => !bothMatch(entry))
    const bothRate = hitRate(both)
    const singleRate = hitRate(single)
    return both.length >= MIN.matches && single.length >= MIN.matches && bothRate !== null && singleRate !== null
        ? bothRate - singleRate
        : null
}

export interface ConditionShare {
    // Share of false alarms that met the condition.
    share: number
    // How common the condition is among non-matches.
    chance: number
    matching: number
    alarms: number
}

const conditionShare = (
    slice: Slice,
    sense: Sense,
    condition: (entry: ResponseEntry) => boolean,
): ConditionShare | null => {
    const alarms = falseAlarms(slice, sense).filter((entry) => nBackStimulus(entry) !== null)
    const pool = nonMatches(slice, sense).filter((entry) => nBackStimulus(entry) !== null)
    const share = ratio(alarms.filter(condition).length, alarms.length)
    const chance = ratio(pool.filter(condition).length, pool.length)
    return alarms.length >= MIN.falseAlarms && share !== null && chance !== null
        ? { share, chance, matching: alarms.filter(condition).length, alarms: alarms.length }
        : null
}

export const nearSquareShare = (slice: Slice): ConditionShare | null =>
    conditionShare(slice, 'position', ({ trial }) => trial.trial.gridDistance === 1)

export const soundAlikeShare = (slice: Slice): ConditionShare | null =>
    conditionShare(slice, 'sound', ({ trial }) => trial.trial.soundAlike === true)

const countSpecs = (sense: Sense): StatSpec[] => {
    const name = senseName(sense)
    const word = sense === 'position' ? 'position' : 'sound'
    const specs: Array<{ key: 'hits' | 'misses' | 'falseAlarms' | 'correctRejections'; id: string; label: string; meaning: string }> = [
        { key: 'hits', id: 'hits', label: 'hits', meaning: `${word} matches you've caught` },
        { key: 'misses', id: 'misses', label: 'misses', meaning: `${word} matches you've let pass` },
        { key: 'falseAlarms', id: 'false-alarms', label: 'false alarms', meaning: `times you pressed ${word} on a non-match` },
        { key: 'correctRejections', id: 'correct-rejections', label: 'correct rejections', meaning: `${word} non-matches you rightly left alone` },
    ]
    return specs.map((spec): StatSpec => ({
        id: `${spec.id}-${sense}`,
        group: 'accuracy',
        name: `${name} ${spec.label}`,
        technicalName: null,
        compute: (slice) => (slice.scored.length > 0 ? countsOf(slice.scored, sense)[spec.key] : null),
        display: (value) => wholeNumber(value),
        meaning: (value) => `${wholeNumber(value)} ${spec.meaning} in total.`,
        trend: 'daily',
    }))
}

const senseSpecs = (sense: Sense): StatSpec[] => {
    const name = senseName(sense)
    const word = sense === 'position' ? 'position' : 'sound'
    return [
        {
            id: `accuracy-${sense}`,
            group: 'accuracy',
            name: `${name} accuracy`,
            technicalName: 'hits ÷ (hits + misses + false alarms)',
            compute: (slice) => (slice.scored.length > 0 ? accuracyFromCounts(countsOf(slice.scored, sense)) : null),
            display: (value) => percent(value),
            meaning: (value) => `Out of every ${word} hit, miss and false alarm, ${percent(value)} are hits.`,
            trend: 'daily',
        },
        {
            id: `matches-caught-${sense}`,
            group: 'accuracy',
            name: `${name} matches caught`,
            technicalName: 'hit rate',
            compute: (slice) => {
                const counts = countsOf(slice.scored, sense)
                return counts.hits + counts.misses >= MIN.matches ? ratio(counts.hits, counts.hits + counts.misses) : null
            },
            display: (value) => percent(value),
            meaning: (value) => `You catch ${percent(value)} of ${word} matches.`,
            trend: 'daily',
        },
        {
            id: `false-alarm-rate-${sense}`,
            group: 'accuracy',
            name: `${name} false-alarm rate`,
            technicalName: 'false-alarm rate',
            compute: (slice) => {
                const counts = countsOf(slice.scored, sense)
                const pool = counts.falseAlarms + counts.correctRejections
                return pool >= MIN.trials ? ratio(counts.falseAlarms, pool) : null
            },
            display: (value) => percent(value),
            meaning: (value) => `You press ${word} on ${percent(value)} of trials that aren't ${word} matches.`,
            trend: 'daily',
        },
        {
            id: `sensitivity-${sense}`,
            group: 'accuracy',
            name: `${name} sensitivity`,
            technicalName: 'd′',
            compute: (slice) => (slice.scored.length > 0 ? dPrime(countsOf(slice.scored, sense)) : null),
            display: (value) => decimal(value, DECIMALS.short),
            meaning: (value) => value >= CUTOFF.clearSensitivity
                ? `You tell ${word} matches from non-matches clearly.`
                : value >= CUTOFF.someSensitivity
                    ? `You tell ${word} matches from non-matches, with some overlap.`
                    : `${name} matches and non-matches still blur together for you.`,
            trend: 'daily',
        },
        {
            id: `caution-${sense}`,
            group: 'accuracy',
            name: `${name} caution`,
            technicalName: 'criterion c',
            compute: (slice) => (slice.scored.length > 0 ? criterion(countsOf(slice.scored, sense)) : null),
            display: (value) => decimal(value, DECIMALS.short),
            meaning: (value) => value > CUTOFF.bias
                ? `You lean toward holding back on ${word}: you'd rather miss than guess.`
                : value < -CUTOFF.bias
                    ? `You lean toward pressing on ${word}: you'd rather guess than miss.`
                    : `You're balanced between pressing and holding back on ${word}.`,
            trend: 'daily',
        },
        ...countSpecs(sense),
    ]
}

const stimulusSpecs = (sense: Sense): StatSpec[] =>
    Array.from({ length: sense === 'position' ? SQUARE_COUNT : LETTERS.length }, (_, stimulus): StatSpec => ({
        id: sense === 'position' ? `square-${stimulus}` : `letter-${LETTERS[stimulus] ?? stimulus}`,
        group: 'accuracy',
        name: sense === 'position' ? `${squareName(stimulus)} square` : `Letter ${letterName(stimulus)}`,
        technicalName: null,
        compute: (slice) => {
            const counts = countsFromEntries(responsesOf(slice.scored, sense)
                .filter((entry) => stimulusOf(entry) === stimulus))
            return counts.hits + counts.misses + counts.falseAlarms >= MIN.trials ? accuracyFromCounts(counts) : null
        },
        display: (value) => percent(value),
        meaning: (value) => sense === 'position'
            ? `Your position accuracy is ${percent(value)} when the ${squareName(stimulus).toLowerCase()} square lights up.`
            : `Your sound accuracy is ${percent(value)} when the letter is ${letterName(stimulus)}.`,
        trend: 'daily',
    }))

const confusionSpec = (sense: Sense): StatSpec => {
    const pairName = (slice: Slice): string => {
        const top = topConfusion(slice, sense)
        return top === null
            ? 'None yet'
            : `${stimulusName(sense, top.pair[0])} and ${stimulusName(sense, top.pair[1]).toLowerCase()}`
    }
    return {
        id: `confusion-${sense}`,
        group: 'accuracy',
        name: sense === 'position' ? 'Squares you mix up' : 'Letters you mix up',
        technicalName: 'confusion matrix, top pair',
        compute: (slice) => topConfusion(slice, sense)?.share ?? null,
        display: (_, slice) => (sense === 'position' ? pairName(slice) : pairName(slice).toUpperCase()),
        meaning: (value, slice) =>
            `${absPercent(value)} of your ${sense} false alarms mix up ${sense === 'position' ? pairName(slice).toLowerCase() : pairName(slice).toUpperCase()}.`,
        trend: 'daily',
        missing: { display: 'Not enough false alarms yet', meaning: 'This fills in once you have a few false alarms.' },
    }
}

export const accuracySpecs: readonly StatSpec[] = [
    {
        id: 'accuracy',
        group: 'accuracy',
        name: 'Accuracy',
        technicalName: 'hits ÷ (hits + misses + false alarms)',
        compute: (slice) => (slice.scored.length > 0 ? accuracyFromCounts(countsOf(slice.scored)) : null),
        display: (value) => percent(value),
        meaning: (value) => `This is the accuracy your rating uses: ${percent(value)} of your hits, misses and false alarms are hits.`,
        trend: 'daily',
    },
    ...SENSES.flatMap(senseSpecs),
    {
        id: 'both-match-cost',
        group: 'accuracy',
        name: 'Both-match cost',
        technicalName: 'dual-match cost',
        compute: bothMatchCost,
        display: (value) => signedPercent(value),
        meaning: (value) => value < 0
            ? `When both senses match on the same trial, you catch ${absPercent(value)} fewer matches than when only one does.`
            : `When both senses match on the same trial, you catch ${absPercent(value)} more matches than when only one does.`,
        trend: 'daily',
    },
    ...SENSES.flatMap(stimulusSpecs),
    ...SENSES.map(confusionSpec),
    {
        id: 'near-square-errors',
        group: 'accuracy',
        name: 'Near-square errors',
        technicalName: null,
        compute: (slice) => nearSquareShare(slice)?.share ?? null,
        display: (value) => percent(value),
        meaning: (value, slice) => `${percent(value)} of your position false alarms come when the square is next to the one N back, against ${percent(nearSquareShare(slice)?.chance ?? 0)} of non-matches.`,
        trend: 'daily',
        missing: { display: 'Not enough false alarms yet', meaning: 'This fills in once you have a few position false alarms.' },
    },
    {
        id: 'sound-alike-errors',
        group: 'accuracy',
        name: 'Sound-alike errors',
        technicalName: null,
        compute: (slice) => soundAlikeShare(slice)?.share ?? null,
        display: (value) => percent(value),
        meaning: (value, slice) => `${percent(value)} of your sound false alarms come when the letter rhymes with the one N back, against ${percent(soundAlikeShare(slice)?.chance ?? 0)} of non-matches.`,
        trend: 'daily',
        missing: { display: 'Not enough false alarms yet', meaning: 'This fills in once you have a few sound false alarms.' },
    },
]

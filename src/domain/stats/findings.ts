import { subDays } from 'date-fns'
import { probit, tTestTwoSample } from 'simple-statistics'
import type { Dataset } from '../../data/dataset'
import type { Sense } from '../../data/schema'
import { SENSES } from '../../data/schema'
import type { Evidence, Finding } from '../analysis-types'
import { basis, dayKey } from '../format'
import { LETTERS, SQUARE_COUNT } from '../letters'
import type { ScoredRound } from '../scoring'
import { type ConditionShare, letterName, nearSquareShare, soundAlikeShare, squareName } from './accuracy'
import {
    type ResponseEntry,
    type Slice,
    countsOf,
    hitRts,
    isErrorTrial,
    lastRatingOf,
    pressed,
    responsesOf,
    rtsOf,
    thirdOf,
    THIRDS,
    withOutcome,
} from './derive'
import { absMs, absPercent, decimal, milliseconds, percent, wholeNumber } from './display'
import { LURE_OFFSETS, afterErrorRts, clusterZ, lureRate, offsetLabel, plainRate } from './errors'
import {
    type Proportion,
    Z_95,
    criterion,
    dPrime,
    exGaussianTau,
    excludesZero,
    medianOf,
    meanInterval,
    meanOf,
    proportionZ,
    ratio,
    sdOf,
    twoProportionZ,
} from './measures'
import { BANDS, SPEED_BANDS, holdBy, pressOrder, rightShare } from './speed'

// Lower tail of a two-sided 95% test.
const LOWER_TAIL_95 = 0.025

// Every finding here needs at least this many completed rounds behind it, and then passes
// its own test, noted beside it. Tests are two-sided at 95% (|z| ≥ 1.96) unless noted.
const MIN_ROUNDS = 10

const MIN = {
    stimulusMatches: 15,
    pressOrderTrials: 15,
    holdPresses: 20,
    roundsWithThirds: 10,
    rtsPerThird: 3,
    priorBaselines: 5,
    predictions: 5,
    unfocusedRounds: 5,
    feelGroup: 3,
    nullFeelRounds: 20,
}

const EFFECT = {
    // Ratio between two error rates worth reporting as "n times as often".
    timesAsOften: 2,
    lureOverPlain: 1.5,
    chanceMultiple: 1.5,
    criterion: 0.5,
    guessShare: 0.6,
    holdMs: 10,
    slowdownMs: 20,
    baselineMs: 15,
    relativeChange: 0.1,
    flatChange: 0.03,
    ratingPoints: 25,
    // Correlation below this, with enough rounds, means feel tells you little.
    weakCorrelation: 0.1,
}

const HALF = 0.5
const WINDOW_DAYS = 30
const PRIOR_WINDOW_END_DAYS = WINDOW_DAYS + WINDOW_DAYS
const DECIMALS = { times: 1 }

interface Context {
    dataset: Dataset
    now: Date
    scored: ScoredRound[]
}

const sliceOf = (scored: ScoredRound[]): Slice => ({ scored, rounds: [], sessions: [], baselines: [], screenViews: [] })

const basisOf = (scored: readonly ScoredRound[]): string => {
    const first = scored[0]?.round.startedAt
    const last = scored[scored.length - 1]?.round.startedAt
    return first === undefined || last === undefined ? 'From no rounds yet.' : basis(scored.length, first, last)
}

const bar = (label: string, value: number, display: string): Evidence => ({ label, value, display })

const timesOrPercent = (higher: number, lower: number): string => {
    const times = lower > 0 ? higher / lower : Number.POSITIVE_INFINITY
    return times >= EFFECT.timesAsOften && Number.isFinite(times)
        ? `${decimal(times, 0)} times as often as`
        : `${percent(times - 1)} more often than`
}

// Clustered errors: combined runs-test z across rounds ≤ −1.96.
const errorsClustered = ({ scored }: Context): Finding | null => {
    const cluster = clusterZ(scored)
    if (cluster === null || cluster.z > -Z_95) {
        return null
    }
    const trials = scored.flatMap((round) => round.trials)
    const afterError = scored.flatMap((round) => round.trials.flatMap((trial, position) => {
        const previous = round.trials[position - 1]
        return previous !== undefined && isErrorTrial(trial) ? [isErrorTrial(previous)] : []
    }))
    const errorRate = ratio(trials.filter(isErrorTrial).length, trials.length) ?? 0
    const followShare = ratio(afterError.filter((value) => value).length, afterError.length) ?? 0
    return {
        id: 'why-errors-clustered',
        kind: 'why-you-miss',
        sentence: 'Your errors come in clusters. Those are lapses of focus, not memory limits.',
        effectPoints: null,
        evidence: [
            bar('Errors right after an error', followShare, percent(followShare)),
            bar('Error rate overall', errorRate, percent(errorRate)),
        ],
        basis: basisOf(scored),
        controllable: false,
    }
}

// N−1 against N+1 lures: two-proportion z test on their false-alarm rates.
const lureSides = ({ scored }: Context): Finding | null => {
    const minus = lureRate(scored, -1)
    const plus = lureRate(scored, 1)
    if (minus === null || plus === null) {
        return null
    }
    const z = twoProportionZ(
        { successes: minus.falseAlarms, total: minus.trials },
        { successes: plus.falseAlarms, total: plus.trials })
    if (z === null || Math.abs(z) < Z_95) {
        return null
    }
    const [worse, better] = minus.rate > plus.rate ? [-1, 1] : [1, -1]
    const worseRate = Math.max(minus.rate, plus.rate)
    const betterRate = Math.min(minus.rate, plus.rate)
    return {
        id: 'why-lure-minus-1-vs-plus-1',
        kind: 'why-you-miss',
        sentence: `${offsetLabel(worse)} lures catch you ${timesOrPercent(worseRate, betterRate)} ${offsetLabel(better)}.`,
        effectPoints: null,
        evidence: [
            bar(`${offsetLabel(-1)} lures`, minus.rate, percent(minus.rate)),
            bar(`${offsetLabel(1)} lures`, plus.rate, percent(plus.rate)),
        ],
        basis: basisOf(scored),
        controllable: false,
    }
}

// Lures against other non-matches: z ≥ 1.96 and at least 1.5 times the rate.
const luresOverPlain = ({ scored }: Context): Finding | null => {
    const lures = LURE_OFFSETS.filter((offset) => Math.abs(offset) === 1)
        .map((offset) => lureRate(scored, offset))
        .reduce<Proportion>((sum, rate) =>
            rate === null ? sum : { successes: sum.successes + rate.falseAlarms, total: sum.total + rate.trials },
        { successes: 0, total: 0 })
    const plain = plainRate(scored)
    const lureShare = ratio(lures.successes, lures.total)
    if (plain === null || lureShare === null || plain.rate <= 0) {
        return null
    }
    const z = twoProportionZ(lures, { successes: plain.falseAlarms, total: plain.trials })
    if (z === null || z < Z_95 || lureShare < plain.rate * EFFECT.lureOverPlain) {
        return null
    }
    return {
        id: 'why-lures-over-plain',
        kind: 'why-you-miss',
        sentence: `Near-miss lures trigger ${decimal(lureShare / plain.rate, DECIMALS.times)} times as many false alarms as other non-matches.`,
        effectPoints: null,
        evidence: [
            bar('Lures one step off N', lureShare, percent(lureShare)),
            bar('Other non-matches', plain.rate, percent(plain.rate)),
        ],
        basis: basisOf(scored),
        controllable: false,
    }
}

const matchesOn = (scored: readonly ScoredRound[], sense: Sense, stimulus: number): Proportion => {
    const matches = responsesOf(scored, sense).filter(({ match, trial }) =>
        match && (sense === 'position' ? trial.trial.position : trial.trial.sound) === stimulus)
    return { successes: matches.filter(({ response }) => response.outcome === 'hit').length, total: matches.length }
}

// The weakest square or letter: hit rate there against everywhere else, with at least 15
// matches on it. Nine squares (or eight letters) are scanned at once, so the 95% threshold
// is Bonferroni-corrected for that many tests: about z ≤ −2.77 for squares.
const weakStimulus = (sense: Sense) => ({ scored }: Context): Finding | null => {
    const count = sense === 'position' ? SQUARE_COUNT : LETTERS.length
    const threshold = probit(LOWER_TAIL_95 / count)
    const all = countsOf(scored, sense)
    const candidates = Array.from({ length: count }, (_, stimulus) => {
        const here = matchesOn(scored, sense, stimulus)
        const rest = { successes: all.hits - here.successes, total: all.hits + all.misses - here.total }
        return { stimulus, here, rest, z: here.total >= MIN.stimulusMatches ? twoProportionZ(here, rest) : null }
    }).filter(({ z }) => z !== null && z <= threshold)
        .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
    const weakest = candidates[0]
    if (weakest === undefined) {
        return null
    }
    const hereRate = weakest.here.successes / weakest.here.total
    const restRate = ratio(weakest.rest.successes, weakest.rest.total) ?? 0
    const name = sense === 'position' ? squareName(weakest.stimulus) : letterName(weakest.stimulus)
    return {
        id: sense === 'position' ? 'why-weak-square' : 'why-weak-letter',
        kind: 'why-you-miss',
        sentence: sense === 'position'
            ? `The ${name.toLowerCase()} square is your weak spot. You catch ${percent(hereRate)} of matches there, against ${percent(restRate)} elsewhere.`
            : `Matches on the letter ${name} get missed most. You catch ${percent(hereRate)} of them, against ${percent(restRate)} for other letters.`,
        effectPoints: null,
        evidence: [
            bar(sense === 'position' ? `${name} square` : `Letter ${name}`, hereRate, percent(hereRate)),
            bar(sense === 'position' ? 'Other squares' : 'Other letters', restRate, percent(restRate)),
        ],
        basis: basisOf(scored),
        controllable: false,
    }
}

// Response bias: per-round criterion c averaged, |mean| ≥ 0.5 with a 95% interval excluding 0.
const bias = (sense: Sense) => ({ scored }: Context): Finding | null => {
    const perRound = scored.flatMap(({ counts }) => {
        const c = criterion(counts[sense])
        return c === null ? [] : [c]
    })
    const interval = meanInterval(perRound)
    if (interval === null || !excludesZero(interval) || Math.abs(interval.mean) < EFFECT.criterion) {
        return null
    }
    const counts = countsOf(scored, sense)
    const hitRate = ratio(counts.hits, counts.hits + counts.misses) ?? 0
    const falseAlarmRate = ratio(counts.falseAlarms, counts.falseAlarms + counts.correctRejections) ?? 0
    const cautious = interval.mean > 0
    return {
        id: `why-${cautious ? 'cautious' : 'eager'}-${sense}`,
        kind: 'why-you-miss',
        sentence: cautious
            ? `You're cautious on ${sense}: you'd rather miss than guess.`
            : `You're quick to press on ${sense}: you'd rather guess than miss.`,
        effectPoints: null,
        evidence: [
            bar('Matches caught', hitRate, percent(hitRate)),
            bar('False alarms', falseAlarmRate, percent(falseAlarmRate)),
        ],
        basis: basisOf(scored),
        controllable: true,
    }
}

// Near-square or rhyming false alarms: share against chance, z ≥ 1.96 and 1.5 times chance.
const overChance = (options: {
    id: string
    measure: (slice: Slice) => ConditionShare | null
    sentence: (share: number, chance: number) => string
}) => ({ scored }: Context): Finding | null => {
    const result = options.measure(sliceOf(scored))
    if (result === null || result.chance <= 0 || result.share < result.chance * EFFECT.chanceMultiple) {
        return null
    }
    const z = proportionZ({ successes: result.matching, total: result.alarms }, result.chance)
    return z === null || z < Z_95
        ? null
        : {
            id: options.id,
            kind: 'why-you-miss',
            sentence: options.sentence(result.share, result.chance),
            effectPoints: null,
            evidence: [
                bar('Your false alarms', result.share, percent(result.share)),
                bar('Share of non-matches', result.chance, percent(result.chance)),
            ],
            basis: basisOf(scored),
            controllable: false,
        }
}

// Both senses matching at once: hit rate against single matches, z ≤ −1.96.
const bothMatch = ({ scored }: Context): Finding | null => {
    const matches = responsesOf(scored).filter(({ match }) => match)
    const isBoth = (entry: ResponseEntry): boolean => entry.trial.trial.positionMatch && entry.trial.trial.soundMatch
    const proportion = (entries: readonly ResponseEntry[]): Proportion => ({
        successes: entries.filter(({ response }) => response.outcome === 'hit').length,
        total: entries.length,
    })
    const both = proportion(matches.filter(isBoth))
    const single = proportion(matches.filter((entry) => !isBoth(entry)))
    const z = twoProportionZ(both, single)
    const bothRate = ratio(both.successes, both.total)
    const singleRate = ratio(single.successes, single.total)
    if (z === null || z > -Z_95 || bothRate === null || singleRate === null) {
        return null
    }
    return {
        id: 'why-both-match',
        kind: 'why-you-miss',
        sentence: `When both senses match at once, you catch ${absPercent(singleRate - bothRate)} fewer matches.`,
        effectPoints: null,
        evidence: [
            bar('Both match', bothRate, percent(bothRate)),
            bar('One matches', singleRate, percent(singleRate)),
        ],
        basis: basisOf(scored),
        controllable: false,
    }
}

// Slow presses: share right above 800 ms against faster presses, z ≤ −1.96.
const slowPresses = ({ scored }: Context): Finding | null => {
    const entries = responsesOf(scored)
    const slow = rightShare(entries, BANDS.slow)
    const faster = rightShare(entries, { min: BANDS.fast.min, max: BANDS.slow.min })
    if (slow === null || faster === null) {
        return null
    }
    const z = twoProportionZ(
        { successes: Math.round(slow.share * slow.count), total: slow.count },
        { successes: Math.round(faster.share * faster.count), total: faster.count })
    if (z === null || z > -Z_95) {
        return null
    }
    const tail = slow.share < EFFECT.guessShare
        ? ' Slow presses are mostly guesses.'
        : ` Your quicker presses are right ${percent(faster.share)} of the time.`
    return {
        id: 'timing-slow-presses',
        kind: 'timing',
        sentence: `When you take longer than ${SPEED_BANDS.slow} ms to press, you're right only ${percent(slow.share)} of the time.${tail}`,
        effectPoints: null,
        evidence: [
            bar(`Under ${SPEED_BANDS.slow} ms`, faster.share, percent(faster.share)),
            bar(`Over ${SPEED_BANDS.slow} ms`, slow.share, percent(slow.share)),
        ],
        basis: basisOf(scored),
        controllable: true,
    }
}

// Hold time on wrong against right presses: two-sample t ≥ 1.96 in size, 20+ presses
// each, and a difference of at least 10 ms.
const holdLonger = ({ scored }: Context): Finding | null => {
    const entries = responsesOf(scored)
    const right = holdBy(entries, 'hit')
    const wrong = holdBy(entries, 'false-alarm')
    const t = right.length >= MIN.holdPresses && wrong.length >= MIN.holdPresses ? tTestTwoSample(wrong, right) : null
    const rightMedian = medianOf(right)
    const wrongMedian = medianOf(wrong)
    if (t === null || Number.isNaN(t) || Math.abs(t) < Z_95 || rightMedian === null || wrongMedian === null ||
        Math.abs(wrongMedian - rightMedian) < EFFECT.holdMs) {
        return null
    }
    const keyboard = pressed(entries).filter(({ response }) => response.press?.input === 'keyboard').length
    const thing = keyboard >= pressed(entries).length * HALF ? 'the key' : 'your press'
    return {
        id: 'timing-hold-wrong',
        kind: 'timing',
        sentence: `You hold ${thing} ${absMs(wrongMedian - rightMedian)} ${wrongMedian > rightMedian ? 'longer' : 'shorter'} on wrong answers.`,
        effectPoints: null,
        evidence: [
            bar('Right presses', rightMedian, milliseconds(rightMedian)),
            bar('Wrong presses', wrongMedian, milliseconds(wrongMedian)),
        ],
        basis: basisOf(scored),
        controllable: false,
    }
}

const thirdMedian = (round: ScoredRound, third: number): number | null => {
    const rts = rtsOf(withOutcome(responsesOf([round]), ['hit']).filter(({ trial }) => thirdOf(trial, round) === third))
    return rts.length >= MIN.rtsPerThird ? medianOf(rts) : null
}

// Slowing through a round: per-round last-third minus first-third median, 95% interval
// excluding 0 over 10+ rounds, and at least 20 ms.
const slowsLate = ({ scored }: Context): Finding | null => {
    const changes = scored.flatMap((round) => {
        const first = thirdMedian(round, 0)
        const last = thirdMedian(round, THIRDS - 1)
        return first !== null && last !== null ? [last - first] : []
    })
    const interval = changes.length >= MIN.roundsWithThirds ? meanInterval(changes) : null
    if (interval === null || !excludesZero(interval) || Math.abs(interval.mean) < EFFECT.slowdownMs) {
        return null
    }
    const typical = medianOf(hitRts(scored)) ?? 0
    return {
        id: 'timing-slows-late',
        kind: 'timing',
        sentence: interval.mean > 0
            ? `Your reaction time slows by ${absMs(interval.mean)} in the last third of a round.`
            : `Your reaction time speeds up by ${absMs(interval.mean)} in the last third of a round.`,
        effectPoints: null,
        evidence: [
            bar('First third', typical, milliseconds(typical)),
            bar('Last third', typical + interval.mean, milliseconds(typical + interval.mean)),
        ],
        basis: basisOf(scored),
        controllable: false,
    }
}

// Press order when both match: share position-first against 50%, |z| ≥ 1.96, 15+ trials.
const firstPress = ({ scored }: Context): Finding | null => {
    const order = pressOrder(responsesOf(scored))
    const z = order.total >= MIN.pressOrderTrials
        ? proportionZ({ successes: order.positionFirst, total: order.total }, HALF)
        : null
    const gap = medianOf(order.gaps)
    if (z === null || Math.abs(z) < Z_95 || gap === null) {
        return null
    }
    const positionShare = order.positionFirst / order.total
    const [first, second] = positionShare >= HALF ? ['position', 'sound'] : ['sound', 'position']
    return {
        id: 'timing-press-order',
        kind: 'timing',
        sentence: `When both match, you press ${first} first, and your ${second} press comes ${milliseconds(gap)} later.`,
        effectPoints: null,
        evidence: [
            bar('Position first', positionShare, percent(positionShare)),
            bar('Sound first', 1 - positionShare, percent(1 - positionShare)),
        ],
        basis: basisOf(scored),
        controllable: false,
    }
}

// Slowing after an error: two-sample t ≥ 1.96 and at least 20 ms.
const afterError = ({ scored }: Context): Finding | null => {
    const groups = afterErrorRts(scored)
    const t = groups.afterError.length >= MIN.holdPresses && groups.afterCorrect.length >= MIN.holdPresses
        ? tTestTwoSample(groups.afterError, groups.afterCorrect)
        : null
    const slowed = medianOf(groups.afterError)
    const normal = medianOf(groups.afterCorrect)
    if (t === null || Number.isNaN(t) || t < Z_95 || slowed === null || normal === null ||
        slowed - normal < EFFECT.slowdownMs) {
        return null
    }
    return {
        id: 'timing-post-error',
        kind: 'timing',
        sentence: `After an error, you slow down by ${absMs(slowed - normal)} on the next trial.`,
        effectPoints: null,
        evidence: [
            bar('After a right trial', normal, milliseconds(normal)),
            bar('After an error', slowed, milliseconds(slowed)),
        ],
        basis: basisOf(scored),
        controllable: false,
    }
}

// Today's simple reaction time against your earlier tests: |z| ≥ 1.96 against their spread,
// at least 15 ms, and at least 5 earlier tests.
const baselineToday = ({ dataset, now }: Context): Finding | null => {
    const today = dayKey(now)
    const values = (todayOnly: boolean): number[] => dataset.baselines.flatMap(({ at, medianRt }) =>
        medianRt !== null && (dayKey(at) === today) === todayOnly ? [medianRt] : [])
    const previous = values(false)
    const current = medianOf(values(true))
    const usual = medianOf(previous)
    const spread = sdOf(previous)
    if (previous.length < MIN.priorBaselines || current === null || usual === null || spread === null || spread <= 0) {
        return null
    }
    const difference = current - usual
    if (Math.abs(difference / spread) < Z_95 || Math.abs(difference) < EFFECT.baselineMs) {
        return null
    }
    return {
        id: 'timing-baseline-today',
        kind: 'timing',
        sentence: `Your simple reaction time is ${absMs(difference)} ${difference > 0 ? 'slower' : 'faster'} than usual today.`,
        effectPoints: null,
        evidence: [
            bar('Usual', usual, milliseconds(usual)),
            bar('Today', current, milliseconds(current)),
        ],
        basis: `From ${previous.length + 1} reaction tests.`,
        controllable: false,
    }
}

interface Skill {
    name: string
    measure: (scored: ScoredRound[]) => number | null
    // Higher is better for d′; lower is better for rates and times.
    higherIsBetter: boolean
    display: (value: number) => string
}

const SKILLS: readonly Skill[] = [
    {
        name: 'lure resistance',
        measure: (scored) => {
            const rates = LURE_OFFSETS.filter((offset) => Math.abs(offset) === 1).map((offset) => lureRate(scored, offset))
            const totals = rates.reduce((sum, rate) => rate === null ? sum
                : { alarms: sum.alarms + rate.falseAlarms, trials: sum.trials + rate.trials }, { alarms: 0, trials: 0 })
            return ratio(totals.alarms, totals.trials)
        },
        higherIsBetter: false,
        display: (value) => `${percent(value)} lure false alarms`,
    },
    {
        name: 'speed',
        measure: (scored) => medianOf(hitRts(scored)),
        higherIsBetter: false,
        display: (value) => milliseconds(value),
    },
    {
        name: 'sensitivity',
        measure: (scored) => meanOf(SENSES.flatMap((sense) => {
            const value = dPrime(countsOf(scored, sense))
            return value === null ? [] : [value]
        })),
        higherIsBetter: true,
        display: (value) => `d′ ${decimal(value, 1)}`,
    },
    {
        name: 'slow tail',
        measure: (scored) => exGaussianTau(hitRts(scored)),
        higherIsBetter: false,
        display: (value) => milliseconds(value),
    },
]

const windows = ({ scored, now }: Context): { recent: ScoredRound[]; prior: ScoredRound[] } => {
    const recentStart = subDays(now, WINDOW_DAYS).getTime()
    const priorStart = subDays(now, PRIOR_WINDOW_END_DAYS).getTime()
    return {
        recent: scored.filter(({ round }) => round.startedAt >= recentStart),
        prior: scored.filter(({ round }) => round.startedAt >= priorStart && round.startedAt < recentStart),
    }
}

// Month-on-month skill change: at least 10 rounds in each 30-day window, and a relative
// change of 10% or more. A skill within 3% counts as flat.
const skillChange = (context: Context): Finding | null => {
    const { recent, prior } = windows(context)
    if (recent.length < MIN_ROUNDS || prior.length < MIN_ROUNDS) {
        return null
    }
    const changes = SKILLS.flatMap((skill) => {
        const before = skill.measure(prior)
        const after = skill.measure(recent)
        if (before === null || after === null || before === 0) {
            return []
        }
        const improvement = (skill.higherIsBetter ? after - before : before - after) / Math.abs(before)
        return Number.isFinite(improvement) ? [{ skill, before, after, improvement }] : []
    })
    const best = [...changes].sort((a, b) => b.improvement - a.improvement)[0]
    if (best === undefined || best.improvement < EFFECT.relativeChange) {
        return null
    }
    const flat = changes.find(({ improvement }) => Math.abs(improvement) < EFFECT.flatChange)
    const flatText = flat === undefined ? '' : ` Your ${flat.skill.name} stayed flat.`
    const capitalized = `${best.skill.name.charAt(0).toUpperCase()}${best.skill.name.slice(1)}`
    return {
        id: 'progress-skill-change',
        kind: 'progress',
        sentence: `Your ${best.skill.name} improved ${percent(best.improvement)} this month.${flatText}`,
        effectPoints: null,
        evidence: [
            bar(`${capitalized}, previous 30 days`, best.before, best.skill.display(best.before)),
            bar(`${capitalized}, last 30 days`, best.after, best.skill.display(best.after)),
        ],
        basis: basisOf([...prior, ...recent]),
        controllable: false,
    }
}

// Rating over the last 30 days: 10+ rounds in the window and a change of 25+ points
// (half a difficulty step).
const ratingChange = (context: Context): Finding | null => {
    const { recent } = windows(context)
    const start = recent[0]?.round.ratingBefore.rating
    const end = lastRatingOf(recent.map(({ round }) => round))?.ratingAfter?.rating
    if (recent.length < MIN_ROUNDS || start === undefined || end === undefined ||
        Math.abs(end - start) < EFFECT.ratingPoints) {
        return null
    }
    return {
        id: 'progress-rating-month',
        kind: 'progress',
        sentence: `Your rating ${end > start ? 'rose' : 'fell'} ${wholeNumber(Math.abs(end - start))} points over the last 30 days.`,
        effectPoints: end - start,
        evidence: [
            bar('30 days ago', start, wholeNumber(start)),
            bar('Now', end, wholeNumber(end)),
        ],
        basis: basisOf(recent),
        controllable: false,
    }
}

const FINDERS: ReadonlyArray<(context: Context) => Finding | null> = [
    errorsClustered,
    lureSides,
    luresOverPlain,
    weakStimulus('position'),
    weakStimulus('sound'),
    ...SENSES.map(bias),
    overChance({
        id: 'why-near-square',
        measure: nearSquareShare,
        sentence: (share, chance) =>
            `${percent(share)} of your position false alarms come when the square is next to the one N back, against ${percent(chance)} of non-matches.`,
    }),
    overChance({
        id: 'why-sound-alike',
        measure: soundAlikeShare,
        sentence: (share, chance) =>
            `C and T trip you up: ${percent(share)} of your sound false alarms come when the letters rhyme, against ${percent(chance)} of non-matches.`,
    }),
    bothMatch,
    slowPresses,
    holdLonger,
    slowsLate,
    firstPress,
    afterError,
    skillChange,
    ratingChange,
]

export const statFindings = (dataset: Dataset, now: Date): Finding[] => {
    const scored = [...dataset.scored].sort((a, b) => a.round.startedAt - b.round.startedAt)
    const context: Context = { dataset, now, scored }
    const roundFinders = scored.length >= MIN_ROUNDS ? FINDERS : []
    return [...roundFinders.map((find) => find(context)), baselineToday(context)]
        .flatMap((finding) => (finding === null ? [] : [finding]))
}

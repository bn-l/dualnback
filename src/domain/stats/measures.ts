import {
    mean,
    median,
    probit,
    sampleCorrelation,
    sampleSkewness,
    sampleStandardDeviation,
} from 'simple-statistics'

// Statistical building blocks. Every function returns null rather than NaN or Infinity
// when the data can't support an answer, so nothing downstream has to guess.

const SAMPLE_MIN = { sd: 2, skew: 3, correlation: 3 }
// Two-sided 95%.
export const Z_95 = 1.96
// The log-linear correction (Hautus 1995) adds half a count to each cell.
const LOG_LINEAR = { add: 0.5, extra: 1 }
const HALF = 0.5
const SKEW_TO_TAU = { divisor: 2, root: 3 }
// The runs test's expected count uses twice the product of the two group sizes.
const RUNS_PAIRS = 2

export const finiteOrNull = (value: number | null | undefined): number | null =>
    value !== null && value !== undefined && Number.isFinite(value) ? value : null

export const medianOf = (values: readonly number[]): number | null =>
    values.length > 0 ? finiteOrNull(median(values)) : null

export const meanOf = (values: readonly number[]): number | null =>
    values.length > 0 ? finiteOrNull(mean(values)) : null

export const sdOf = (values: readonly number[]): number | null =>
    values.length >= SAMPLE_MIN.sd ? finiteOrNull(sampleStandardDeviation(values)) : null

export const correlationOf = (xs: readonly number[], ys: readonly number[]): number | null => {
    const sdX = sdOf(xs)
    const sdY = sdOf(ys)
    return xs.length === ys.length && xs.length >= SAMPLE_MIN.correlation && sdX !== null && sdX > 0 &&
        sdY !== null && sdY > 0
        ? finiteOrNull(sampleCorrelation(xs, ys))
        : null
}

export const ratio = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null)

export const difference = (a: number | null, b: number | null): number | null =>
    a !== null && b !== null ? finiteOrNull(a - b) : null

interface SignalCounts {
    hits: number
    misses: number
    falseAlarms: number
    correctRejections: number
}

const correctedRates = (counts: SignalCounts): { hit: number; falseAlarm: number } => ({
    hit: (counts.hits + LOG_LINEAR.add) / (counts.hits + counts.misses + LOG_LINEAR.extra),
    falseAlarm: (counts.falseAlarms + LOG_LINEAR.add) /
        (counts.falseAlarms + counts.correctRejections + LOG_LINEAR.extra),
})

const hasSignalData = (counts: SignalCounts): boolean =>
    counts.hits + counts.misses > 0 && counts.falseAlarms + counts.correctRejections > 0

// Sensitivity: how far apart matches and non-matches are for you, in standard deviations.
export const dPrime = (counts: SignalCounts): number | null => {
    const rates = correctedRates(counts)
    return hasSignalData(counts) ? finiteOrNull(probit(rates.hit) - probit(rates.falseAlarm)) : null
}

// Response bias: positive means you hold back, negative means you press readily.
export const criterion = (counts: SignalCounts): number | null => {
    const rates = correctedRates(counts)
    return hasSignalData(counts) ? finiteOrNull(-HALF * (probit(rates.hit) + probit(rates.falseAlarm))) : null
}

// The exponential tail of an ex-Gaussian fit by method of moments: τ = sd · (skew / 2)^(1/3).
// Without positive skew there is no tail to measure.
export const exGaussianTau = (values: readonly number[]): number | null => {
    if (values.length < SAMPLE_MIN.skew) {
        return null
    }
    const sd = sdOf(values)
    const skew = finiteOrNull(sampleSkewness(values))
    return sd !== null && sd > 0 && skew !== null && skew > 0
        ? finiteOrNull(sd * Math.cbrt(skew / SKEW_TO_TAU.divisor))
        : null
}

// Coefficient of variation: spread relative to the typical value.
export const coefficientOfVariation = (values: readonly number[]): number | null => {
    const average = meanOf(values)
    const sd = sdOf(values)
    return average !== null && average > 0 && sd !== null ? finiteOrNull(sd / average) : null
}

const countRuns = (sequence: readonly boolean[]): number =>
    sequence.filter((value, index) => index === 0 || value !== sequence[index - 1]).length

// Wald–Wolfowitz runs test. Negative z means fewer runs than chance: the errors bunch up.
export const runsTestZ = (sequence: readonly boolean[]): number | null => {
    const errors = sequence.filter((value) => value).length
    const correct = sequence.length - errors
    if (errors < SAMPLE_MIN.sd || correct < SAMPLE_MIN.sd) {
        return null
    }
    const product = RUNS_PAIRS * errors * correct
    const total = errors + correct
    const expected = product / total + 1
    const variance = (product * (product - total)) / (total * total * (total - 1))
    return variance > 0 ? finiteOrNull((countRuns(sequence) - expected) / Math.sqrt(variance)) : null
}

// Stouffer's method: one z from several independent ones.
export const combinedZ = (zs: readonly number[]): number | null =>
    zs.length > 0 ? finiteOrNull(zs.reduce((sum, z) => sum + z, 0) / Math.sqrt(zs.length)) : null

export interface Proportion {
    successes: number
    total: number
}

// Pooled two-proportion z test. Positive z means the first proportion is higher.
export const twoProportionZ = (first: Proportion, second: Proportion): number | null => {
    if (first.total === 0 || second.total === 0) {
        return null
    }
    const pooled = (first.successes + second.successes) / (first.total + second.total)
    const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / first.total + 1 / second.total))
    return standardError > 0
        ? finiteOrNull((first.successes / first.total - second.successes / second.total) / standardError)
        : null
}

// One-proportion z test against a fixed rate.
export const proportionZ = (observed: Proportion, expectedRate: number): number | null => {
    const standardError = Math.sqrt((expectedRate * (1 - expectedRate)) / observed.total)
    return observed.total > 0 && standardError > 0
        ? finiteOrNull((observed.successes / observed.total - expectedRate) / standardError)
        : null
}

export interface Interval {
    mean: number
    low: number
    high: number
}

// Normal-approximation 95% interval for a mean.
export const meanInterval = (values: readonly number[]): Interval | null => {
    const average = meanOf(values)
    const sd = sdOf(values)
    if (average === null || sd === null) {
        return null
    }
    const margin = (Z_95 * sd) / Math.sqrt(values.length)
    return { mean: average, low: average - margin, high: average + margin }
}

export const excludesZero = (interval: Interval | null): boolean =>
    interval !== null && (interval.low > 0 || interval.high < 0)

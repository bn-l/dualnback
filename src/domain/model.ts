import { CholeskyDecomposition, Matrix, inverse } from 'ml-matrix'
import { mean as average, sampleVariance } from 'simple-statistics'
import { log } from '../log'
import type { Factor, FactorRow, FactorTable } from './factors'

// One Bayesian linear regression of each round's result − expected on every factor at
// once, so factors that travel together (evenings and playing on your phone) are told apart.
//
// Each coefficient has a zero-mean normal prior. That is the shrinkage: an effect has to be
// supported by the data to move away from zero, and with little data it stays near zero.
// The noise variance is estimated from the residuals, pulled toward a typical value so a
// handful of rounds can't make the model falsely certain.
//
// Rounds from the same session aren't independent: they share that day's time, device and
// gap since the last session, and usually that day's form too. Treating 5 rounds of one day as 5 separate
// pieces of evidence makes every day-level factor look far more certain than it is. So the
// model gives each session its own random offset (a random-intercept, or mixed, model),
// with the size of day-to-day form estimated from the data. Each coefficient's uncertainty
// is then the larger of that model's and a cluster-robust (sandwich) estimate by session.
//
// Unknown values are left out, not guessed. A round whose value is unknown (the first round
// of a session has no break before it) gets 0 in that factor's column and 1 in an "unknown"
// column. The unknown column has a nearly flat prior, so it soaks up whatever level those
// rounds sit at, and the factor's own coefficient is identified only by rounds where the
// value is known.

// About 70 rating points: a real effect gets through, noise is pulled toward zero.
const FACTOR_PRIOR_SD = 0.1
// The intercept and not-answered columns are nearly free.
const FREE_PRIOR_SD = 10
const TYPICAL_NOISE_SD = 0.2
// The typical noise counts as this many rounds' worth of evidence.
const NOISE_PRIOR_ROUNDS = 4
const NOISE_ITERATIONS = 6
const MIN_NOISE_VARIANCE = 1e-6
const JITTER = 1e-9
// The sandwich estimate needs a few sessions before it means anything.
const MIN_CLUSTERS = 3

export interface Coefficient {
    factor: Factor
    // Posterior mean and sd, in result units (fractions of a win).
    mean: number
    sd: number
    // Rounds where the factor's value is known.
    answered: number
    // Binary factors: answered rounds with and without the factor.
    withFactor: number
    withoutFactor: number
    // The same, counted in distinct sessions.
    sessionsAnswered: number
    sessionsWith: number
    sessionsWithout: number
}

export interface ModelFit {
    coefficients: Coefficient[]
    intercept: number
    noiseSd: number
    rows: number
}

const valueOf = (row: FactorRow, factor: Factor): number | null => row.values[factor.id] ?? null

const answeredValues = (rows: readonly FactorRow[], factor: Factor): number[] =>
    rows.map((row) => valueOf(row, factor)).filter((value) => value !== null)

// A factor is worth a column only if its known values vary.
const varies = (values: readonly number[]): boolean => values.some((value) => value !== values[0])

const missingKey = (factor: Factor): string => factor.question ?? factor.id

const isFiniteMatrix = (matrix: Matrix): boolean => matrix.to2DArray().flat().every(Number.isFinite)

// Posterior covariance of a symmetric positive-definite precision matrix. The prior makes
// it positive definite in exact arithmetic; jitter and an SVD inverse cover rounding.
const covarianceOf = (precision: Matrix): Matrix => {
    const size = precision.rows
    const cholesky = new CholeskyDecomposition(precision)
    if (cholesky.isPositiveDefinite()) {
        return cholesky.solve(Matrix.eye(size))
    }
    const jittered = new CholeskyDecomposition(Matrix.add(precision, Matrix.eye(size).mul(JITTER)))
    if (jittered.isPositiveDefinite()) {
        return jittered.solve(Matrix.eye(size))
    }
    log.warn('model', 'precision matrix not positive definite; using SVD inverse')
    return inverse(precision, true)
}

interface VarianceParts {
    // Round-to-round noise within a session.
    within: number
    // How much whole sessions differ from each other: the day's form.
    between: number
}

interface Posterior extends VarianceParts {
    mean: number[]
    covariance: Matrix
}

interface ModelInput {
    design: Matrix
    outcomes: readonly number[]
    // Row indices of each session.
    groups: ReadonlyArray<readonly number[]>
}

// Each session's rounds share an offset (variance `between`) on top of round noise
// (variance `within`). For a session of n rounds, the inverse of its covariance is
// (I − c·J) / within with c = between / (within + n·between), so the weighted sums are
// exact without ever building an N×N matrix.
const shrinkFor = (parts: VarianceParts, size: number): number =>
    parts.between / (parts.within + size * parts.between)

const weightedTerms = ({ design, outcomes, groups }: ModelInput, parts: VarianceParts): { gram: Matrix; target: Matrix } =>
    groups.reduce((sum, indices) => {
        const rows = design.subMatrixRow([...indices])
        const transposed = rows.transpose()
        const totals = transposed.mmul(Matrix.ones(indices.length, 1))
        const shrink = shrinkFor(parts, indices.length)
        const outcomeTotal = indices.reduce((total, index) => total + (outcomes[index] ?? 0), 0)
        const gram = Matrix.sub(transposed.mmul(rows), totals.mmul(totals.transpose()).mul(shrink))
        const target = Matrix.sub(
            transposed.mmul(Matrix.columnVector(indices.map((index) => outcomes[index] ?? 0))),
            Matrix.mul(totals, shrink * outcomeTotal))
        return {
            gram: Matrix.add(sum.gram, gram.div(parts.within)),
            target: Matrix.add(sum.target, target.div(parts.within)),
        }
    }, { gram: Matrix.zeros(design.columns, design.columns), target: Matrix.zeros(design.columns, 1) })

// Within- and between-session variance from the residuals. The within part is pulled
// toward a typical value so a handful of rounds can't make the model falsely certain.
const varianceParts = (residuals: readonly number[], groups: ReadonlyArray<readonly number[]>): VarianceParts => {
    const typicalVariance = TYPICAL_NOISE_SD * TYPICAL_NOISE_SD
    const sessionMeans = groups.map((indices) => average(indices.map((index) => residuals[index] ?? 0)))
    const withinSquares = groups.reduce((total, indices, group) => total + indices.reduce((inner, index) => {
        const deviation = (residuals[index] ?? 0) - (sessionMeans[group] ?? 0)
        return inner + deviation * deviation
    }, 0), 0)
    const within = Math.max(MIN_NOISE_VARIANCE, (withinSquares + NOISE_PRIOR_ROUNDS * typicalVariance) /
        (residuals.length - groups.length + NOISE_PRIOR_ROUNDS))
    const between = groups.length < MIN_CLUSTERS
        ? 0
        : Math.max(0, sampleVariance(sessionMeans) - within / (residuals.length / groups.length))
    return { within, between }
}

const posterior = (input: ModelInput, priorSds: readonly number[]): Posterior => {
    const priorPrecision = Matrix.diag(priorSds.map((sd) => 1 / (sd * sd)))
    const start: Posterior = {
        mean: [],
        covariance: Matrix.eye(priorSds.length),
        within: TYPICAL_NOISE_SD * TYPICAL_NOISE_SD,
        between: 0,
    }
    return Array.from({ length: NOISE_ITERATIONS }).reduce<Posterior>((previous) => {
        const { gram, target } = weightedTerms(input, previous)
        const covariance = covarianceOf(Matrix.add(gram, priorPrecision))
        const mean = covariance.mmul(target).getColumn(0)
        const fitted = input.design.mmul(Matrix.columnVector(mean)).getColumn(0)
        const residuals = input.outcomes.map((outcome, index) => outcome - (fitted[index] ?? 0))
        return { mean, covariance, ...varianceParts(residuals, input.groups) }
    }, start)
}

const distinctSessions = (rows: readonly FactorRow[]): number => new Set(rows.map(({ sessionId }) => sessionId)).size

type SideCounts = Pick<Coefficient, 'answered' | 'withFactor' | 'withoutFactor' | 'sessionsAnswered' | 'sessionsWith' | 'sessionsWithout'>

const sideCounts = (rows: readonly FactorRow[], factor: Factor): SideCounts => {
    const answered = rows.filter((row) => valueOf(row, factor) !== null)
    const withRows = answered.filter((row) => (valueOf(row, factor) ?? 0) > 0)
    const withoutRows = answered.filter((row) => (valueOf(row, factor) ?? 0) <= 0)
    return {
        answered: answered.length,
        withFactor: withRows.length,
        withoutFactor: withoutRows.length,
        sessionsAnswered: distinctSessions(answered),
        sessionsWith: distinctSessions(withRows),
        sessionsWithout: distinctSessions(withoutRows),
    }
}

// Cluster-robust covariance as a backstop: bread · meat · bread, where the meat sums each
// session's weighted score, with the usual G / (G − 1) small-sample correction.
const clusteredCovariance = (input: ModelInput, fit: Posterior): Matrix | null => {
    const { design, outcomes, groups } = input
    if (groups.length < MIN_CLUSTERS) {
        return null
    }
    const fitted = design.mmul(Matrix.columnVector(fit.mean)).getColumn(0)
    const meat = groups.reduce((sum, indices) => {
        const rows = design.subMatrixRow([...indices])
        const residuals = indices.map((index) => (outcomes[index] ?? 0) - (fitted[index] ?? 0))
        const residualTotal = residuals.reduce((total, value) => total + value, 0)
        const totals = rows.transpose().mmul(Matrix.ones(indices.length, 1))
        const score = Matrix.sub(rows.transpose().mmul(Matrix.columnVector(residuals)),
            Matrix.mul(totals, shrinkFor(fit, indices.length) * residualTotal)).div(fit.within)
        return Matrix.add(sum, score.mmul(score.transpose()))
    }, Matrix.zeros(design.columns, design.columns))
    const result = fit.covariance.mmul(meat.mul(groups.length / (groups.length - 1))).mmul(fit.covariance)
    return isFiniteMatrix(result) ? result : null
}

const priorOnly = (table: FactorTable, rows: readonly FactorRow[]): ModelFit => ({
    coefficients: table.factors.map((factor) => ({ factor, mean: 0, sd: FACTOR_PRIOR_SD, ...sideCounts(rows, factor) })),
    intercept: 0,
    noiseSd: TYPICAL_NOISE_SD,
    rows: rows.length,
})

export const fitModel = (table: FactorTable): ModelFit => {
    const rows = table.rows.filter(({ residual }) => Number.isFinite(residual))
    const factors = table.factors.filter((factor) => varies(answeredValues(rows, factor)))
    if (rows.length === 0) {
        return priorOnly(table, rows)
    }
    const missingGroups = [...new Set(factors
        .filter((factor) => rows.some((row) => valueOf(row, factor) === null))
        .map(missingKey))]

    const design = new Matrix(rows.map((row) => [
        1,
        ...factors.map((factor) => valueOf(row, factor) ?? 0),
        ...missingGroups.map((group) =>
            factors.some((factor) => missingKey(factor) === group && valueOf(row, factor) === null) ? 1 : 0),
    ]))
    const priorSds = [FREE_PRIOR_SD, ...factors.map(() => FACTOR_PRIOR_SD), ...missingGroups.map(() => FREE_PRIOR_SD)]
    const outcomes = rows.map(({ residual }) => residual)
    const groups = [...rows.reduce((bySession, row, index) =>
        bySession.set(row.sessionId, [...(bySession.get(row.sessionId) ?? []), index]), new Map<string, number[]>()).values()]
    const input: ModelInput = { design, outcomes, groups }
    const fit = posterior(input, priorSds)

    if (!fit.mean.every(Number.isFinite) || !isFiniteMatrix(fit.covariance)) {
        log.error('model', 'fit produced non-finite numbers; falling back to the prior', { rows: rows.length })
        return priorOnly(table, rows)
    }
    const robust = clusteredCovariance(input, fit)
    const varianceAt = (index: number): number =>
        Math.max(0, fit.covariance.get(index, index), robust?.get(index, index) ?? 0)
    const fitted = new Map(factors.map((factor, index) => [factor.id, {
        mean: fit.mean[index + 1] ?? 0,
        sd: Math.sqrt(varianceAt(index + 1)),
    }]))

    return {
        coefficients: table.factors.map((factor) => ({
            factor,
            ...(fitted.get(factor.id) ?? { mean: 0, sd: FACTOR_PRIOR_SD }),
            ...sideCounts(rows, factor),
        })),
        intercept: fit.mean[0] ?? 0,
        noiseSd: Math.sqrt(fit.within + fit.between),
        rows: rows.length,
    }
}

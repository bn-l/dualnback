import { cumulativeStdNormalProbability, linearRegression, mean, sampleCorrelation } from 'simple-statistics'
import type { Dataset } from '../data/dataset'
import type { FindingRecord, FindingStatus } from '../data/schema'
import type { Evidence, Finding } from './analysis-types'
import { type Factor, type FactorRow, type FactorTable, roundFactors } from './factors'
import { basis, wholeNumber } from './format'
import { type Coefficient, fitModel } from './model'
import { INITIAL_RATING, pointsFromResultDelta } from './rating'

// Thresholds from PLAN.md, "How findings are made".
export const MIN_ROUNDS_PER_SIDE = 10
// Rounds in one session share a day, so a side also needs a few separate sessions.
export const MIN_SESSIONS_PER_SIDE = 3
export const MIN_EFFECT_POINTS = 10
const Z_95 = 1.96
const FALSE_DISCOVERY_RATE = 0.05
const TWO_SIDED = 2
// Effects are spoken about to the nearest 5 points.
const ROUND_TO = 5
// A new finding is confirmed once it holds on this many later rounds.
export const CONFIRM_ROUNDS = 20
const MIN_HELD_OUT_PER_SIDE = 3
// A slope needs this many answered rounds: as many as both sides of a yes/no factor.
const MIN_HELD_OUT_FOR_SLOPE = MIN_HELD_OUT_PER_SIDE + MIN_HELD_OUT_PER_SIDE
const MEANINGFUL_HELD_OUT_POINTS = 5
// A raw difference is "explained" by another factor only if the two go together this much.
const MIN_SEPARATION_CORRELATION = 0.3

const SEPARATOR = '|'
const modelId = (factorId: string): string => `model${SEPARATOR}${factorId}`
const separationId = (situation: string, cause: string): string => `separation${SEPARATOR}${situation}${SEPARATOR}${cause}`
const ROUND_NUMBER_ID = modelId('round-number')

const nearestFive = (points: number): number => Math.max(ROUND_TO, Math.round(Math.abs(points) / ROUND_TO) * ROUND_TO)
const about = (points: number): string => `about ${nearestFive(points)} points`
const higherLower = (points: number): string => (points > 0 ? 'higher' : 'lower')
const worthOrCosts = (points: number): string => (points > 0 ? 'is worth' : 'costs you')
const capitalise = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

// The "with" phrasing for each fixed factor; dynamic ones (devices, input types) by prefix.
const SENTENCES: Readonly<Record<string, (points: number) => string>> = {
    'morning': (points) => `You score ${about(points)} ${higherLower(points)} before 10am.`,
    'evening': (points) => `You score ${about(points)} ${higherLower(points)} after 6pm.`,
    'weekend': (points) => `You score ${about(points)} ${higherLower(points)} on weekends.`,
    'third-round': (points) => (points > 0
        ? `Your third round is usually your best, ${about(points)} above your others.`
        : `Your third round tends to dip, ${about(points)} below your others.`),
    'sixth-plus': (points) => (points < 0
        ? `After the fifth round, you score ${about(points)} lower.`
        : `You keep getting better past the fifth round, ${about(points)} higher.`),
    'long-break': (points) => (points > 0
        ? `A break of 30 seconds or more before a round is worth ${about(points)}.`
        : `Breaks of 30 seconds or more before a round cost you ${about(points)}.`),
    'after-two-below': (points) => (points < 0
        ? `After two rounds below expected, your next round averages ${about(points)} worse. That's a good place to stop.`
        : `After two rounds below expected, you bounce back: your next round averages ${about(points)} better.`),
    'first-of-day': (points) => `Your first round of the day is ${about(points)} ${points > 0 ? 'above' : 'below'} your others.`,
    'long-gap': (points) => `After two or more days off, you score ${about(points)} ${higherLower(points)}.`,
    'travel': (points) => `After a time-zone change, you score ${about(points)} ${higherLower(points)}.`,
}

const sentenceFor = (factor: Factor, points: number): string => {
    const fixed = SENTENCES[factor.id]
    if (fixed !== undefined) {
        return fixed(points)
    }
    const prefix = factor.id.split(':')[0] ?? ''
    switch (prefix) {
        case 'device':
        case 'input':
            return `You score ${about(points)} ${higherLower(points)} with ${factor.short} than with ${factor.comparison.toLowerCase()}.`
        default:
            return `${capitalise(factor.short)} ${worthOrCosts(points)} ${about(points)}.`
    }
}

// Which factor a time-of-week pattern is, for "Your phone, not time of day, explains your
// evening slump."
const SITUATIONS: Readonly<Record<string, { dimension: string; situation: string }>> = {
    morning: { dimension: 'time of day', situation: 'morning' },
    evening: { dimension: 'time of day', situation: 'evening' },
    weekend: { dimension: 'the day of the week', situation: 'weekend' },
}

const valueOf = (row: FactorRow, factorId: string): number | null => row.values[factorId] ?? null

const meanOr = (values: readonly number[], fallback: number): number => (values.length === 0 ? fallback : mean(values))

interface Split {
    with: FactorRow[]
    without: FactorRow[]
}

const split = (rows: readonly FactorRow[], factorId: string): Split => ({
    with: rows.filter((row) => (valueOf(row, factorId) ?? 0) > 0),
    without: rows.filter((row) => valueOf(row, factorId) !== null && (valueOf(row, factorId) ?? 0) <= 0),
})

const residuals = (rows: readonly FactorRow[]): number[] => rows.map(({ residual }) => residual)

const rawPoints = ({ with: withRows, without }: Split): number =>
    pointsFromResultDelta(meanOr(residuals(withRows), 0) - meanOr(residuals(without), 0))

const currentRating = (dataset: Dataset): number => {
    const last = dataset.scored.at(-1)?.round
    return last?.ratingAfter?.rating ?? last?.ratingBefore.rating ?? INITIAL_RATING.rating
}

// A performance rating per condition: your rating plus how far above or below expectation
// you did in that condition.
const evidenceFor = (options: { factor: Factor; sides: Split; rating: number }): Evidence[] => {
    const { factor, sides, rating } = options
    const bar = (label: string, rows: readonly FactorRow[]): Evidence[] => {
        if (rows.length === 0) {
            return []
        }
        const value = Math.round(rating + pointsFromResultDelta(mean(residuals(rows))))
        return [{ label, value, display: wholeNumber(value) }]
    }
    return [...bar(factor.label, sides.with), ...bar(factor.comparison, sides.without)]
}

const basisFor = (rows: readonly FactorRow[]): string => {
    const times = rows.map(({ startedAt }) => startedAt)
    return times.length === 0 ? 'No rounds yet.' : basis(rows.length, Math.min(...times), Math.max(...times))
}

const answeredRows = (rows: readonly FactorRow[], factorId: string): FactorRow[] =>
    rows.filter((row) => valueOf(row, factorId) !== null)

const enoughRounds = (coefficient: Coefficient): boolean =>
    coefficient.factor.type === 'binary'
        ? coefficient.withFactor >= MIN_ROUNDS_PER_SIDE && coefficient.withoutFactor >= MIN_ROUNDS_PER_SIDE &&
            coefficient.sessionsWith >= MIN_SESSIONS_PER_SIDE && coefficient.sessionsWithout >= MIN_SESSIONS_PER_SIDE
        : coefficient.answered >= MIN_ROUNDS_PER_SIDE && coefficient.sessionsAnswered >= MIN_SESSIONS_PER_SIDE + MIN_SESSIONS_PER_SIDE

const intervalExcludesZero = ({ mean: centre, sd }: Coefficient): boolean => Math.abs(centre) - Z_95 * sd > 0

// Enough rounds and a 95% interval clear of zero: safe to act on, even if small.
export const isEstablished = (coefficient: Coefficient): boolean =>
    enoughRounds(coefficient) && intervalExcludesZero(coefficient)

// Passes every threshold for a finding: established, big enough, and shown to the player.
export const isMeaningful = (coefficient: Coefficient): boolean =>
    coefficient.factor.reportable &&
    isEstablished(coefficient) &&
    Math.abs(pointsFromResultDelta(coefficient.mean)) >= MIN_EFFECT_POINTS

const pValue = ({ mean: centre, sd }: Coefficient): number =>
    sd <= 0 ? 0 : TWO_SIDED * (1 - cumulativeStdNormalProbability(Math.abs(centre) / sd))

// Guarding against luck: every reportable factor with enough rounds is one test, and with
// a dozen or more tests some pass at 95% by chance alone. Benjamini–Hochberg keeps the
// expected share of false findings among those reported at 5%: the k-th smallest p-value
// must be at most k/m × 5%. A finding must pass that as well as every per-factor threshold.
export const discoveries = (coefficients: readonly Coefficient[]): Coefficient[] => {
    const ranked = coefficients
        .filter((coefficient) => coefficient.factor.reportable && enoughRounds(coefficient))
        .sort((a, b) => pValue(a) - pValue(b))
    const cutoff = ranked.reduce((last, coefficient, index) =>
        pValue(coefficient) <= ((index + 1) / ranked.length) * FALSE_DISCOVERY_RATE ? index : last, -1)
    const passing = new Set(ranked.slice(0, cutoff + 1))
    return coefficients.filter((coefficient) => passing.has(coefficient) && isMeaningful(coefficient))
}

const findingFor = (options: { coefficient: Coefficient; table: FactorTable; rating: number }): Finding => {
    const { coefficient, table, rating } = options
    const { factor } = coefficient
    const points = pointsFromResultDelta(coefficient.mean)
    const answered = answeredRows(table.rows, factor.id)
    return {
        id: modelId(factor.id),
        kind: factor.kind,
        sentence: sentenceFor(factor, points),
        effectPoints: Math.round(points),
        evidence: evidenceFor({ factor, sides: split(answered, factor.id), rating }),
        basis: basisFor(answered),
        controllable: factor.controllable,
    }
}

// "Your third round is usually your best. After the fifth, you score about 20 points lower."
const combineRoundNumbers = (findings: readonly Finding[]): Finding[] => {
    const third = findings.find(({ id }) => id === modelId('third-round'))
    const sixth = findings.find(({ id }) => id === modelId('sixth-plus'))
    if (third === undefined || sixth === undefined || (third.effectPoints ?? 0) <= 0 || (sixth.effectPoints ?? 0) >= 0) {
        return [...findings]
    }
    const combined: Finding = {
        ...third,
        id: ROUND_NUMBER_ID,
        sentence: `Your third round is usually your best. After the fifth, you score ${about(sixth.effectPoints ?? 0)} lower.`,
        evidence: [...third.evidence.slice(0, 1), ...sixth.evidence],
        controllable: true,
    }
    return [...findings.filter((finding) => finding !== third && finding !== sixth), combined]
}

const correlation = (rows: readonly FactorRow[], first: string, second: string): number => {
    const pairs = rows.flatMap((row) => {
        const a = valueOf(row, first)
        const b = valueOf(row, second)
        return a === null || b === null ? [] : [[a, b]]
    })
    const xs = pairs.map(([a]) => a ?? 0)
    const ys = pairs.map(([, b]) => b ?? 0)
    if (pairs.length < MIN_HELD_OUT_PER_SIDE || !xs.some((x) => x !== xs[0]) || !ys.some((y) => y !== ys[0])) {
        return 0
    }
    const value = sampleCorrelation(xs, ys)
    return Number.isFinite(value) ? value : 0
}

// A time-of-week pattern that is real in the raw numbers but that the model hands to a
// factor that goes with it: "Your phone, not time of day, explains your evening slump."
const separations = (options: { fit: readonly Coefficient[]; table: FactorTable; rating: number }): Finding[] => {
    const { fit, table, rating } = options
    const meaningful = discoveries(fit)
    return fit.flatMap((situational): Finding[] => {
        const phrasing = SITUATIONS[situational.factor.id]
        const sides = split(table.rows, situational.factor.id)
        if (phrasing === undefined || meaningful.includes(situational) ||
            sides.with.length < MIN_ROUNDS_PER_SIDE || sides.without.length < MIN_ROUNDS_PER_SIDE) {
            return []
        }
        const raw = rawPoints(sides)
        if (Math.abs(raw) < MIN_EFFECT_POINTS) {
            return []
        }
        const cause = meaningful
            .map((candidate) => ({
                candidate,
                together: correlation(table.rows, situational.factor.id, candidate.factor.id),
            }))
            .filter(({ candidate, together }) => candidate.factor.id !== situational.factor.id &&
                Math.abs(together) >= MIN_SEPARATION_CORRELATION &&
                Math.sign(together) * Math.sign(candidate.mean) === Math.sign(raw))
            .sort((a, b) => Math.abs(b.together * b.candidate.mean) - Math.abs(a.together * a.candidate.mean))[0]
        if (cause === undefined) {
            return []
        }
        const pattern = raw > 0 ? 'advantage' : 'slump'
        // When the situation goes with less of the factor (evenings mean fewer rounds on the
        // computer), the cause is the other side of it: the phone, not the computer.
        const causeName = cause.together >= 0 ? capitalise(cause.candidate.factor.short) : cause.candidate.factor.comparison
        return [{
            id: separationId(situational.factor.id, cause.candidate.factor.id),
            kind: 'helps-hurts',
            sentence: `${causeName}, not ${phrasing.dimension}, explains your ${phrasing.situation} ${pattern}.`,
            effectPoints: Math.round(pointsFromResultDelta(cause.candidate.mean)),
            evidence: evidenceFor({ factor: situational.factor, sides, rating }),
            basis: basisFor(table.rows),
            controllable: cause.candidate.factor.controllable,
        }]
    })
}

export const modelFindingsFrom = (table: FactorTable, rating: number): Finding[] => {
    const fit = fitModel(table)
    const direct = discoveries(fit.coefficients)
        .map((coefficient) => findingFor({ coefficient, table, rating }))
    return [...combineRoundNumbers(direct), ...separations({ fit: fit.coefficients, table, rating })]
}

export const modelFindings = (dataset: Dataset, now: Date): Finding[] => {
    const table = roundFactors(dataset)
    const rows = table.rows.filter(({ startedAt }) => startedAt <= now.getTime())
    return modelFindingsFrom({ ...table, rows }, currentRating(dataset))
}

// The factor whose later data decides whether a finding holds.
const factorBehind = (findingId: string): string | null => {
    const [source, first, second] = findingId.split(SEPARATOR)
    if (findingId === ROUND_NUMBER_ID) {
        return 'third-round'
    }
    if (source === 'model') {
        return first ?? null
    }
    return source === 'separation' ? second ?? null : null
}

// The factor's effect measured only on rounds after `fromOrder`, which the finding didn't see.
const heldOutPoints = (options: { table: FactorTable; factorId: string; fromOrder: number }): number | null => {
    const { table, factorId, fromOrder } = options
    const later = table.rows.filter(({ order }) => order >= fromOrder)
    const factor = table.factors.find(({ id }) => id === factorId)
    if (factor === undefined) {
        return null
    }
    if (factor.type === 'binary') {
        const sides = split(later, factorId)
        return sides.with.length < MIN_HELD_OUT_PER_SIDE || sides.without.length < MIN_HELD_OUT_PER_SIDE
            ? null
            : rawPoints(sides)
    }
    const points = answeredRows(later, factorId).map((row) => [valueOf(row, factorId) ?? 0, row.residual])
    const xs = points.map(([x]) => x ?? 0)
    if (points.length < MIN_HELD_OUT_FOR_SLOPE || !xs.some((x) => x !== xs[0])) {
        return null
    }
    const { m } = linearRegression(points)
    return Number.isFinite(m) ? pointsFromResultDelta(m) : null
}

const signOf = (points: number | null): number => (points === null || points === 0 ? 1 : Math.sign(points))

const nextStatus = (options: {
    record: FindingRecord
    present: Finding | undefined
    table: FactorTable
    completedRounds: number
}): FindingStatus => {
    const { record, present, table, completedRounds } = options
    if (present === undefined) {
        return 'faded'
    }
    if (record.status === 'faded') {
        return 'new'
    }
    if (record.status === 'confirmed' || completedRounds - record.roundsAtDetection < CONFIRM_ROUNDS) {
        return record.status
    }
    const factorId = factorBehind(record.id)
    if (factorId === null) {
        // Not a model finding: it holds if it is still found after the confirmation window.
        return 'confirmed'
    }
    const held = heldOutPoints({ table, factorId, fromOrder: record.roundsAtDetection })
    if (held === null) {
        return 'new'
    }
    return Math.sign(held) === record.sign && Math.abs(held) >= MEANINGFUL_HELD_OUT_POINTS ? 'confirmed' : 'faded'
}

// new → confirmed once a finding holds on the next 20 rounds it wasn't found with;
// faded once the data stops supporting it. Records are never dropped. `updatedAt` moves
// only when the status does, so "newly confirmed this week" can be read from it.
export const updateLifecycle = (options: {
    records: FindingRecord[]
    findings: Finding[]
    dataset: Dataset
    now: Date
}): FindingRecord[] => {
    const { records, findings, dataset, now } = options
    const at = now.getTime()
    const completedRounds = dataset.scored.length
    const table = roundFactors(dataset)
    const current = new Map(findings.map((finding) => [finding.id, finding]))
    const known = new Set(records.map(({ id }) => id))

    const updated = records.map((record): FindingRecord => {
        const present = current.get(record.id)
        const status = nextStatus({ record, present, table, completedRounds })
        const restarted = record.status === 'faded' && status === 'new'
        return {
            ...record,
            status,
            sentence: present?.sentence ?? record.sentence,
            effectPoints: present === undefined ? record.effectPoints : present.effectPoints,
            sign: restarted ? signOf(present?.effectPoints ?? null) : record.sign,
            firstSeenAt: restarted ? at : record.firstSeenAt,
            roundsAtDetection: restarted ? completedRounds : record.roundsAtDetection,
            updatedAt: status === record.status ? record.updatedAt : at,
        }
    })
    const added = findings
        .filter(({ id }) => !known.has(id))
        .map((finding): FindingRecord => ({
            id: finding.id,
            status: 'new',
            sentence: finding.sentence,
            effectPoints: finding.effectPoints,
            sign: signOf(finding.effectPoints),
            firstSeenAt: at,
            roundsAtDetection: completedRounds,
            updatedAt: at,
        }))
    return [...updated, ...added]
}

import { differenceInCalendarDays, getHours, isWeekend } from 'date-fns'
import type { Dataset } from '../data/dataset'
import type { DeviceInfo, ExperimentAssignment, InputType, PressRecord } from '../data/schema'
import type { FindingKind } from './analysis-types'
import { dayKey } from './format'

// Everything the insights model can explain a round's result with: when and how you play,
// never anything about your day outside the game. Each factor is a column: 1/0 for yes/no
// factors, and null when the round's value is unknown (no previous session to compare with).

export type FactorType = 'binary' | 'continuous'

export interface Factor {
    // Stable id. User text and device keys inside ids are URI-encoded, so `|` never appears.
    id: string
    // The "with" group, as an evidence bar label: "Before 10am".
    label: string
    // The "without" group: "10am to 6pm".
    comparison: string
    // A noun phrase that reads mid-sentence: "a longer break", "time off".
    short: string
    controllable: boolean
    kind: FindingKind
    type: FactorType
    // Factors answered by the same question share missingness. null: always known.
    question: string | null
    // Experiment conditions stay in the model (so they're controlled for) but have their
    // own result screen, so they never become findings.
    reportable: boolean
}

// Everything known about the moment a round was played (or is about to be).
export interface RoundContext {
    startedAt: number
    roundIndex: number
    breakBeforeMs: number | null
    afterTwoBelow: boolean
    firstOfDay: boolean
    daysSinceLastSession: number | null
    timeZoneChanged: boolean | null
    deviceKey: string | null
    inputType: InputType | null
    experiment: ExperimentAssignment | null
}

export interface FactorDefinition {
    factor: Factor
    value: (context: RoundContext) => number | null
}

export interface FactorRow {
    roundId: string
    sessionId: string
    // Position in dataset.scored, so held-out checks can take "rounds after N".
    order: number
    startedAt: number
    // result − expected
    residual: number
    values: Readonly<Record<string, number | null>>
}

export interface FactorTable {
    factors: Factor[]
    rows: FactorRow[]
}

const MORNING_END_HOUR = 10
const EVENING_START_HOUR = 18
const THIRD_ROUND_INDEX = 2
const SIXTH_ROUND_INDEX = 5
const LONG_BREAK_MS = 30_000
const LONG_GAP_DAYS = 2
const BELOW_EXPECTED_RUN = 2
// A device or input type needs this many rounds before it gets its own column.
export const MIN_GROUP_ROUNDS = 10
const PHONE_MAX_SHORT_SIDE = 600

const binary = (value: boolean | null | undefined): number | null => (value == null ? null : value ? 1 : 0)

const helpsHurts = { kind: 'helps-hurts', reportable: true } satisfies Pick<Factor, 'kind' | 'reportable'>
const howYouPlay = { kind: 'how-you-play', reportable: true } satisfies Pick<Factor, 'kind' | 'reportable'>

const STATIC_FACTORS: readonly FactorDefinition[] = [
    {
        factor: { id: 'morning', label: 'Before 10am', comparison: '10am to 6pm', short: 'playing before 10am',
            controllable: true, type: 'binary', question: null, ...helpsHurts },
        value: ({ startedAt }) => binary(getHours(startedAt) < MORNING_END_HOUR),
    },
    {
        factor: { id: 'evening', label: 'After 6pm', comparison: '10am to 6pm', short: 'playing after 6pm',
            controllable: true, type: 'binary', question: null, ...helpsHurts },
        value: ({ startedAt }) => binary(getHours(startedAt) >= EVENING_START_HOUR),
    },
    {
        factor: { id: 'weekend', label: 'Weekends', comparison: 'Weekdays', short: 'the weekend',
            controllable: false, type: 'binary', question: null, ...helpsHurts },
        value: ({ startedAt }) => binary(isWeekend(startedAt)),
    },
    {
        factor: { id: 'third-round', label: 'Third round', comparison: 'Other rounds', short: 'the third round',
            controllable: false, type: 'binary', question: null, ...howYouPlay },
        value: ({ roundIndex }) => binary(roundIndex === THIRD_ROUND_INDEX),
    },
    {
        factor: { id: 'sixth-plus', label: 'Sixth round or later', comparison: 'Rounds one to five',
            short: 'long sessions', controllable: true, type: 'binary', question: null, ...howYouPlay },
        value: ({ roundIndex }) => binary(roundIndex >= SIXTH_ROUND_INDEX),
    },
    {
        factor: { id: 'long-break', label: 'Break of 30 s or more', comparison: 'Shorter break',
            short: 'a longer break', controllable: true, type: 'binary', question: 'breakBefore', ...howYouPlay },
        value: ({ breakBeforeMs }) => (breakBeforeMs === null ? null : binary(breakBeforeMs >= LONG_BREAK_MS)),
    },
    {
        factor: { id: 'after-two-below', label: 'After two below expected', comparison: 'Other rounds',
            short: 'a losing run', controllable: true, type: 'binary', question: null, ...howYouPlay },
        value: ({ afterTwoBelow }) => binary(afterTwoBelow),
    },
    {
        factor: { id: 'first-of-day', label: 'First round of the day', comparison: 'Later rounds',
            short: 'the first round of the day', controllable: false, type: 'binary', question: null, ...howYouPlay },
        value: ({ firstOfDay }) => binary(firstOfDay),
    },
    {
        factor: { id: 'long-gap', label: '2+ days off', comparison: 'Played recently', short: 'time off',
            controllable: true, type: 'binary', question: 'previousSession', ...howYouPlay },
        value: ({ daysSinceLastSession }) =>
            daysSinceLastSession === null ? null : binary(daysSinceLastSession >= LONG_GAP_DAYS),
    },
    {
        factor: { id: 'travel', label: 'New time zone', comparison: 'Same time zone', short: 'travel',
            controllable: false, type: 'binary', question: 'previousSession', ...helpsHurts },
        value: ({ timeZoneChanged }) => binary(timeZoneChanged),
    },
]

const INPUT_LABELS: Record<InputType, string> = {
    keyboard: 'the keyboard',
    touch: 'touch',
    mouse: 'a mouse',
    pen: 'a pen',
}

const capitalise = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

const deviceLabel = (device: DeviceInfo): string =>
    !device.coarsePointer
        ? 'your computer'
        : Math.min(device.screenWidth, device.screenHeight) < PHONE_MAX_SHORT_SIDE
            ? 'your phone'
            : 'your tablet'

const countBy = <T>(items: readonly T[], key: (item: T) => string | null): Map<string, number> =>
    items.reduce((counts, item) => {
        const value = key(item)
        return value === null ? counts : counts.set(value, (counts.get(value) ?? 0) + 1)
    }, new Map<string, number>())

const mostCommon = (counts: ReadonlyMap<string, number>): string | null =>
    [...counts.entries()].reduce<[string, number] | null>(
        (best, entry) => (best === null || entry[1] > best[1] ? entry : best), null)?.[0] ?? null

const groupedFactors = <T extends string>(options: {
    contexts: readonly RoundContext[]
    key: (context: RoundContext) => T | null
    make: (value: T, reference: T) => FactorDefinition
    isValue: (value: string) => value is T
}): FactorDefinition[] => {
    const counts = countBy(options.contexts, options.key)
    const reference = mostCommon(counts)
    if (reference === null || !options.isValue(reference)) {
        return []
    }
    return [...counts.entries()]
        .filter(([value, count]) => value !== reference && count >= MIN_GROUP_ROUNDS)
        .map(([value]) => value)
        .filter(options.isValue)
        .map((value) => options.make(value, reference))
}

const isString = (value: string): value is string => value.length > 0

const isInputType = (value: string): value is InputType => value in INPUT_LABELS

// Static factors plus the ones that depend on the data: devices and input types with
// enough rounds (each compared with the most common one), and every experiment's condition.
export const factorDefinitions = (dataset: Dataset, contexts: readonly RoundContext[]): FactorDefinition[] => {
    const devices = new Map(dataset.sessions.map(({ device }) => [device.key, device]))
    const labelFor = (key: string): string => {
        const device = devices.get(key)
        return device === undefined ? 'another device' : deviceLabel(device)
    }

    const deviceFactors = groupedFactors({
        contexts,
        key: ({ deviceKey }) => deviceKey,
        isValue: isString,
        make: (key, reference) => ({
            factor: { id: `device:${encodeURIComponent(key)}`, label: capitalise(labelFor(key)),
                comparison: capitalise(labelFor(reference)), short: labelFor(key), controllable: true,
                type: 'binary', question: 'device', ...helpsHurts },
            value: ({ deviceKey }) => (deviceKey === null ? null : binary(deviceKey === key)),
        }),
    })

    const inputFactors = groupedFactors({
        contexts,
        key: ({ inputType }) => inputType,
        isValue: isInputType,
        make: (input, reference) => ({
            factor: { id: `input:${input}`, label: capitalise(INPUT_LABELS[input]),
                comparison: capitalise(INPUT_LABELS[reference]), short: INPUT_LABELS[input], controllable: true,
                type: 'binary', question: 'input', ...helpsHurts },
            value: ({ inputType }) => (inputType === null ? null : binary(inputType === input)),
        }),
    })

    const experimentFactors = dataset.experiments.map((experiment): FactorDefinition => ({
        factor: { id: `experiment:${experiment.id}`, label: experiment.conditionB, comparison: experiment.conditionA,
            short: experiment.conditionB, controllable: true, type: 'binary', question: `experiment:${experiment.id}`,
            kind: 'helps-hurts', reportable: false },
        value: ({ experiment: assignment }) => (assignment?.experimentId === experiment.id
            ? binary(assignment.condition === 'b')
            : null),
    }))

    return [...STATIC_FACTORS, ...deviceFactors, ...inputFactors, ...experimentFactors]
}

export const valuesFor = (
    definitions: readonly FactorDefinition[],
    context: RoundContext,
): Record<string, number | null> =>
    Object.fromEntries(definitions.map(({ factor, value }) => [factor.id, value(context)]))

const majorityInput = (presses: readonly PressRecord[]): InputType | null => {
    const input = mostCommon(countBy(presses.filter(({ sense }) => sense !== null), ({ input: value }) => value))
    return input !== null && isInputType(input) ? input : null
}

export interface ScoredContext {
    context: RoundContext
    row: Omit<FactorRow, 'values'>
}

// One context per completed round, in dataset.scored order.
export const buildContexts = (dataset: Dataset): ScoredContext[] => {
    const sessions = new Map(dataset.sessions.map((session) => [session.id, session]))
    const orderedSessions = [...dataset.sessions].sort((a, b) => a.startedAt - b.startedAt)
    const allRounds = [...dataset.rounds].sort((a, b) => a.startedAt - b.startedAt)
    const pressesByRound = dataset.presses.reduce((groups, press) =>
        groups.set(press.roundId, [...(groups.get(press.roundId) ?? []), press]), new Map<string, PressRecord[]>())

    return dataset.scored.flatMap(({ round }, order): ScoredContext[] => {
        const session = sessions.get(round.sessionId)
        const result = round.result
        if (session === undefined || result === null) {
            return []
        }
        const day = dayKey(round.startedAt)
        const previousSession = orderedSessions.filter(({ startedAt }) => startedAt < session.startedAt).at(-1)
        const earlierInSession = dataset.scored
            .filter(({ round: other }) => other.sessionId === round.sessionId && other.index < round.index)
            .sort((a, b) => a.round.index - b.round.index)
            .slice(-BELOW_EXPECTED_RUN)
        const context: RoundContext = {
            startedAt: round.startedAt,
            roundIndex: round.index,
            breakBeforeMs: round.breakBeforeMs,
            afterTwoBelow: earlierInSession.length === BELOW_EXPECTED_RUN && earlierInSession.every(
                ({ round: other }) => other.result !== null && other.result < other.expected),
            firstOfDay: allRounds.find((other) => dayKey(other.startedAt) === day)?.id === round.id,
            daysSinceLastSession: previousSession === undefined
                ? null
                : differenceInCalendarDays(session.startedAt, previousSession.startedAt),
            timeZoneChanged: previousSession === undefined ? null : previousSession.timeZone !== session.timeZone,
            deviceKey: session.device.key,
            inputType: majorityInput(pressesByRound.get(round.id) ?? []),
            experiment: session.experiment,
        }
        return [{
            context,
            row: {
                roundId: round.id,
                sessionId: round.sessionId,
                order,
                startedAt: round.startedAt,
                residual: result - round.expected,
            },
        }]
    })
}

// The table plus the definitions that built it, for scoring a round that hasn't happened.
export const factorModelInputs = (dataset: Dataset): { table: FactorTable; definitions: FactorDefinition[] } => {
    const contexts = buildContexts(dataset)
    const definitions = factorDefinitions(dataset, contexts.map(({ context }) => context))
    return {
        definitions,
        table: {
            factors: definitions.map(({ factor }) => factor),
            rows: contexts.map(({ context, row }) => ({ ...row, values: valuesFor(definitions, context) })),
        },
    }
}

export const roundFactors = (dataset: Dataset): FactorTable => factorModelInputs(dataset).table

// What is known before a session's first round: the time, the gap since the last session.
// Unknowns (device, break) stay null and so add nothing.
export const upcomingContext = (options: { dataset: Dataset; now: Date }): RoundContext => {
    const { dataset, now } = options
    const day = dayKey(now)
    const lastSession = [...dataset.sessions]
        .filter(({ startedAt }) => startedAt <= now.getTime())
        .sort((a, b) => a.startedAt - b.startedAt)
        .at(-1)
    return {
        startedAt: now.getTime(),
        roundIndex: 0,
        breakBeforeMs: null,
        afterTwoBelow: false,
        firstOfDay: !dataset.rounds.some(({ startedAt }) => dayKey(startedAt) === day),
        daysSinceLastSession: lastSession === undefined ? null : differenceInCalendarDays(now, lastSession.startedAt),
        timeZoneChanged: null,
        deviceKey: null,
        inputType: null,
        experiment: null,
    }
}

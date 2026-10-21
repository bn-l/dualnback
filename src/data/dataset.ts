import { type ScoredRound, scoreRound } from '../domain/scoring'
import type { Store } from './db'
import type {
    BaselineRecord,
    ExperimentRecord,
    FocusEventRecord,
    PressRecord,
    RoundRecord,
    ScreenViewRecord,
    SessionRecord,
    TrialRecord,
} from './schema'

// Everything the analysis reads, loaded in one go. Even years of daily play is a few
// hundred thousand small records, which fits comfortably in memory.
export interface Dataset {
    sessions: SessionRecord[]
    rounds: RoundRecord[]
    trials: TrialRecord[]
    presses: PressRecord[]
    focusEvents: FocusEventRecord[]
    screenViews: ScreenViewRecord[]
    baselines: BaselineRecord[]
    experiments: ExperimentRecord[]
    // Completed rounds only, oldest first.
    scored: ScoredRound[]
}

const groupBy = <T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> =>
    items.reduce((groups, item) => groups.set(key(item), [...(groups.get(key(item)) ?? []), item]),
        new Map<string, T[]>())

export const scoreAll = (
    rounds: readonly RoundRecord[],
    trials: readonly TrialRecord[],
    presses: readonly PressRecord[],
): ScoredRound[] => {
    const trialsByRound = groupBy(trials, ({ roundId }) => roundId)
    const pressesByRound = groupBy(presses, ({ roundId }) => roundId)
    return rounds
        .filter((round) => round.completed && round.result !== null)
        .sort((a, b) => a.startedAt - b.startedAt)
        .map((round) => scoreRound(round, trialsByRound.get(round.id) ?? [], pressesByRound.get(round.id) ?? []))
}

export const loadDataset = async (store: Store): Promise<Dataset> => {
    const [sessions, rounds, trials, presses, focusEvents, screenViews, baselines, experiments] = await Promise.all([
        store.sessions.orderBy('startedAt').toArray(),
        store.rounds.orderBy('startedAt').toArray(),
        store.trials.toArray(),
        store.presses.toArray(),
        store.focusEvents.toArray(),
        store.screenViews.orderBy('enteredAt').toArray(),
        store.baselines.orderBy('at').toArray(),
        store.experiments.orderBy('createdAt').toArray(),
    ])
    return {
        sessions,
        rounds,
        trials,
        presses,
        focusEvents,
        screenViews,
        baselines,
        experiments,
        scored: scoreAll(rounds, trials, presses),
    }
}

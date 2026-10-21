import { Dexie, type EntityTable } from 'dexie'
import { INITIAL_RATING } from '../domain/rating'
import type {
    BaselineRecord,
    ExperimentRecord,
    FindingRecord,
    FocusEventRecord,
    PressRecord,
    RoundRecord,
    ScreenViewRecord,
    SessionRecord,
    Settings,
    TrialRecord,
} from './schema'

const DB_NAME = 'dual-n-back'
const SCHEMA_VERSION = 1

export class Store extends Dexie {
    declare readonly sessions: EntityTable<SessionRecord, 'id'>
    declare readonly rounds: EntityTable<RoundRecord, 'id'>
    declare readonly trials: EntityTable<TrialRecord, 'id'>
    declare readonly presses: EntityTable<PressRecord, 'id'>
    declare readonly focusEvents: EntityTable<FocusEventRecord, 'id'>
    declare readonly screenViews: EntityTable<ScreenViewRecord, 'id'>
    declare readonly baselines: EntityTable<BaselineRecord, 'id'>
    declare readonly experiments: EntityTable<ExperimentRecord, 'id'>
    declare readonly findings: EntityTable<FindingRecord, 'id'>
    declare readonly settings: EntityTable<Settings, 'key'>

    constructor(name = DB_NAME) {
        super(name)
        this.version(SCHEMA_VERSION).stores({
            sessions: 'id, startedAt',
            rounds: 'id, sessionId, startedAt',
            trials: 'id, roundId, sessionId',
            presses: 'id, roundId, sessionId',
            focusEvents: 'id, roundId',
            screenViews: 'id, sessionId, enteredAt',
            baselines: 'id, at',
            experiments: 'id, createdAt',
            findings: 'id, status',
            settings: 'key',
        })
    }
}

export const DEFAULT_SETTINGS: Settings = {
    key: 'settings',
    dailyBaseline: true,
    soundOn: true,
    rating: INITIAL_RATING,
    ratingUpdatedAt: null,
}

// Saved settings over the defaults, so a field added later still has a value.
export const loadSettings = async (store: Store): Promise<Settings> =>
    ({ ...DEFAULT_SETTINGS, ...(await store.settings.get('settings')) })

export const saveSettings = async (store: Store, changes: Partial<Omit<Settings, 'key'>>): Promise<Settings> => {
    const next = { ...(await loadSettings(store)), ...changes }
    await store.settings.put(next)
    return next
}

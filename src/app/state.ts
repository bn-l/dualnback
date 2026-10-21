import { createSignal } from 'solid-js'
import { DEFAULT_SETTINGS, Store } from '../data/db'
import type { Dataset } from '../data/dataset'
import type { FindingRecord, RoundRecord, SessionRecord, Settings } from '../data/schema'
import type { ScoredRound } from '../domain/scoring'
import type { LetterBank } from '../engine/audio'

export type Screen =
    | { name: 'home' }
    | { name: 'baseline' }
    | { name: 'ready' }
    | { name: 'play' }
    | { name: 'results' }
    | { name: 'detail' }
    | { name: 'session-end' }
    | { name: 'stats'; group: number; page: number }
    | { name: 'stat'; id: string; group: number; page: number }
    | { name: 'insights'; index: number }
    | { name: 'history'; page: number }
    | { name: 'more' }
    | { name: 'experiments' }
    | { name: 'new-experiment'; question: string; conditionA: string; conditionB: string }
    | { name: 'weekly' }
    | { name: 'how-to-play'; back: Screen }
    // Settings opens over any screen and returns to it.
    | { name: 'settings'; back: Screen }
    | { name: 'confirm-delete'; back: Screen }

export interface ActiveSession {
    record: SessionRecord
    rounds: RoundRecord[]
    lastScored: ScoredRound | null
    lastRoundEndedAt: number | null
}

export const APP_OPENED_AT = Date.now()

export const store = new Store()

export const [screen, setScreen] = createSignal<Screen>({ name: 'home' })
export const [settings, setSettings] = createSignal<Settings>(DEFAULT_SETTINGS)
export const [dataset, setDataset] = createSignal<Dataset | null>(null)
export const [findingRecords, setFindingRecords] = createSignal<FindingRecord[]>([])
export const [session, setSession] = createSignal<ActiveSession | null>(null)
export const [letterBank, setLetterBank] = createSignal<LetterBank | null>(null)
// Problems the person needs to know about (sound failed to load, storage full).
export const [problem, setProblem] = createSignal<string | null>(null)

export const go = (next: Screen): void => {
    setScreen(next)
}

// The settings button in the top bar opens settings, and from settings goes back. Leaving
// the play screen stops the round (its cleanup), which is saved as paused, so going back
// lands on that round's results.
export const toggleSettings = (): void => {
    const current = screen()
    if (current.name === 'settings' || current.name === 'confirm-delete') {
        go(current.back)
        return
    }
    go({ name: 'settings', back: current.name === 'play' ? { name: 'results' } : current })
}

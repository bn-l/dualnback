import { strToU8, zipSync } from 'fflate'
import Papa from 'papaparse'
import { loadDataset } from '../data/dataset'
import { loadSettings } from '../data/db'
import { dayKey } from '../domain/format'
import { log } from '../log'
import { setDataset, setFindingRecords, setSettings, store } from './state'

// Exports and imports. A JSON export holds every table as it is stored, and imports back
// into this app on any device.

const tables = () => ({
    sessions: store.sessions,
    rounds: store.rounds,
    trials: store.trials,
    presses: store.presses,
    focusEvents: store.focusEvents,
    screenViews: store.screenViews,
    baselines: store.baselines,
    experiments: store.experiments,
    findings: store.findings,
    settings: store.settings,
})

const readAll = async (): Promise<Array<[string, object[]]>> =>
    Promise.all(Object.entries(tables()).map(async ([name, table]): Promise<[string, object[]]> => [name, await table.toArray()]))

const download = (blob: Blob, name: string): void => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    URL.revokeObjectURL(url)
}

// Nested fields become dotted columns ("flags.hidden"); lists are written as JSON.
const flatten = (value: object, prefix = ''): Record<string, unknown> => {
    const fields: Array<[string, unknown]> = Object.entries(value)
    return fields.reduce<Record<string, unknown>>((row, [key, field]) => {
        const column = `${prefix}${key}`
        if (Array.isArray(field)) {
            return { ...row, [column]: JSON.stringify(field) }
        }
        if (field !== null && typeof field === 'object') {
            return { ...row, ...flatten(field, `${column}.`) }
        }
        return { ...row, [column]: field }
    }, {})
}

const fileName = (extension: string): string => `dual-n-back-${dayKey(Date.now())}.${extension}`

export const exportJson = async (): Promise<void> => {
    const data = Object.fromEntries(await readAll())
    download(new Blob([JSON.stringify(data)], { type: 'application/json' }), fileName('json'))
    log.info('export', 'json written')
}

export const exportCsv = async (): Promise<void> => {
    const files = Object.fromEntries((await readAll()).map(([name, rows]) =>
        [`${name}.csv`, strToU8(Papa.unparse(rows.map((row) => flatten(row))))]))
    download(new Blob([zipSync(files)], { type: 'application/zip' }), fileName('zip'))
    log.info('export', 'csv zip written', Object.keys(files))
}

// ---------- import ----------

type Row = Record<string, unknown>

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)

// Every table's rows have a string id, except settings, which is one row under a key.
const idField = (table: string): string => table === 'settings' ? 'key' : 'id'

const NOT_AN_EXPORT = "This file isn't a dual n-back export. Choose a .json file saved with Export as JSON."

// The tables in the file, each checked to be a list of rows with ids. A file without
// sessions and rounds isn't an export at all.
const readTables = (file: unknown): Array<[string, Row[]]> => {
    if (!isRow(file) || !Array.isArray(file.sessions) || !Array.isArray(file.rounds)) {
        throw new Error(NOT_AN_EXPORT)
    }
    return Object.keys(tables()).map((name): [string, Row[]] => {
        const rows: unknown = file[name] ?? []
        if (!Array.isArray(rows) || !rows.every((row): row is Row => isRow(row) && typeof row[idField(name)] === 'string')) {
            throw new Error(`The ${name} in this file are damaged, so nothing was imported.`)
        }
        return [name, rows]
    })
}

// Settings hold the current rating, so the file's settings only replace these if its
// rating is the more recent one.
const newerRating = (rows: readonly Row[], current: number | null): boolean => {
    const updated = rows[0]?.ratingUpdatedAt
    return typeof updated === 'number' && (current === null || updated > current)
}

export interface ImportResult {
    sessions: number
    rounds: number
}

// Adds everything in the file to what's here: a row with the same id is replaced, and
// nothing here is deleted, so importing the same file twice changes nothing. The data must
// load and score like the app's own, or the whole import is undone.
export const importJson = async (file: File): Promise<ImportResult> => {
    let parsed: unknown = null
    try {
        parsed = JSON.parse(await file.text())
    } catch (error) {
        log.warn('import', 'not JSON', file.name, error)
        throw new Error(NOT_AN_EXPORT, { cause: error })
    }
    const incoming = readTables(parsed)
    const current = await loadSettings(store)
    await store.transaction('rw', store.tables, async () => {
        await Promise.all(incoming
            .filter(([name, rows]) => name !== 'settings' || newerRating(rows, current.ratingUpdatedAt))
            .map(async ([name, rows]) => {
                await store.table(name).bulkPut(rows)
            }))
        await loadDataset(store)
    }).catch((error: unknown) => {
        log.warn('import', 'rolled back: the data would not load', file.name, error)
        throw new Error("Some of the data in this file couldn't be read, so nothing was imported.", { cause: error })
    })
    const [settings, dataset, findings] = await Promise.all([loadSettings(store), loadDataset(store), store.findings.toArray()])
    setSettings(settings)
    setDataset(dataset)
    setFindingRecords(findings)
    const counts = Object.fromEntries(incoming.map(([name, rows]) => [name, rows.length]))
    log.info('import', 'json read', file.name, counts)
    return { sessions: counts.sessions ?? 0, rounds: counts.rounds ?? 0 }
}

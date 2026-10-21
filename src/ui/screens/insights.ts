import { format, subDays } from 'date-fns'
import { createMemo, createRoot } from 'solid-js'
import html from 'solid-js/html'
import { dataset, findingRecords, go } from '../../app/state'
import type { FindingStatus } from '../../data/schema'
import type { Evidence, TrendPoint } from '../../domain/analysis-types'
import { modelFindings } from '../../domain/findings'
import { dayKey, percent, plural, signed, wholeNumber } from '../../domain/format'
import { statFindings } from '../../domain/stats'
import { closingRatings, smooth } from '../../domain/stats/overview'
import { weeklyReport } from '../../domain/weekly'
import { EvidenceBars, Heatmap, TrendChart } from '../charts'
import { Actions, Button, Screen, type View } from '../parts'

// ---------- findings ----------

interface InsightEntry {
    id: string
    sentence: string
    evidence: Evidence[]
    basis: string
    controllable: boolean
    status: FindingStatus
}

const MAX_BARS = 4

const STATUS_ORDER: Record<FindingStatus, number> = { confirmed: 0, new: 1, faded: 2 }
const STATUS_TEXT: Record<FindingStatus, string> = {
    confirmed: 'Confirmed on new data',
    new: 'New finding, not yet confirmed',
    faded: 'Faded: later rounds stopped supporting this',
}

// The model is refitted only when the data changes, not on every visit.
const entries = createRoot(() => createMemo((): InsightEntry[] => {
    const data = dataset()
    if (data === null) {
        return []
    }
    const now = new Date()
    const records = new Map(findingRecords().map((record) => [record.id, record]))
    const current = [...modelFindings(data, now), ...statFindings(data, now)]
    const currentIds = new Set(current.map(({ id }) => id))
    const live = current.map((finding): InsightEntry => ({
        ...finding,
        status: records.get(finding.id)?.status === 'confirmed' ? 'confirmed' : 'new',
    }))
    const faded = findingRecords()
        .filter((record) => record.status === 'faded' && !currentIds.has(record.id))
        .map((record): InsightEntry => ({ id: record.id, sentence: record.sentence, evidence: [], basis: '', controllable: false, status: 'faded' }))
    return [...live, ...faded].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
}))

export const InsightsScreen = (index: number): View => {
    const all = entries()
    const entry = all[Math.min(index, all.length - 1)]
    const home = Button({ label: 'Home', hotkey: 'Escape', onClick: () => go({ name: 'home' }) })
    if (entry === undefined) {
        return Screen({
            label: 'insights',
            header: html`<p class="heading">No findings yet</p>`,
            body: html`<p>
                A finding needs at least 10 rounds on each side of a comparison, and a difference too big to be chance.
                You've played ${plural(dataset()?.scored.length ?? 0, 'round')} so far.
            </p>`,
            footer: Actions(home),
        })
    }
    const position = all.indexOf(entry)
    return Screen({
        label: 'insight',
        layout: 'fill',
        header: html`
            <p class="text-quiet">${STATUS_TEXT[entry.status]}. Finding ${position + 1} of ${all.length}.</p>
            <p class="heading">${entry.sentence}</p>`,
        body: [
            entry.evidence.length > 0 ? EvidenceBars(entry.evidence.slice(0, MAX_BARS)) : null,
            entry.basis === '' ? null : html`<p class="text-quiet">${entry.basis}</p>`,
        ],
        footer: Actions(
            Button({ label: 'Next', hotkey: 'ArrowRight', primary: true, disabled: position >= all.length - 1, onClick: () => go({ name: 'insights', index: position + 1 }) }),
            Button({ label: 'Previous', hotkey: 'ArrowLeft', disabled: position === 0, onClick: () => go({ name: 'insights', index: position - 1 }) }),
            entry.controllable
                ? Button({ label: 'Test this', hotkey: 't', onClick: () => go({ name: 'new-experiment', question: entry.sentence, conditionA: 'As usual', conditionB: 'The other way' }) })
                : null,
            home,
        ),
    })
}

// ---------- history ----------

const RECENT_DAYS = 28

// The last rating of each day, smoothed over the days played either side of it.
const ratingByDay = (): TrendPoint[] => {
    const data = dataset()
    return data === null ? [] : smooth(closingRatings(data))
}

const roundsByDay = (): Map<string, number> =>
    (dataset()?.scored ?? []).reduce((days, { round }) =>
        days.set(dayKey(round.startedAt), (days.get(dayKey(round.startedAt)) ?? 0) + 1), new Map<string, number>())

export const HistoryScreen = (page: number): View => {
    const today = new Date()
    const days = roundsByDay()
    const recent = Array.from({ length: RECENT_DAYS }, (_, offset) => dayKey(subDays(today, offset)))
        .filter((day) => days.has(day)).length
    const footer = Actions(
        page === 0
            ? Button({ label: 'Days played', hotkey: 'ArrowRight', primary: true, onClick: () => go({ name: 'history', page: 1 }) })
            : Button({ label: 'Rating', hotkey: 'ArrowLeft', primary: true, onClick: () => go({ name: 'history', page: 0 }) }),
        Button({ label: 'Home', hotkey: 'Escape', onClick: () => go({ name: 'home' }) }),
    )
    if (page === 0) {
        return Screen({
            label: 'history rating',
            layout: 'fill',
            header: html`<p class="heading">Rating over time</p>`,
            body: [
                TrendChart(ratingByDay(), wholeNumber),
                html`<p class="text-quiet">${plural(dataset()?.scored.length ?? 0, 'round')} played. Each day's closing rating, smoothed over the days around it.</p>`,
            ],
            footer,
        })
    }
    return Screen({
        label: 'history days',
        layout: 'fill',
        header: html`<p class="heading">Days played</p>`,
        body: [
            Heatmap(days, today),
            html`<p class="text-quiet">Played ${recent} of the last ${RECENT_DAYS} days. Darker days had more rounds.</p>`,
        ],
        footer,
    })
}

// ---------- weekly report ----------

export const WeeklyScreen = (): View => {
    const data = dataset()
    const report = data === null ? null : weeklyReport({ dataset: data, findings: findingRecords(), now: new Date() })
    const back = Actions(Button({ label: 'Back', hotkey: 'Escape', primary: true, onClick: () => go({ name: 'more' }) }))
    if (report === null || report.ratingChange === null) {
        return Screen({
            label: 'weekly',
            layout: 'centre',
            header: html`<p class="heading">No rounds this week</p>`,
            body: html`<p>The weekly report covers the last seven days.</p>`,
            footer: back,
        })
    }
    const best = report.bestRound
    const bestAccuracy = best === null ? null : data?.rounds.find(({ id }) => id === best.roundId)?.accuracy ?? null
    return Screen({
        label: 'weekly',
        layout: 'centre',
        header: html`
            <p class="text-quiet">${format(report.from, 'MMM d')} to ${format(report.to, 'MMM d')}</p>
            <p class="number">${signed(report.ratingChange)}</p>`,
        body: [
            html`<p>${plural(report.sessions, 'session')}, ${plural(report.rounds, 'round')}.</p>`,
            best === null ? null : html`<p>
                Best round: ${best.n}-back on ${format(best.at, 'EEEE')}${bestAccuracy === null ? '.' : `, ${percent(bestAccuracy)} accuracy.`}
            </p>`,
            report.finding === null ? null : html`<p>${report.finding.sentence}</p>`,
            report.forecastError === null ? null : html`<p class="text-quiet">
                Forecasts were off by ${wholeNumber(report.forecastError)} points on average, over ${plural(report.forecastsCompared, 'session')}.
            </p>`,
        ],
        footer: back,
    })
}

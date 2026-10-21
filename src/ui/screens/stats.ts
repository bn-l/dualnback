import { createMemo, createRoot } from 'solid-js'
import html from 'solid-js/html'
import { dataset, go } from '../../app/state'
import { STAT_GROUPS, type Stat, type StatGroup } from '../../domain/analysis-types'
import { milliseconds, percent, wholeNumber } from '../../domain/format'
import { computeStats } from '../../domain/stats'
import { type Overview, type Unit, overviewFor } from '../../domain/stats/overview'
import { ColumnsChart, LinesChart, Sparkline, TrendChart } from '../charts'
import { Actions, BigValue, Button, KeyHint, Screen, type View, createSize, digit, fitCount, live, pageOf, remSize } from '../parts'

// The row button's height and the list's gap in rem, as in the classes below (min-h-14, gap-4).
const ROW_HEIGHT = 3.5
const ROW_GAP = 1
// Rows are opened with the digit keys.
const MAX_ROWS = 9
// Shown before the list has measured itself, so rows (and their keys) are there at once.
const ROWS_BEFORE_MEASURING = 4
const DECIMALS = 10

const allStats = createRoot(() => createMemo((): Stat[] => {
    const data = dataset()
    return data === null ? [] : computeStats(data, new Date())
}))

const allOverviews = createRoot(() => createMemo((): Map<StatGroup, Overview | null> => {
    const data = dataset()
    return new Map(STAT_GROUPS.map(({ id }) => [id, data === null ? null : overviewFor(id, data)]))
}))

// Trend labels use the same unit as the stat's own display.
const formatLike = (stat: Stat) => (value: number): string =>
    stat.display.endsWith(' ms') ? milliseconds(value)
        : stat.display.endsWith('%') ? percent(value)
            : String(Math.round(value * DECIMALS) / DECIMALS)

const FORMAT: Record<Unit, (value: number) => string> = {
    percent,
    ms: milliseconds,
    rating: wholeNumber,
    rounds: wholeNumber,
}

// The least a chart's scale spans, so a few points' wobble isn't drawn as a swing.
const MIN_SPAN: Record<Unit, number> = { percent: 0.2, ms: 200, rating: 50, rounds: 0 }

const OverviewChart = (overview: Overview): View => html`
    <p class="text-quiet">${overview.caption}</p>
    ${overview.kind === 'lines'
        ? LinesChart(overview.series, FORMAT[overview.unit], MIN_SPAN[overview.unit])
        : ColumnsChart(overview.columns, FORMAT[overview.unit])}`

// A stat's name, its recent trend when the row has room for it, and its value.
const StatRow = (stat: Stat, index: number, from: { group: number; page: number }): View =>
    html`<button
        type="button"
        class="group flex min-h-14 items-center gap-4 rounded-lg bg-surface px-5 text-left hover:bg-surface-down focus-visible:bg-surface-down"
        aria-keyshortcuts=${digit(index)}
        data-hotkey=${digit(index)}
        onClick=${() => go({ name: 'stat', id: stat.id, ...from })}
    >
        <span class="min-w-0 flex-1">${stat.name}</span>
        <span class="hidden @min-[30rem]:contents">${Sparkline(stat.trend)}</span>
        <span class="whitespace-nowrap font-bold">${stat.display}</span>
        ${KeyHint(digit(index))}
    </button>`

// Each group opens on its chart, when there's enough data for one, then lists its stats a
// page at a time, as many rows as fit.
export const StatsScreen = (group: number, page: number): View => {
    const { measure, size } = createSize()
    const groupInfo = STAT_GROUPS[group] ?? STAT_GROUPS[0]
    const stats = allStats().filter((stat) => stat.group === groupInfo?.id)
    const overview = groupInfo === undefined ? null : allOverviews().get(groupInfo.id) ?? null
    const chartPages = overview === null ? 0 : 1
    const perPage = (): number => size().height === 0 ? ROWS_BEFORE_MEASURING : Math.min(MAX_ROWS, fitCount(size().height, ROW_HEIGHT * remSize(), ROW_GAP * remSize()))
    const pages = (): number => chartPages + Math.max(1, Math.ceil(stats.length / perPage()))
    const current = (): number => Math.min(page, pages() - 1)
    const lastGroup = STAT_GROUPS.length - 1
    const next = (): void => go(current() < pages() - 1
        ? { name: 'stats', group, page: current() + 1 }
        : { name: 'stats', group: group >= lastGroup ? 0 : group + 1, page: 0 })
    const previous = (): void => go(current() > 0
        ? { name: 'stats', group, page: current() - 1 }
        : { name: 'stats', group: group <= 0 ? lastGroup : group - 1, page: 0 })
    const rows = (): View => stats.length === 0
        ? html`<p>Play a round to see these.</p>`
        : pageOf(stats, current() - chartPages, perPage()).map((stat, index) => StatRow(stat, index, { group, page: current() }))
    return Screen({
        label: `stats ${groupInfo?.id ?? ''}`,
        layout: 'fill',
        header: html`
            <div class="flex items-center justify-between gap-4">
                <p class="heading">${groupInfo?.name}</p>
                ${Button({ label: 'Home', hotkey: 'Escape', onClick: () => go({ name: 'home' }) })}
            </div>
            <p class="text-quiet">
                Group ${group + 1} of ${STAT_GROUPS.length}${() => pages() > 1 ? `, page ${current() + 1} of ${pages()}` : ''}
            </p>`,
        body: html`<div ref=${measure} class="@container flex min-h-0 flex-1 flex-col gap-4">
            ${live(() => overview !== null && current() < chartPages ? OverviewChart(overview) : rows())}
        </div>`,
        footer: Actions(
            Button({ label: 'Previous', hotkey: 'ArrowLeft', onClick: previous }),
            Button({ label: 'Next', hotkey: 'ArrowRight', onClick: next }),
        ),
    })
}

// One stat in full, opened from a row; Back returns to that row's page.
export const StatScreen = ({ id, group, page }: { id: string; group: number; page: number }): View => {
    const stat = allStats().find((candidate) => candidate.id === id)
    const back = Actions(Button({ label: 'Back', hotkey: 'Escape', primary: true, onClick: () => go({ name: 'stats', group, page }) }))
    if (stat === undefined) {
        return Screen({ label: 'stat', layout: 'centre', header: html`<p class="heading">That stat isn't available.</p>`, footer: back })
    }
    return Screen({
        label: `stat ${stat.id}`,
        layout: 'fill',
        header: [html`<p class="heading">${stat.name}</p>`, BigValue(stat.display)],
        body: [
            html`<p>${stat.meaning}</p>`,
            stat.technicalName === null ? null : html`<p class="text-quiet">${stat.technicalName}</p>`,
            TrendChart(stat.trend, formatLike(stat)),
        ],
        footer: back,
    })
}

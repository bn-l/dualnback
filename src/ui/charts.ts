import { scaleLinear } from 'd3-scale'
import { line } from 'd3-shape'
import { addDays, format, parseISO, startOfWeek, subWeeks } from 'date-fns'
import html from 'solid-js/html'
import type { Sense } from '../data/schema'
import type { Evidence, TrendPoint } from '../domain/analysis-types'
import { dayKey } from '../domain/format'
import type { Column, Series } from '../domain/stats/overview'
import { type Size, type View, createSize, remSize } from './parts'

// Chart rules (PLAN.md): strokes a quarter of a rem, labels at body size placed on the
// data, no gridlines or ticks, at most four labels. Charts are drawn in the measured space
// of their container, with every length below in rem.
const STROKE = 0.25
const LABEL_LINE = 1.75
const LABEL_GAP = 0.5
const VALUE_OFFSET = 1
const BAR_HEIGHT = 1.5
const BAR_GAP = 0.5
const BAR_GROUP_GAP = 1
const MIN_BAR = 0.5
const VALUE_SPACE = 6
const LABEL_WIDTH = 6.5
const LABEL_SHARE_LIMIT = 4
const HEATMAP_GAP = 0.25
const MAX_CELL = 1.5
const HALF = 2
// Strip bars are a share of the strip's height, never thinner than this.
const MIN_STRIP = 0.1
const PERCENT = 100
// Evidence bars start a little below the smallest value, so differences are visible.
const BAR_FLOOR_SHARE = 0.5
const DAYS_PER_WEEK = 7
const HEATMAP_MIN_WEEKS = 4
const LIGHT_DAY = 2
// Columns take this share of their slot, up to a width.
const COLUMN_SHARE = 0.56
const MAX_COLUMN = 3
const COLUMN_RADIUS = 0.5

// SVG shapes made one at a time, for charts that draw a list of them: solid-js/html parses
// each template as HTML, where a <rect> or <g> on its own isn't SVG.
const SVG = 'http://www.w3.org/2000/svg'

const shape = (tag: string, attributes: Record<string, string | number>, text = ''): SVGElement => {
    const element = document.createElementNS(SVG, tag)
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)))
    element.textContent = text
    return element
}

const LABEL = 'fill-ink text-body'
const QUIET_LABEL = 'fill-quiet text-body'

// A chart that fills the space it's given and redraws when that space changes.
const measuredChart = (draw: (size: Size) => View): View => {
    const { measure, size } = createSize()
    return html`<div ref=${measure} class="min-h-0 flex-1">${() => size().height === 0 ? null : draw(size())}</div>`
}

// ---------- accuracy across a round ----------

const SENSE_LABEL: Record<Sense, string> = { position: 'Position', sound: 'Sound' }
const STRIP_COLOUR: Record<Sense, string> = { position: 'bg-position', sound: 'bg-sound-mark' }

export const Strip = (segments: Record<Sense, number[]>): View =>
    html`<div class="grid grid-cols-[max-content_max-content] items-end gap-x-4 gap-y-2" role="img" aria-label="Accuracy across the round">
        ${(['sound', 'position'] satisfies Sense[]).map((sense) => html`
            <div class="flex h-10 items-end gap-1">
                ${segments[sense].map((value) => html`<div
                    class=${`w-3.5 rounded-sm ${STRIP_COLOUR[sense]}`}
                    style=${{ height: `${Math.round(Math.max(MIN_STRIP, value) * PERCENT)}%` }}
                ></div>`)}
            </div>
            <span>${SENSE_LABEL[sense]}</span>`)}
    </div>`

// ---------- evidence bars under a finding ----------

const evidenceBars = (evidence: readonly Evidence[], size: Size): View => {
    const rem = remSize()
    const values = evidence.map(({ value }) => value)
    const high = Math.max(...values)
    const low = Math.min(...values)
    const floor = low - (high - low) * BAR_FLOOR_SHARE / (1 - BAR_FLOOR_SHARE)
    const scale = scaleLinear().domain([high === low ? low - 1 : floor, high]).range([MIN_BAR * rem, Math.max(MIN_BAR * rem, size.width - VALUE_SPACE * rem)])
    // Bars shrink to fit the space left under the sentence. With too little room for any
    // bar, the evidence is listed as text instead.
    const labelRows = (LABEL_LINE + BAR_GAP + BAR_GROUP_GAP) * rem
    const fitted = Math.min(BAR_HEIGHT * rem, Math.floor(size.height / Math.max(1, evidence.length)) - labelRows)
    if (fitted < MIN_BAR * rem) {
        return evidence.map((item) => html`<p>${item.label}: ${item.display}</p>`)
    }
    const rowHeight = fitted + labelRows
    return html`<svg class="block w-full" viewBox=${`0 0 ${size.width} ${Math.min(size.height, evidence.length * rowHeight)}`} role="img" aria-label="Evidence">
        ${evidence.map((item, index) => {
            const top = index * rowHeight
            const width = scale(item.value)
            return [
                shape('rect', { x: 0, y: top, width, height: fitted, rx: Math.min(LABEL_GAP * rem, fitted / HALF), class: 'fill-ink' }),
                shape('text', { x: width + VALUE_OFFSET * rem, y: top + fitted / HALF + LABEL_GAP * rem, class: LABEL }, item.display),
                shape('text', { x: 0, y: top + fitted + (BAR_GAP + LABEL_LINE - LABEL_GAP) * rem, class: LABEL }, item.label),
            ]
        })}
    </svg>`
}

export const EvidenceBars = (evidence: readonly Evidence[]): View => measuredChart((size) => evidenceBars(evidence, size))

// ---------- values over time ----------

const LINE_COLOUR: Record<Sense, string> = { position: 'stroke-position', sound: 'stroke-sound-mark' }
const KEY_COLOUR: Record<Sense, string> = { position: 'bg-position', sound: 'bg-sound-mark' }

const strokeOf = (sense: Sense | null): string => sense === null ? 'stroke-ink' : LINE_COLOUR[sense]

// One or more lines on one scale, with days spaced evenly in the order they were played. A
// single line has its first and last values beside its ends; with more than one, the
// legend above carries each line's latest value instead, since ends can collide.
const linesChart = (lines: readonly Series[], formatValue: (value: number) => string, size: Size, minSpan: number): View => {
    const days = [...new Set(lines.flatMap(({ points }) => points.map(({ day }) => day)))].sort((a, b) => a.localeCompare(b))
    const firstDay = days[0]
    const lastDay = days[days.length - 1]
    const values = lines.flatMap(({ points }) => points.map(({ value }) => value))
    if (firstDay === undefined || lastDay === undefined || values.length === 0) {
        return null
    }
    const rem = remSize()
    const single = lines.length === 1 ? lines[0] : undefined
    const top = (single === undefined ? STROKE : LABEL_LINE + STROKE) * rem
    const bottom = Math.max(top + 1, size.height - (LABEL_LINE + LABEL_GAP) * rem)
    // Room for the end labels, but never more than a quarter of the width each side.
    const inset = single === undefined ? STROKE * rem : Math.min(LABEL_WIDTH * rem, size.width / LABEL_SHARE_LIMIT)
    const offset = VALUE_OFFSET * rem
    const gap = LABEL_GAP * rem
    const dayIndex = new Map(days.map((day, index) => [day, index]))
    const x = scaleLinear().domain([0, Math.max(1, days.length - 1)]).range([inset, Math.max(inset, size.width - inset)])
    // The scale spans at least minSpan, so small wobbles don't fill the height.
    const low = Math.min(...values)
    const high = Math.max(...values)
    const pad = Math.max(0, minSpan - (high - low)) / HALF
    const y = scaleLinear().domain([low - pad, high + pad]).range([bottom, top])
    const pathOf = (points: readonly TrendPoint[]): string =>
        line<TrendPoint>().x(({ day }) => x(dayIndex.get(day) ?? 0)).y(({ value }) => y(value))(points) ?? ''
    const first = single?.points[0]
    const last = single?.points[single.points.length - 1]
    return html`<svg class="block size-full" viewBox=${`0 0 ${size.width} ${size.height}`} role="img" aria-label="Trend over time">
        ${lines.map(({ sense, points }) => shape('path', {
            'd': pathOf(points),
            'fill': 'none',
            'class': strokeOf(sense),
            'stroke-width': STROKE * rem,
            'stroke-linejoin': 'round',
            'stroke-linecap': 'round',
        }))}
        ${first === undefined || last === undefined ? null : [
            shape('text', { x: x(dayIndex.get(last.day) ?? 0) + offset, y: y(last.value) + gap, class: LABEL }, formatValue(last.value)),
            shape('text', { 'x': x(0) - offset, 'y': y(first.value) + gap, 'text-anchor': 'end', 'class': LABEL }, formatValue(first.value)),
        ]}
        <text x=${x(0)} y=${size.height - gap} class=${QUIET_LABEL}>${format(parseISO(firstDay), 'MMM d')}</text>
        <text x=${x(days.length - 1)} y=${size.height - gap} text-anchor="end" class=${QUIET_LABEL}>${format(parseISO(lastDay), 'MMM d')}</text>
    </svg>`
}

const Legend = (lines: readonly Series[], formatValue: (value: number) => string): View =>
    html`<p class="flex flex-wrap gap-x-6 gap-y-1">
        ${lines.map(({ sense, label, points }) => {
            const latest = points[points.length - 1]
            return html`<span class="flex items-center gap-2 whitespace-nowrap">
                <span class=${`h-1 w-6 rounded-full ${sense === null ? 'bg-ink' : KEY_COLOUR[sense]}`} aria-hidden="true"></span>
                ${label}${latest === undefined ? '' : html`<span class="font-bold">${formatValue(latest.value)}</span>`}
            </span>`
        })}
    </p>`

export const LinesChart = (lines: readonly Series[], formatValue: (value: number) => string, minSpan = 0): View =>
    lines.every(({ points }) => points.length < LIGHT_DAY)
        ? html`<p class="min-h-0 flex-1 text-quiet">A trend needs at least two days of data.</p>`
        : html`<div class="flex min-h-0 flex-1 flex-col gap-2">
            ${lines.length > 1 ? Legend(lines, formatValue) : null}
            ${measuredChart((size) => linesChart(lines, formatValue, size, minSpan))}
        </div>`

export const TrendChart = (points: readonly TrendPoint[], formatValue: (value: number) => string): View =>
    LinesChart([{ sense: null, label: '', points }], formatValue)

// ---------- a few categories ----------

interface Box {
    left: number
    top: number
    width: number
    height: number
}

// A column with its top corners rounded and its foot square on the baseline.
const roundedTop = ({ left, top, width, height }: Box, radius: number): string => {
    const r = Math.min(radius, height, width / HALF)
    return `M${left},${top + height}V${top + r}Q${left},${top} ${left + r},${top}H${left + width - r}Q${left + width},${top} ${left + width},${top + r}V${top + height}Z`
}

// Columns grow from zero, with their value on top and their name underneath. A column
// without enough data has a name but no column.
const columnsChart = (columns: readonly Column[], formatValue: (value: number) => string, size: Size): View => {
    const rem = remSize()
    const slot = size.width / Math.max(1, columns.length)
    const width = Math.min(slot * COLUMN_SHARE, MAX_COLUMN * rem)
    const radius = COLUMN_RADIUS * rem
    const top = (LABEL_LINE + LABEL_GAP) * rem
    const baseline = Math.max(top + 1, size.height - (LABEL_LINE + LABEL_GAP) * rem)
    const high = Math.max(...columns.map(({ value }) => value ?? 0))
    const y = scaleLinear().domain([0, high > 0 ? high : 1]).range([baseline, top])
    return html`<svg class="block size-full" viewBox=${`0 0 ${size.width} ${size.height}`} role="img" aria-label="Columns">
        ${columns.map(({ label, value }, index) => {
            const centre = slot * index + slot / HALF
            const height = value === null ? 0 : Math.max(MIN_BAR * rem, baseline - y(value))
            return [
                value === null ? null : shape('path', { d: roundedTop({ left: centre - width / HALF, top: baseline - height, width, height }, radius), class: 'fill-ink' }),
                value === null ? null : shape('text', { 'x': centre, 'y': baseline - height - LABEL_GAP * rem, 'text-anchor': 'middle', 'class': LABEL }, formatValue(value)),
                shape('text', { 'x': centre, 'y': size.height - LABEL_GAP * rem, 'text-anchor': 'middle', 'class': QUIET_LABEL }, label),
            ]
        })}
    </svg>`
}

export const ColumnsChart = (columns: readonly Column[], formatValue: (value: number) => string): View =>
    measuredChart((size) => columnsChart(columns, formatValue, size))

// ---------- a small trend beside a value ----------

const SPARK_WIDTH = 100
const SPARK_HEIGHT = 32
const SPARK_MARGIN = 3

// Drawn in a fixed box that the CSS stretches to the row, so the line keeps its weight
// (non-scaling stroke) and needs no measuring.
export const Sparkline = (points: readonly TrendPoint[]): View => {
    if (points.length < LIGHT_DAY) {
        return null
    }
    const values = points.map(({ value }) => value)
    const x = scaleLinear().domain([0, points.length - 1]).range([SPARK_MARGIN, SPARK_WIDTH - SPARK_MARGIN])
    const y = scaleLinear().domain([Math.min(...values), Math.max(...values)]).range([SPARK_HEIGHT - SPARK_MARGIN, SPARK_MARGIN])
    // A flat trend (one value throughout) draws across the middle.
    const path = line<TrendPoint>().x((_, index) => x(index)).y(({ value }) => y(value))(points) ?? ''
    return html`<svg class="h-7 w-24 shrink-0" viewBox=${`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        <path d=${path} fill="none" class="stroke-quiet [stroke-width:0.1875rem]" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"></path>
    </svg>`
}

// ---------- days played ----------

const shade = (rounds: number): string =>
    rounds === 0 ? 'fill-surface' : rounds <= LIGHT_DAY ? 'fill-quiet' : 'fill-ink'

const heatmap = (roundsByDay: ReadonlyMap<string, number>, today: Date, size: Size): View => {
    const rem = remSize()
    const spacing = HEATMAP_GAP * rem
    const labelLine = LABEL_LINE * rem
    const available = size.height - (LABEL_LINE + LABEL_GAP) * rem
    const cell = Math.max(1, Math.min(MAX_CELL * rem, Math.floor((available - spacing * (DAYS_PER_WEEK - 1)) / DAYS_PER_WEEK)))
    const weeks = Math.max(HEATMAP_MIN_WEEKS, Math.floor((size.width + spacing) / (cell + spacing)))
    const start = startOfWeek(subWeeks(today, weeks - 1), { weekStartsOn: 1 })
    const days = Array.from({ length: weeks * DAYS_PER_WEEK }, (_, index) => addDays(start, index))
    const gridHeight = DAYS_PER_WEEK * (cell + spacing)
    return html`<svg class="block size-full" viewBox=${`0 0 ${size.width} ${size.height}`} role="img" aria-label="Days played">
        ${days.filter((day) => day <= today).map((day, index) => shape('rect', {
            x: Math.floor(index / DAYS_PER_WEEK) * (cell + spacing),
            y: (index % DAYS_PER_WEEK) * (cell + spacing),
            width: cell,
            height: cell,
            rx: spacing,
            class: shade(roundsByDay.get(dayKey(day)) ?? 0),
        }))}
        <text x="0" y=${gridHeight + labelLine} class=${QUIET_LABEL}>${format(start, 'MMM d')}</text>
        <text x=${(weeks - 1) * (cell + spacing) + cell} y=${gridHeight + labelLine} text-anchor="end" class=${QUIET_LABEL}>Today</text>
    </svg>`
}

export const Heatmap = (roundsByDay: ReadonlyMap<string, number>, today: Date): View =>
    measuredChart((size) => heatmap(roundsByDay, today, size))

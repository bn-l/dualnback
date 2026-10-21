import { createEffect, createSignal, on, onCleanup, onMount } from 'solid-js'
import html from 'solid-js/html'
import { sayLetter } from '../../app/controller'
import { type Screen as Route, go } from '../../app/state'
import type { Sense } from '../../data/schema'
import { trialCountFor } from '../../domain/sequence'
import { log } from '../../log'
import { Board, RoundControls } from '../board'
import { Button, Kbd, type Size, TopBar, type View, live, remSize } from '../parts'

// How to play: the real play screen, still, with one part at a time lit up and the rest
// darkened, and a note beside it. It walks through four squares of a 2-back round, with
// their letters played aloud, then the round's buttons.

const N = 2
const TOP_RIGHT = 2
const MIDDLE = 4
const BOTTOM_LEFT = 6

interface Stop {
    // The `data-tour` name of the part this stop points at; null darkens everything.
    target: string | null
    lit: number | null
    trial: number
    down: Sense | null
    // Played as the stop opens, as a round would.
    letter: string | null
    text: () => View
}

// "press A" with keys, "tap Position" on a touch screen.
const answer = (key: string, button: string): View => [
    html`<span class="coarse:hidden">press ${Kbd(key)}</span>`,
    html`<span class="hidden coarse:inline">tap ${button}</span>`,
]

const FIRST: Stop = {
    target: 'grid', lit: TOP_RIGHT, trial: 1, down: null, letter: 'c',
    text: () => 'Every few seconds a square lights up and you hear a letter. This one is top right, with C.',
}

const STOPS: readonly Stop[] = [
    FIRST,
    {
        target: 'n', lit: TOP_RIGHT, trial: 1, down: null, letter: null,
        text: () => `This is ${N}-back: you compare each square, and each letter, with the one ${N} steps before it.`,
    },
    {
        target: 'grid', lit: MIDDLE, trial: 2, down: null, letter: 'h',
        text: () => `Next, the middle, with H. There's nothing ${N} steps back yet, so there's nothing to do.`,
    },
    {
        target: 'grid', lit: TOP_RIGHT, trial: 3, down: null, letter: 'k',
        text: () => `Top right again, with K. The square is where it was ${N} steps back: a position match.`,
    },
    {
        target: 'position', lit: TOP_RIGHT, trial: 3, down: 'position', letter: null,
        text: () => html`<span>For a position match, ${answer('a', 'Position')}.</span>`,
    },
    {
        target: 'grid', lit: BOTTOM_LEFT, trial: 4, down: null, letter: 'h',
        text: () => `Bottom left, with H. You heard H ${N} steps back: a sound match.`,
    },
    {
        target: 'sound', lit: BOTTOM_LEFT, trial: 4, down: 'sound', letter: null,
        text: () => html`<span>For a sound match, ${answer('l', 'Sound')}. When both match, answer both. When neither does, which is most of the time, do nothing.</span>`,
    },
    {
        target: 'controls', lit: null, trial: 4, down: null, letter: null,
        text: () => [
            html`<span class="coarse:hidden">${Kbd('Escape')} pauses the round, ${Kbd('m')} turns the letters off (a round without them isn't rated), and ${Kbd('g')} opens settings.</span>`,
            html`<span class="hidden coarse:inline">The bars pause the round, the speaker turns the letters off (a round without them isn't rated), and the gear opens settings.</span>`,
        ],
    },
    {
        target: null, lit: null, trial: 4, down: null, letter: null,
        text: () => `A round is ${trialCountFor(N)} squares and takes about a minute. A session is 5 rounds, the last a step harder. Your rating moves after every round, and N goes up with it.`,
    },
]

interface Rect {
    left: number
    top: number
    width: number
    height: number
}

// Room around a lit part, its corners, and the callout's distance from it and from the
// edges, all in rem.
const PAD = 0.5
const RADIUS = 1
const GAP = 1
const MARGIN = 1
const HALF = 2

const roundedRect = ({ left, top, width, height }: Rect, radius: number): string => {
    const r = Math.min(radius, width / HALF, height / HALF)
    const right = left + width
    const bottom = top + height
    return `M${left + r},${top}H${right - r}A${r},${r} 0 0 1 ${right},${top + r}V${bottom - r}A${r},${r} 0 0 1 ${right - r},${bottom}` +
        `H${left + r}A${r},${r} 0 0 1 ${left},${bottom - r}V${top + r}A${r},${r} 0 0 1 ${left + r},${top}Z`
}

const padded = (rect: Rect, pad: number): Rect =>
    ({ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * HALF, height: rect.height + pad * HALF })

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value))

const contains = (outer: Rect, inner: Rect): boolean =>
    inner.left >= outer.left && inner.top >= outer.top &&
    inner.left + inner.width <= outer.left + outer.width && inner.top + inner.height <= outer.top + outer.height

export interface Layout {
    area: Size
    // The play board, header to answers.
    board: Rect | null
    hole: Rect | null
}

// On a wide screen, beside the board, level with the lit part, so the board stays in
// view. Otherwise under the lit part, else over it, else against whichever edge has more
// space. With nothing lit, in the middle.
export const place = ({ area, board, hole }: Layout, box: Size, rem: number): { left: number; top: number } => {
    const gap = GAP * rem
    const margin = MARGIN * rem
    if (hole === null) {
        return { left: (area.width - box.width) / HALF, top: (area.height - box.height) / HALF }
    }
    const level = clamp(hole.top + (hole.height - box.height) / HALF, margin, area.height - box.height - margin)
    if (board !== null && contains(padded(board, gap), hole) && area.width - (board.left + board.width) - gap - margin >= box.width) {
        return { left: board.left + board.width + gap, top: level }
    }
    const bottom = hole.top + hole.height
    const left = clamp(hole.left + (hole.width - box.width) / HALF, margin, Math.max(margin, area.width - box.width - margin))
    if (bottom + gap + box.height <= area.height - margin) {
        return { left, top: bottom + gap }
    }
    if (hole.top - gap - box.height >= margin) {
        return { left, top: hole.top - gap - box.height }
    }
    return { left, top: area.height - bottom > hole.top ? area.height - margin - box.height : margin }
}

const toRem = (pixels: number): string => `${pixels / remSize()}rem`

export const HowToPlayScreen = (back: Route): View => {
    const [index, setIndex] = createSignal(0)
    const [layout, setLayout] = createSignal<Layout>({ area: { width: 0, height: 0 }, board: null, hole: null })
    // The callout's whole box, padding included, so it's kept clear of the edges.
    const [callout, setCallout] = createSignal<Size>({ width: 0, height: 0 })
    const calloutObserver = new ResizeObserver(([entry]) => {
        const box = entry?.borderBoxSize[0]
        if (box !== undefined) {
            setCallout({ width: box.inlineSize, height: box.blockSize })
        }
    })
    const stop = (): Stop => STOPS[index()] ?? FIRST
    const last = (): boolean => index() === STOPS.length - 1
    let frame: HTMLElement | null = null

    // Where the board and the lit part are, in the frame's own coordinates, kept current as
    // the window changes.
    const measure = (): void => {
        if (frame === null) {
            return
        }
        const box = frame.getBoundingClientRect()
        const within = (element: Element | null | undefined): Rect | null => {
            const rect = element?.getBoundingClientRect()
            return rect === undefined ? null : { left: rect.left - box.left, top: rect.top - box.top, width: rect.width, height: rect.height }
        }
        const { target } = stop()
        const element = target === null ? null : frame.querySelector(`[data-tour="${target}"]`)
        if (target !== null && element === null) {
            log.warn('how to play', 'nothing to point at', target)
        }
        const hole = within(element)
        setLayout({
            area: { width: box.width, height: box.height },
            board: within(frame.querySelector('.play-board')),
            hole: hole === null ? null : padded(hole, PAD * remSize()),
        })
    }
    const observer = new ResizeObserver(measure)
    onMount(() => {
        if (frame !== null) {
            observer.observe(frame)
        }
        void document.fonts.ready.then(measure)
    })
    onCleanup(() => {
        observer.disconnect()
        calloutObserver.disconnect()
    })
    createEffect(on(index, () => {
        measure()
        const { letter } = stop()
        if (letter !== null) {
            sayLetter(letter)
        }
    }))

    const next = (): void => {
        if (last()) {
            go(back)
        } else {
            setIndex(index() + 1)
        }
    }

    const scrim = (): View => {
        const { area: { width, height }, hole: lit } = layout()
        const outside = `M0,0H${width}V${height}H0Z`
        return html`<svg class="absolute inset-0 size-full" viewBox=${`0 0 ${width} ${height}`} aria-hidden="true" data-scrim>
            <path d=${lit === null ? outside : `${outside}${roundedRect(lit, RADIUS * remSize())}`} fill-rule="evenodd" class="fill-scrim"></path>
        </svg>`
    }

    const position = (): Record<string, string> => {
        const box = callout()
        if (box.width === 0) {
            return { visibility: 'hidden' }
        }
        const { left, top } = place(layout(), box, remSize())
        return { left: toRem(left), top: toRem(top) }
    }

    return html`<main
        class="frame grid grid-rows-[auto_minmax(0,1fr)]"
        aria-label="how to play"
        data-screen="how to play"
        ref=${(element: HTMLElement) => { frame = element }}
    >
        ${TopBar(html`<div class="contents" inert>${RoundControls({ onSound: () => undefined, onPause: () => undefined })}</div>`)}
        <div class="contents" inert>
            ${Board({ n: N, stretch: false, count: trialCountFor(N), trial: () => stop().trial, lit: () => stop().lit, down: () => stop().down })}
        </div>
        <div class="absolute inset-0" data-pointing-at=${() => stop().target ?? ''}>
            ${live(scrim)}
            <div
                ref=${(element: HTMLElement) => calloutObserver.observe(element)}
                class="absolute flex w-[min(26rem,calc(100%-2rem))] flex-col gap-4 rounded-xl bg-bg p-5"
                style=${position}
                role="dialog"
                aria-label="How to play"
            >
                <p class="text-quiet">${() => index() + 1} of ${STOPS.length}</p>
                <p aria-live="polite">${() => stop().text()}</p>
                <div class="flex gap-3 *:flex-1">
                    ${Button({ label: () => last() ? 'Done' : 'Continue', hotkey: 'Enter', primary: true, onClick: next })}
                    ${Button({ label: 'Exit', hotkey: 'Escape', quiet: true, onClick: () => go(back) })}
                </div>
            </div>
        </div>
    </main>`
}

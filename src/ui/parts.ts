import { Settings, createElement as createIcon } from 'lucide'
import { type Accessor, type JSX, createSignal, onCleanup, onMount } from 'solid-js'
import html from 'solid-js/html'
import { screen, toggleSettings } from '../app/state'
import { SETTINGS_KEY, hotkeyLabel } from './hotkeys'

export type View = JSX.Element

// A value, or a function that reads signals so the template keeps it current.
export type Live<T> = T | Accessor<T>

const liveText = (value: Live<string>): string => typeof value === 'string' ? value : value()
const liveFlag = (value: Live<boolean>): boolean => typeof value === 'boolean' ? value : value()

// A part of the page that follows signals. solid-js/html can't parse a template that is a
// single expression, so the part gets an element of its own that takes no part in layout.
export const live = (part: () => View): View => html`<div class="contents">${part}</div>`

// ---------- keys ----------

// A key named in running text, like "Press A".
export const Kbd = (hotkey: string): View =>
    html`<kbd class="font-mono font-medium whitespace-nowrap">${hotkeyLabel(hotkey)}</kbd>`

// The hint on a button, in quiet text (the label's colour on dark and coloured buttons).
// Hidden from screen readers, which get `aria-keyshortcuts` instead, and from touch-only
// screens, which have no keys.
export const KeyHint = (hotkey: string): View =>
    html`<kbd
        aria-hidden="true"
        class="font-mono font-medium whitespace-nowrap text-quiet coarse:hidden group-data-primary:text-bg group-data-accent:text-on-fill group-aria-pressed:text-on-fill group-data-down:text-on-fill group-data-tinted:text-current"
    >${hotkeyLabel(hotkey)}</kbd>`

// Digits 1–9 for the nth choice on a screen.
export const digit = (index: number): string => String(index + 1)

// Text fields focus themselves when their screen appears (the HTML autofocus attribute only
// works once per page load). Only with a mouse or trackpad around: on a touch-only screen,
// focus opens the on-screen keyboard. Buttons never take focus on their own, since every
// button has a key.
export const focusOnMount = (element: HTMLElement): void => {
    onMount(() => {
        if (window.matchMedia('(any-pointer: fine)').matches) {
            element.focus({ preventScroll: true })
        }
    })
}

// ---------- buttons ----------

// A focused button takes its hover colour: there are no focus rings (styles.css).
const BUTTON = [
    'group flex min-h-14 min-w-0 items-center justify-between gap-4 rounded-lg bg-surface px-5 text-left font-bold text-ink',
    'hover:bg-surface-down focus-visible:bg-surface-down disabled:cursor-default disabled:text-quiet disabled:hover:bg-surface',
    'data-primary:bg-ink data-primary:text-bg data-primary:hover:bg-ink-up data-primary:focus-visible:bg-ink-up',
    'aria-pressed:bg-chosen aria-pressed:text-on-fill aria-pressed:hover:bg-chosen',
    'data-quiet:justify-center data-quiet:bg-transparent data-quiet:px-3 data-quiet:hover:bg-surface data-quiet:focus-visible:bg-surface',
    'data-accent:bg-position data-accent:text-on-fill data-accent:hover:bg-position-down data-accent:focus-visible:bg-position-down',
].join(' ')

export interface ButtonOptions {
    label: Live<string>
    // What presses it (see hotkeys.ts) and what its hint shows.
    hotkey: string
    onClick: () => void
    primary?: boolean
    // In the highlight colour, for the one thing a newcomer should notice.
    accent?: boolean
    // No fill until hovered, for a row of ways out that shouldn't compete with the content.
    quiet?: boolean
    chosen?: Live<boolean>
    disabled?: Live<boolean>
}

export const Button = ({ label, hotkey, onClick, primary = false, accent = false, quiet = false, chosen = false, disabled = false }: ButtonOptions): View =>
    html`<button
        type="button"
        class=${BUTTON}
        data-primary=${primary ? '' : undefined}
        data-accent=${accent ? '' : undefined}
        data-quiet=${quiet ? '' : undefined}
        aria-pressed=${() => liveFlag(chosen) ? 'true' : undefined}
        aria-keyshortcuts=${hotkey}
        data-hotkey=${hotkey}
        disabled=${() => liveFlag(disabled)}
        onClick=${onClick}
    ><span class="min-w-0">${() => liveText(label)}</span>${KeyHint(hotkey)}</button>`

// Buttons that wrap onto as many rows as they need, in a block no wider than 26rem (centred
// on centred screens), so a lone button never becomes a bar across the page. The main and
// highlighted actions take a row each; the rest share the rows below in equal widths, as
// many to a row as fit without wrapping their labels.
export const Actions = (...buttons: Array<View | Accessor<View>>): View =>
    html`<div class="actions flex w-full max-w-[26rem] flex-wrap gap-3 *:flex-[1_1_0] *:min-w-max [&>[data-accent]]:basis-full [&>[data-primary]]:basis-full">${buttons}</div>`

// ---------- icons ----------

export type IconShape = typeof Settings

// A Lucide icon, drawn in the text colour around it at the weight of bold text.
export const Icon = (shape: IconShape): View =>
    createIcon(shape, { 'class': 'size-8 shrink-0', 'stroke-width': 2.25, 'aria-hidden': 'true' })

export interface IconButtonOptions {
    label: Live<string>
    hotkey: string
    icon: Live<View>
    onClick: () => void
    pressed?: Live<boolean>
}

// The icon buttons in the top bar. They are named for screen readers by their label, and
// show their key beside the icon.
export const IconButton = ({ label, hotkey, icon, onClick, pressed = false }: IconButtonOptions): View =>
    html`<button
        type="button"
        tabindex="-1"
        class="group flex min-h-11 items-center gap-2 rounded-lg px-2 text-quiet hover:bg-surface focus-visible:bg-surface aria-pressed:bg-surface aria-pressed:text-ink wide:gap-3 wide:px-3"
        aria-label=${() => liveText(label)}
        aria-pressed=${() => liveFlag(pressed) ? 'true' : undefined}
        aria-keyshortcuts=${hotkey}
        data-hotkey=${hotkey}
        onClick=${onClick}
    >${icon}${KeyHint(hotkey)}</button>`

// ---------- screen frame ----------

const inSettings = (): boolean => screen().name === 'settings' || screen().name === 'confirm-delete'

// The strip across the top of every screen: the name on the left, and on the right the
// settings button, after any controls the screen adds (the play screen's sound and pause).
// Where the name and the controls don't both fit, the controls win.
export const TopBar = (controls: View = null): View =>
    html`<div class="col-span-full flex min-h-11 items-center justify-between gap-2 after-bar">
        <p class=${`brand whitespace-nowrap ${controls === null ? '' : 'narrow:hidden'}`}>dual n-back</p>
        <div class="ml-auto flex items-center wide:gap-2" data-tour="controls">
            ${controls}
            ${IconButton({ label: 'Settings', hotkey: SETTINGS_KEY, icon: Icon(Settings), pressed: inSettings, onClick: toggleSettings })}
        </div>
    </div>`

export interface ScreenOptions {
    label: string
    header?: View
    body?: View
    footer?: View
    // 'top': under the top bar, with the actions after the content. 'fill': the middle
    // stretches to the bottom, for charts and paged lists. 'centre': everything in the
    // middle of the screen both ways, for the screens between other screens.
    layout?: 'top' | 'fill' | 'centre'
    // Pinned to the bottom edge, under centred content (the home screen's way to the rest).
    bottom?: View
}

const COLUMN = 'col-start-2 flex min-h-0 flex-col gap-6 short:gap-4'

const content = ({ header = null, body = null, footer = null }: ScreenOptions): View => html`
    <header class="flex flex-col gap-1">${header}</header>
    <section class="flex min-h-0 flex-col gap-4 overflow-hidden">${body}</section>
    <footer>${footer}</footer>`

// A column down the middle of the screen, under the top bar.
export const Screen = (options: ScreenOptions): View => {
    const { label, layout = 'top', bottom = null } = options
    return html`<main
        class="frame grid grid-cols-[1fr_minmax(0,40rem)_1fr] grid-rows-[auto_minmax(0,1fr)_auto] gap-y-6 short:gap-y-4"
        aria-label=${label}
        data-screen=${label}
        data-layout=${layout}
    >
        ${TopBar()}
        <div class=${`${COLUMN} ${layout === 'centre' ? 'justify-center-safe text-center [&_.actions]:mx-auto' : layout === 'fill' ? '[&>section]:flex-1' : ''}`}>
            ${content(options)}
        </div>
        ${bottom === null ? null : html`<nav class="col-start-2" aria-label="Elsewhere">${bottom}</nav>`}
    </main>`
}

// ---------- values ----------

// A value like "412 ms" or "83%": the number at Number size, its unit at Heading size.
// Text that isn't a number ("Not enough rounds yet") stays at Heading size.
const NUMERIC = /^([+−-]?[\d.,]+)(.*)$/

export const BigValue = (display: string): View => {
    const parts = NUMERIC.exec(display)
    if (parts === null) {
        return html`<p class="heading">${display}</p>`
    }
    const [, amount = '', unit = ''] = parts
    return html`<p><span class="number">${amount}</span><span class="heading">${unit}</span></p>`
}

// ---------- measuring ----------

export interface Size {
    width: number
    height: number
}

// An element's size in px, kept current as the viewport changes. Pass `measure` as the
// element's ref.
export const createSize = (): { measure: (element: Element) => void; size: Accessor<Size> } => {
    const [size, setSize] = createSignal<Size>({ width: 0, height: 0 })
    const observer = new ResizeObserver(([entry]) => {
        if (entry !== undefined) {
            setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
        }
    })
    onCleanup(() => observer.disconnect())
    return { measure: (element) => observer.observe(element), size }
}

// The root font size, as a measured length, for drawing at sizes given in rem.
export const remSize = (): number => Number.parseFloat(getComputedStyle(document.documentElement).fontSize)

// How many items of a given height (plus gap) fit in the measured height. Always at least one.
export const fitCount = (available: number, itemHeight: number, gap: number): number =>
    Math.max(1, Math.floor((available + gap) / (itemHeight + gap)))

export const pageOf = <T>(items: readonly T[], page: number, perPage: number): T[] =>
    items.slice(page * perPage, (page + 1) * perPage)

import { Volume2, VolumeX } from 'lucide'
import type { Accessor } from 'solid-js'
import html from 'solid-js/html'
import { settings } from '../app/state'
import type { Sense } from '../data/schema'
import { plural } from '../domain/format'
import { SQUARE_COUNT } from '../domain/letters'
import { Icon, IconButton, KeyHint, type View } from './parts'

// The play screen's board, shared by a real round and the how-to-play tour. The layout
// copies ui-mockup.png. Every size comes from the grid cell, which is worked out in CSS from
// the space under the top bar (play-board in styles.css). The header and the answers are as
// wide as the grid and a gap either side, or as wide as their words need. `data-tour` names
// the parts the tour points at.

// The round's sound button.
export const SOUND_KEY = 'm'

const SQUARES = Array.from({ length: SQUARE_COUNT }, (_, index) => index)

// Two rounded bars, as in the mockup.
const PauseIcon = (): View => html`<svg class="h-8 w-6 fill-current" viewBox="0 0 24 32" aria-hidden="true">
    <rect x="0" y="0" width="9" height="32" rx="4.5"></rect>
    <rect x="15" y="0" width="9" height="32" rx="4.5"></rect>
</svg>`

const CELL = 'cell grid place-items-center rounded-(--cell-radius) bg-surface data-lit:bg-position'

// Answer labels step down a size on narrow screens so both buttons fit beside each other.
const ANSWER = [
    'group flex min-h-(--answer) min-w-0 items-center justify-between gap-2 rounded-(--answer-radius) bg-surface px-4 data-down:text-on-fill',
    'text-[1.5rem] leading-[2rem] font-bold wide:gap-4 wide:px-8 wide:text-[2rem] wide:leading-[2.5rem]',
].join(' ')
const ANSWER_COLOUR: Record<Sense, string> = { position: 'data-down:bg-position', sound: 'data-down:bg-sound' }
const ANSWER_LABEL: Record<Sense, string> = { position: 'Position', sound: 'Sound' }
const ANSWER_KEY: Record<Sense, string> = { position: 'a', sound: 'l' }

export interface BoardOptions {
    n: number
    stretch: boolean
    count: number
    trial: Accessor<number>
    // A round's engine lights squares and presses answers on the elements itself, so it
    // collects them here. The tour sets them through `lit` and `down` instead.
    onCell?: (element: HTMLElement) => void
    onAnswer?: (sense: Sense, element: HTMLElement) => void
    lit?: Accessor<number | null>
    down?: Accessor<Sense | null>
}

const Answer = (sense: Sense, { onAnswer, down }: BoardOptions): View =>
    html`<button
        type="button"
        tabindex="-1"
        class=${`${ANSWER} ${ANSWER_COLOUR[sense]}`}
        data-tour=${sense}
        data-down=${() => down?.() === sense ? '' : undefined}
        ref=${(element: HTMLElement) => onAnswer?.(sense, element)}
    ><span>${ANSWER_LABEL[sense]}</span>${KeyHint(ANSWER_KEY[sense])}</button>`

export const Board = (options: BoardOptions): View => {
    const { n, stretch, count, trial, onCell, lit } = options
    return html`<div class="play-area grid min-h-0 place-items-center">
        <div class="play-board flex flex-col items-center">
            <div class="heading mb-(--header-gap) flex w-max min-w-(--row) items-center justify-between gap-8">
                <span data-tour="n">${n}-back${stretch ? html`<span class="text-quiet"> stretch</span>` : ''}</span>
                <span class="counter" data-tour="counter" aria-live="off">${trial} / ${count}</span>
            </div>
            <div class="grid grid-cols-[repeat(3,var(--cell))] grid-rows-[repeat(3,var(--cell))] gap-(--gap)" role="img" aria-label="Grid" data-tour="grid">
                ${SQUARES.map((index) => html`<div
                    class=${CELL}
                    data-lit=${() => lit?.() === index ? '' : undefined}
                    ref=${(element: HTMLElement) => onCell?.(element)}
                ></div>`)}
            </div>
            <p class="heading mt-(--instruction-gap) mb-(--answer-gap) text-center" data-tour="instruction">Match ${plural(n, 'step')} back</p>
            <div class="grid w-max min-w-(--row) grid-cols-2 gap-(--answers-apart)" role="group" aria-label="Answers">
                ${Answer('position', options)}
                ${Answer('sound', options)}
            </div>
        </div>
    </div>`
}

// The sound and pause buttons that sit left of settings in a round's top bar.
export const RoundControls = ({ onSound, onPause }: { onSound: () => void; onPause: () => void }): View => [
    IconButton({
        label: () => settings().soundOn ? 'Turn sound off' : 'Turn sound on',
        hotkey: SOUND_KEY,
        icon: () => Icon(settings().soundOn ? Volume2 : VolumeX),
        onClick: onSound,
    }),
    IconButton({ label: 'Pause', hotkey: 'Escape', icon: PauseIcon(), onClick: onPause }),
]

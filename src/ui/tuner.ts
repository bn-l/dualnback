import { Check } from 'lucide'
import { createSignal, untrack } from 'solid-js'
import html from 'solid-js/html'
import { ENOUGH_CONTRAST, PRESETS, type Palette, ROLES, type Role, lowestContrast } from './colours'
import { adjust, choosePreset, palette, resetPalette, setTunerOpen, tunerOpen } from './palette'
import { Actions, Button, Icon, KeyHint, type View, digit, live } from './parts'

const PRESET_SWATCHES: readonly Role[] = ['surface', 'position', 'sound', 'chosen']

// Each preset is drawn in its own colours, so it previews itself. The one in use has a tick.
const PresetButton = (preset: Palette, index: number): View =>
    html`<button
        type="button"
        class="group flex min-h-14 items-center gap-4 rounded-lg px-5 font-bold"
        data-tinted=""
        aria-pressed=${() => preset.name === palette().name ? 'true' : 'false'}
        aria-keyshortcuts=${digit(index)}
        data-hotkey=${digit(index)}
        style=${{ background: preset.background, color: preset.text }}
        onClick=${() => choosePreset(preset)}
    >
        <span class="flex flex-1 items-center gap-2 text-left">
            ${preset.name}
            <span class="hidden group-aria-pressed:contents">${Icon(Check)}</span>
        </span>
        <span class="flex gap-1.5" aria-hidden="true">
            ${PRESET_SWATCHES.map((role) => html`<span class="size-6 rounded-sm" style=${{ background: preset[role] }}></span>`)}
        </span>
        ${KeyHint(digit(index))}
    </button>`

const SWATCH = [
    'size-12 cursor-pointer rounded-md bg-transparent p-0 shadow-[0_0_0_0.125rem_var(--color-surface)] wide:size-16',
    '[&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0',
    '[&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-0',
].join(' ')

// One colour of the palette: its swatch (a colour picker), name and hex code, as in the
// mockup's palette column. Phones leave out the hex code to fit all six.
const SwatchRow = (role: Role, label: string, index: number): View => {
    const colour = (): string => palette()[role]
    const low = (): boolean => lowestContrast(palette())[role] < ENOUGH_CONTRAST
    return html`<label class="grid cursor-pointer grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-4 wide:grid-cols-[4rem_minmax(0,1fr)_auto] wide:gap-5">
        <input
            type="color"
            class=${SWATCH}
            aria-label=${label}
            aria-keyshortcuts=${digit(index)}
            data-hotkey=${digit(index)}
            value=${() => colour().toLowerCase()}
            onInput=${(event: Event) => {
                if (event.currentTarget instanceof HTMLInputElement) {
                    adjust(role, event.currentTarget.value.toUpperCase())
                }
            }}
        />
        <span class="flex flex-col">
            <span>${label}<span class="text-quiet wide:hidden">${() => low() ? ', low contrast' : ''}</span></span>
            <span class="hidden text-quiet wide:block">${() => `${colour()}${low() ? ', low contrast' : ''}`}</span>
        </span>
        ${KeyHint(digit(index))}
    </label>`
}

const TunerPanel = (): View => {
    const [page, setPage] = createSignal<'colours' | 'presets'>('colours')
    return html`<div
        class="tuner frame z-10 grid grid-cols-[minmax(0,40rem)] content-start justify-center bg-bg panel:pointer-events-none panel:grid-cols-[1fr_minmax(0,40rem)_1fr] panel:bg-transparent panel:pt-30"
        role="dialog"
        aria-label="Palette"
        data-screen="tuner"
    >
        <div class="flex flex-col gap-6 short:gap-4 panel:pointer-events-auto panel:col-start-3 panel:w-70 panel:justify-self-center">
            <p class="font-bold text-quiet">Palette</p>
            ${() => page() === 'colours'
                ? html`<div class="grid grid-cols-[repeat(auto-fill,minmax(16.25rem,1fr))] gap-3 *:min-w-0 wide:gap-4">
                    ${ROLES.map(({ role, label }, index) => SwatchRow(role, label, index))}
                </div>`
                : html`<div class="grid grid-cols-[repeat(auto-fill,minmax(16.25rem,1fr))] gap-3">
                    ${PRESETS.map((preset, index) => PresetButton(preset, index))}
                </div>`}
            <div class="[&>div>*]:basis-[7.5rem] [&>div>:last-child]:basis-full">
                ${Actions(
                    () => page() === 'colours'
                        ? Button({ label: 'Presets', hotkey: 'p', onClick: () => setPage('presets') })
                        : Button({ label: 'Colours', hotkey: 'c', onClick: () => setPage('colours') }),
                    Button({ label: 'Reset', hotkey: 'r', onClick: resetPalette }),
                    Button({ label: 'Close', hotkey: 'Escape', onClick: () => setTunerOpen(false) }),
                )}
            </div>
        </div>
    </div>`
}

// The palette column from ui-mockup.png, opened with the backtick key on any screen. On a
// wide, tall window it sits in the right margin so every change shows live; elsewhere it
// covers the screen.
export const Tuner = (): View => live(() => tunerOpen() ? untrack(TunerPanel) : null)

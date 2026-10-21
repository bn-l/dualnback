import { color } from 'd3-color'
import { interpolateRgb } from 'd3-interpolate'
import { log } from '../log'

// The six colours of a palette, as in ui-mockup.png. Quiet text and the text on coloured
// fills are derived from them (see `derived`); pressed shades are mixed in styles.css.
export interface Palette {
    name: string
    background: string
    // Buttons and empty grid cells.
    surface: string
    text: string
    position: string
    sound: string
    // Chosen options: the current goal, an experiment's length.
    chosen: string
}

export type Role = Exclude<keyof Palette, 'name'>

export const ROLES: ReadonlyArray<{ role: Role; label: string }> = [
    { role: 'background', label: 'Background' },
    { role: 'surface', label: 'Buttons' },
    { role: 'text', label: 'Text' },
    { role: 'position', label: 'Position' },
    { role: 'sound', label: 'Sound' },
    { role: 'chosen', label: 'Chosen' },
]

export const CORAL: Palette = { name: 'Coral', background: '#FAF9F6', surface: '#E8E7E3', text: '#414450', position: '#FF9C73', sound: '#DCD4F5', chosen: '#C9D6C5' }
export const NIGHT: Palette = { name: 'Night', background: '#24262E', surface: '#363944', text: '#ECEAE4', position: '#FF9C73', sound: '#B8A9EE', chosen: '#A5C49E' }

// Every preset passes the checks in `shortfalls` (tests/unit/colours.test.ts).
export const PRESETS: readonly Palette[] = [
    CORAL,
    { name: 'Sky', background: '#F7F9FA', surface: '#E4E9EC', text: '#3A4452', position: '#7CC0EC', sound: '#F6DDB8', chosen: '#D9D3EF' },
    { name: 'Sun', background: '#FBF8F1', surface: '#EDE7DA', text: '#45403A', position: '#F2BE45', sound: '#C9DDF0', chosen: '#EBD0DA' },
    { name: 'Moss', background: '#F6F8F4', surface: '#E3E8DF', text: '#3C4640', position: '#8FCB9B', sound: '#F3D3C4', chosen: '#D5D9F0' },
    NIGHT,
]

const HEX = /^#[0-9a-f]{6}$/i

export const isPalette = (value: unknown): value is Palette =>
    value !== null && typeof value === 'object' && typeof Reflect.get(value, 'name') === 'string' &&
    ROLES.every(({ role }) => {
        const colour: unknown = Reflect.get(value, role)
        return typeof colour === 'string' && HEX.test(colour)
    })

// WCAG 2 relative luminance and contrast ratio.
const CHANNEL_MAX = 255
const LINEAR_CUTOFF = 0.03928
const LINEAR_SCALE = 12.92
const GAMMA_OFFSET = 0.055
const GAMMA_SCALE = 1.055
const GAMMA = 2.4
const RED_WEIGHT = 0.2126
const GREEN_WEIGHT = 0.7152
const BLUE_WEIGHT = 0.0722
const FLARE = 0.05

const linear = (channel: number): number => {
    const value = channel / CHANNEL_MAX
    return value <= LINEAR_CUTOFF ? value / LINEAR_SCALE : ((value + GAMMA_OFFSET) / GAMMA_SCALE) ** GAMMA
}

export const luminance = (hex: string): number => {
    const parsed = color(hex)?.rgb()
    if (parsed === undefined) {
        log.error('palette', 'not a colour', hex)
        return 0
    }
    return RED_WEIGHT * linear(parsed.r) + GREEN_WEIGHT * linear(parsed.g) + BLUE_WEIGHT * linear(parsed.b)
}

export const contrast = (first: string, second: string): number => {
    const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a)
    return ((high ?? 0) + FLARE) / ((low ?? 0) + FLARE)
}

// Quiet text is the text colour faded this far toward the background.
const QUIET_SHARE = 0.82

export interface Derived {
    quiet: string
    // Labels on coloured fills (pressed answers, chosen options): whichever of text and
    // background is darker, since the fills are mid-light colours.
    onFill: string
}

export const derived = (from: Palette): Derived => ({
    quiet: color(interpolateRgb(from.background, from.text)(QUIET_SHARE))?.formatHex().toUpperCase() ?? from.text,
    onFill: luminance(from.text) < luminance(from.background) ? from.text : from.background,
})

// Text needs 4.5:1 against what it sits on (WCAG AA).
export const ENOUGH_CONTRAST = 4.5

// For each colour, the lowest contrast of any text it takes part in.
export const lowestContrast = (from: Palette): Record<Role, number> => {
    const { quiet, onFill } = derived(from)
    return {
        background: Math.min(contrast(from.text, from.background), contrast(quiet, from.background)),
        surface: Math.min(contrast(from.text, from.surface), contrast(quiet, from.surface)),
        text: Math.min(contrast(from.text, from.background), contrast(from.text, from.surface), contrast(quiet, from.surface)),
        position: contrast(onFill, from.position),
        sound: contrast(onFill, from.sound),
        chosen: contrast(onFill, from.chosen),
    }
}

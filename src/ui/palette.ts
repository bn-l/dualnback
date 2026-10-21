import { createSignal } from 'solid-js'
import { log } from '../log'
import { CORAL, NIGHT, type Palette, ROLES, type Role, derived, isPalette, luminance } from './colours'

const CSS_VARIABLE: Record<Role, string> = {
    background: '--bg',
    surface: '--surface',
    text: '--ink',
    position: '--position',
    sound: '--sound',
    chosen: '--chosen',
}

const STORAGE_KEY = 'dual-n-back:palette'

const systemDefault = (): Palette => window.matchMedia('(prefers-color-scheme: dark)').matches ? NIGHT : CORAL

// The saved palette, or the preset that suits the system's light or dark setting.
const initialPalette = (): Palette => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved !== null) {
        const parsed: unknown = JSON.parse(saved)
        if (isPalette(parsed)) {
            return parsed
        }
        log.warn('palette', 'saved palette is from an older version or malformed; using a preset', saved)
    }
    return systemDefault()
}

export const [palette, setPalette] = createSignal<Palette>(initialPalette())

export const [tunerOpen, setTunerOpen] = createSignal(false)

// Below this background luminance, native controls (the colour picker) switch to dark.
const DARK_BACKGROUND = 0.2

export const applyPalette = (next: Palette): void => {
    const root = document.documentElement
    const { quiet, onFill } = derived(next)
    ROLES.forEach(({ role }) => root.style.setProperty(CSS_VARIABLE[role], next[role]))
    root.style.setProperty('--secondary', quiet)
    root.style.setProperty('--on-fill', onFill)
    root.style.colorScheme = luminance(next.background) < DARK_BACKGROUND ? 'dark' : 'light'
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

export const choosePreset = (preset: Palette): void => {
    setPalette(preset)
}

export const adjust = (role: Role, colour: string): void => {
    const base = palette()
    setPalette({ ...base, name: base.name.endsWith(' (adjusted)') ? base.name : `${base.name} (adjusted)`, [role]: colour })
}

export const resetPalette = (): void => {
    localStorage.removeItem(STORAGE_KEY)
    setPalette(systemDefault())
}

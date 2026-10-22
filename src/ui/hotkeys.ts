import { setTunerOpen, tunerOpen } from './palette'

// Every button has a key. The hint shown on the button and the key that presses it come
// from the same `data-hotkey` value, so they can't drift apart.

const LABELS: Readonly<Record<string, string>> = {
    Enter: '↵',
    Escape: 'Esc',
    ArrowLeft: '←',
    ArrowRight: '→',
}

export const TUNER_KEY = '`'
// The settings button in the top bar of every screen: G for the gear. A letter, so its
// hint is easy to see, and one far from A and L, since it also works during a round.
export const SETTINGS_KEY = 'g'

export const hotkeyLabel = (key: string): string => LABELS[key] ?? key.toUpperCase()

const keyOf = (event: KeyboardEvent): string => event.key.length === 1 ? event.key.toLowerCase() : event.key

const isTyping = (target: EventTarget | null): boolean =>
    (target instanceof HTMLInputElement && target.type !== 'color') || target instanceof HTMLTextAreaElement

// The tuner, when open, owns the keyboard; otherwise the current screen does.
const scope = (): Element | null => document.querySelector('.tuner') ?? document.querySelector('main[data-screen]')

const matching = (key: string, attribute: string): Element[] =>
    [...(scope()?.querySelectorAll(`[${attribute}="${CSS.escape(key)}"]`) ?? [])]

// Presses the button the key belongs to on the current screen, as the key itself would;
// false when there is none. The browser's Back button presses Escape this way.
export const pressHotkey = (key: string): boolean => {
    // Inert parts (the tour's pictures of the round's buttons) don't take keys.
    const target = [...matching(key, 'data-hotkey'), ...matching(key, 'data-also')]
        .find((element) => element.closest('[inert]') === null)
    if (target instanceof HTMLElement && !(target instanceof HTMLButtonElement && target.disabled)) {
        target.click()
        return true
    }
    return false
}

const onKeyDown = (event: KeyboardEvent): void => {
    // A round in progress has already claimed the key (see engine/capture.ts).
    if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return
    }
    const key = keyOf(event)
    if (key === TUNER_KEY && !isTyping(event.target)) {
        event.preventDefault()
        setTunerOpen(!tunerOpen())
        return
    }
    if (isTyping(event.target) && key !== 'Escape') {
        return
    }
    // A focused button already answers Enter and Space itself.
    if ((key === 'Enter' || key === ' ') && event.target instanceof HTMLButtonElement) {
        return
    }
    if (pressHotkey(key)) {
        event.preventDefault()
    }
}

export const installHotkeys = (): (() => void) => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
}

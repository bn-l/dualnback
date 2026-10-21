import type { FocusEventType, InputType, PressRecord, Sense } from '../data/schema'

export type CapturedPress = Omit<PressRecord, 'id' | 'roundId' | 'sessionId' | 'seq'>

export interface CapturedFocusEvent {
    type: FocusEventType
    at: number
}

const KEY_SENSES: ReadonlyMap<string, Sense> = new Map([['KeyA', 'position'], ['KeyL', 'sound']])
// Holding a modifier isn't an answer, so these never become presses.
const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn']

const HALVES = 2

const isModifier = (code: string): boolean => MODIFIERS.some((name) => code.startsWith(name))

const pointerInput = (pointerType: string): InputType =>
    pointerType === 'touch' ? 'touch' : pointerType === 'pen' ? 'pen' : 'mouse'

const markDown = (element: HTMLElement | undefined, down: boolean): void => {
    if (element !== undefined) {
        element.toggleAttribute('data-down', down)
    }
}

export interface CaptureOptions {
    buttons: Record<Sense, HTMLElement>
    // Keys (KeyboardEvent.key, letters in lower case) that belong to the screen's own
    // buttons, like Escape for pause. They aren't answers, so they pass through unrecorded.
    controlKeys: readonly string[]
}

export interface Capture {
    presses: CapturedPress[]
    focusEvents: CapturedFocusEvent[]
    stop: () => void
}

// Records every key and pointer press with the time the input happened (event.timeStamp),
// not the time the handler ran. Nothing is filtered here: repeats, double presses and
// wrong keys are all kept for the analysis to sort out.
const keyName = (event: KeyboardEvent): string => event.key.length === 1 ? event.key.toLowerCase() : event.key

export const startCapture = ({ buttons, controlKeys }: CaptureOptions): Capture => {
    const presses: CapturedPress[] = []
    const focusEvents: CapturedFocusEvent[] = []
    const openKeys = new Map<string, CapturedPress>()
    const openPointers = new Map<number, CapturedPress>()
    const buttonFor = (sense: Sense | null): HTMLElement | undefined => sense === null ? undefined : buttons[sense]

    const onKeyDown = (event: KeyboardEvent): void => {
        if (controlKeys.includes(keyName(event)) || isModifier(event.code) || event.metaKey || event.ctrlKey) {
            return
        }
        event.preventDefault()
        const sense = KEY_SENSES.get(event.code) ?? null
        const press: CapturedPress = {
            sense,
            input: 'keyboard',
            key: event.code,
            repeat: event.repeat,
            downAt: event.timeStamp,
            upAt: null,
            offsetX: null,
            offsetY: null,
            contactWidth: null,
            contactHeight: null,
            pressure: null,
        }
        presses.push(press)
        if (!event.repeat) {
            openKeys.set(event.code, press)
            markDown(buttonFor(sense), true)
        }
    }

    const onKeyUp = (event: KeyboardEvent): void => {
        const press = openKeys.get(event.code)
        if (press !== undefined) {
            press.upAt = event.timeStamp
            openKeys.delete(event.code)
            markDown(buttonFor(press.sense), false)
        }
    }

    const pointerHandlers = (sense: Sense, element: HTMLElement): { down: (event: PointerEvent) => void; up: (event: PointerEvent) => void } => ({
        down: (event: PointerEvent): void => {
            event.preventDefault()
            element.setPointerCapture(event.pointerId)
            const box = element.getBoundingClientRect()
            const input = pointerInput(event.pointerType)
            const press: CapturedPress = {
                sense,
                input,
                key: null,
                repeat: false,
                downAt: event.timeStamp,
                upAt: null,
                offsetX: event.clientX - (box.left + box.width / HALVES),
                offsetY: event.clientY - (box.top + box.height / HALVES),
                contactWidth: input === 'touch' ? event.width : null,
                contactHeight: input === 'touch' ? event.height : null,
                pressure: input === 'mouse' ? null : event.pressure,
            }
            presses.push(press)
            openPointers.set(event.pointerId, press)
            markDown(element, true)
        },
        up: (event: PointerEvent): void => {
            const press = openPointers.get(event.pointerId)
            if (press !== undefined) {
                press.upAt = event.timeStamp
                openPointers.delete(event.pointerId)
            }
            markDown(element, false)
        },
    })

    const onVisibility = (event: Event): void => {
        focusEvents.push({ type: document.visibilityState === 'hidden' ? 'hidden' : 'visible', at: event.timeStamp })
    }
    const onBlur = (event: FocusEvent): void => {
        focusEvents.push({ type: 'blur', at: event.timeStamp })
    }
    const onFocus = (event: FocusEvent): void => {
        focusEvents.push({ type: 'focus', at: event.timeStamp })
    }

    const handlers = (['position', 'sound'] satisfies Sense[]).map((sense) => ({
        element: buttons[sense],
        ...pointerHandlers(sense, buttons[sense]),
    }))

    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp, { capture: true })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    handlers.forEach(({ element, down, up }) => {
        element.addEventListener('pointerdown', down)
        element.addEventListener('pointerup', up)
        element.addEventListener('pointercancel', up)
    })

    return {
        presses,
        focusEvents,
        stop: (): void => {
            window.removeEventListener('keydown', onKeyDown, { capture: true })
            window.removeEventListener('keyup', onKeyUp, { capture: true })
            document.removeEventListener('visibilitychange', onVisibility)
            window.removeEventListener('blur', onBlur)
            window.removeEventListener('focus', onFocus)
            handlers.forEach(({ element, down, up }) => {
                element.removeEventListener('pointerdown', down)
                element.removeEventListener('pointerup', up)
                element.removeEventListener('pointercancel', up)
                markDown(element, false)
            })
        },
    }
}

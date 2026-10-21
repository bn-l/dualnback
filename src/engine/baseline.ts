import { EARLY_PRESS_MS } from '../domain/scoring'
import { log } from '../log'

// A 30-second simple reaction test: a square appears after a random wait, and you press as
// soon as you see it.
export const BASELINE_MS = 30000
const MIN_WAIT_MS = 1000
const MAX_WAIT_MS = 3000
// No press within this long after the square appears counts as a miss.
const MISS_MS = 1000
const FRAME_ESTIMATE_MS = 16
// Left to the screen, whose Skip button it presses.
const SKIP_KEY = 'Escape'

export interface BaselineCapture {
    reactionTimes: number[]
    misses: number
    anticipations: number
}

export interface RunningBaseline {
    done: Promise<BaselineCapture>
    quit: () => void
}

interface BaselineState {
    onset: number | null
    nextShowAt: number
    frameId: number
    finished: boolean
}

const randomWait = (): number => MIN_WAIT_MS + Math.random() * (MAX_WAIT_MS - MIN_WAIT_MS)

export const runBaseline = (square: HTMLElement, target: HTMLElement): RunningBaseline => {
    const result: BaselineCapture = { reactionTimes: [], misses: 0, anticipations: 0 }
    const endAt = performance.now() + BASELINE_MS
    const state: BaselineState = { onset: null, nextShowAt: performance.now() + randomWait(), frameId: 0, finished: false }
    const { promise, resolve } = Promise.withResolvers<BaselineCapture>()

    const hide = (at: number): void => {
        square.removeAttribute('data-lit')
        state.onset = null
        state.nextShowAt = at + randomWait()
    }

    const respond = (at: number): void => {
        if (state.onset === null) {
            result.anticipations += 1
            return
        }
        const rt = at - state.onset
        if (rt < EARLY_PRESS_MS) {
            result.anticipations += 1
        } else {
            result.reactionTimes.push(rt)
        }
        hide(at)
    }

    const onKey = (event: KeyboardEvent): void => {
        if (!event.repeat && !event.metaKey && !event.ctrlKey && event.key !== SKIP_KEY) {
            event.preventDefault()
            respond(event.timeStamp)
        }
    }
    const onPointer = (event: PointerEvent): void => {
        event.preventDefault()
        respond(event.timeStamp)
    }

    const finish = (): void => {
        if (state.finished) {
            return
        }
        state.finished = true
        cancelAnimationFrame(state.frameId)
        window.removeEventListener('keydown', onKey, { capture: true })
        target.removeEventListener('pointerdown', onPointer)
        square.removeAttribute('data-lit')
        log.info('baseline', 'finished', result)
        resolve(result)
    }

    const frame = (now: number): void => {
        if (state.onset === null && now >= endAt) {
            finish()
            return
        }
        if (state.onset === null && now + FRAME_ESTIMATE_MS >= state.nextShowAt) {
            square.setAttribute('data-lit', '')
            state.onset = now
        } else if (state.onset !== null && now - state.onset > MISS_MS) {
            result.misses += 1
            hide(now)
        }
        state.frameId = requestAnimationFrame(frame)
    }

    window.addEventListener('keydown', onKey, { capture: true })
    target.addEventListener('pointerdown', onPointer)
    state.frameId = requestAnimationFrame(frame)
    return { done: promise, quit: finish }
}

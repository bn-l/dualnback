import { createEffect, createRoot } from 'solid-js'
import { go, problem, screen } from '../app/state'
import { log } from '../log'
import { pressHotkey } from './hotkeys'
import { tunerOpen } from './palette'

// The browser's Back button does what Escape does: it pauses a round, closes the colour
// tuner or a problem, and steps back a screen. Only on the home screen does it leave the
// site.
//
// The app is one page with no URLs of its own, so away from home it keeps one extra history
// entry, marked as ours. Back takes the browser off it; the app answers as Escape would and,
// if still away from home, adds it again. Arriving home takes it away, so that the next Back
// leaves. A reload keeps the entry, so the mark is read back on load.
const MARK = 'dualnback:away'

const away = (): boolean => screen().name !== 'home' || problem() !== null || tunerOpen()

export const installBackButton = (): (() => void) => createRoot((dispose) => {
    let armed = history.state === MARK
    // Waiting for the browser to step off our entry, which it does after history.back()
    // returns.
    let dropping = false

    const arm = (): void => {
        if (!armed && !dropping) {
            history.pushState(MARK, '')
            armed = true
        }
    }

    const drop = (): void => {
        if (armed && !dropping) {
            dropping = true
            history.back()
        }
    }

    const settle = (): void => {
        if (away()) {
            arm()
        } else {
            drop()
        }
    }

    const onPopState = (): void => {
        armed = history.state === MARK
        if (dropping) {
            dropping = false
            settle()
            return
        }
        if (armed) {
            // Forward, back onto our entry: there is nothing ahead to go to.
            settle()
            return
        }
        if (away()) {
            const current = screen().name
            if (!pressHotkey('Escape')) {
                log.warn('history', 'Back found nothing for Escape to press, so it goes home', { screen: current })
                go({ name: 'home' })
            }
            log.info('history', 'Back pressed Escape', { from: current, to: screen().name })
        }
        settle()
    }

    window.addEventListener('popstate', onPopState)
    createEffect(settle)
    log.info('history', 'Back button handled', { armed, screen: screen().name })
    return () => {
        window.removeEventListener('popstate', onPopState)
        dispose()
    }
})

import '@fontsource/figtree/latin-400.css'
import '@fontsource/figtree/latin-700.css'
import '@fontsource/atkinson-hyperlegible-mono/latin-500.css'
import './styles.css'
import { createRenderEffect, createRoot } from 'solid-js'
import { render } from 'solid-js/web'
import { loadApp, trackScreenViews } from './app/controller'
import { setProblem } from './app/state'
import { log } from './log'
import { App } from './ui/App'
import { installBackButton } from './ui/history'
import { installHotkeys } from './ui/hotkeys'
import { applyPalette, palette } from './ui/palette'

const root = document.querySelector<HTMLDivElement>('#root')
if (root === null) {
    throw new Error('index.html is missing #root')
}

window.addEventListener('unhandledrejection', (event) => {
    log.error('app', 'unhandled rejection', event.reason)
})

if (!window.crossOriginIsolated) {
    log.warn('timing', 'not cross-origin isolated, so timer resolution is coarser')
}

// Applied before the first screen renders, and again whenever the tuner changes it.
createRoot(() => createRenderEffect(() => applyPalette(palette())))
installHotkeys()
trackScreenViews()
render(App, root)
// Back is handled once loading has settled on the first screen, which is a session's
// results when one was cut off by a reload.
loadApp()
    .catch((error: unknown) => {
        log.error('app', 'failed to load', error)
        setProblem(`Your data could not be loaded: ${error instanceof Error ? error.message : String(error)}`)
    })
    .finally(installBackButton)

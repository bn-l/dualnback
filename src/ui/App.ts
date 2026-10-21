import { untrack } from 'solid-js'
import html from 'solid-js/html'
import { type Screen as Route, problem, screen, setProblem } from '../app/state'
import { Actions, Button, Screen, type View } from './parts'
import { HomeScreen, MoreScreen } from './screens/home'
import { HistoryScreen, InsightsScreen, WeeklyScreen } from './screens/insights'
import { ConfirmDeleteScreen, ExperimentsScreen, NewExperimentScreen, SettingsScreen } from './screens/manage'
import { BaselineScreen, DetailScreen, PlayScreen, ReadyScreen, ResultsScreen, SessionEndScreen } from './screens/session'
import { StatScreen, StatsScreen } from './screens/stats'
import { HowToPlayScreen } from './screens/tutorial'
import { Tuner } from './tuner'

const ProblemScreen = (message: string): View => Screen({
    label: 'problem',
    layout: 'centre',
    header: html`<p class="heading">Something went wrong</p>`,
    body: html`<p>${message}</p>`,
    footer: Actions(Button({ label: 'Dismiss', hotkey: 'Enter', primary: true, onClick: () => setProblem(null) })),
})

const screenFor = (current: Route): View => {
    switch (current.name) {
        case 'home': return HomeScreen()
        case 'baseline': return BaselineScreen()
        case 'ready': return ReadyScreen()
        case 'play': return PlayScreen()
        case 'results': return ResultsScreen()
        case 'detail': return DetailScreen()
        case 'session-end': return SessionEndScreen()
        case 'stats': return StatsScreen(current.group, current.page)
        case 'stat': return StatScreen(current)
        case 'insights': return InsightsScreen(current.index)
        case 'history': return HistoryScreen(current.page)
        case 'more': return MoreScreen()
        case 'experiments': return ExperimentsScreen()
        case 'new-experiment': return NewExperimentScreen(current)
        case 'weekly': return WeeklyScreen()
        case 'how-to-play': return HowToPlayScreen(current.back)
        case 'settings': return SettingsScreen(current.back)
        case 'confirm-delete': return ConfirmDeleteScreen(current.back)
    }
}

// Each screen is built once when it's shown, untracked, so only the parts of it that read
// signals inside functions update in place; going to a screen builds it afresh.
export const App = (): View => html`
    ${() => {
        const message = problem()
        const current = screen()
        return untrack(() => message === null ? screenFor(current) : ProblemScreen(message))
    }}
    ${Tuner()}`

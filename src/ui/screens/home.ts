import html from 'solid-js/html'
import { beginSession, nextStep, openHowToPlay } from '../../app/controller'
import { dataset, findingRecords, go, settings } from '../../app/state'
import { wholeNumber } from '../../domain/format'
import { INITIAL_RATING } from '../../domain/rating'
import { Actions, Button, Screen, type View } from '../parts'

const headline = (): string => {
    const newest = [...findingRecords()]
        .filter(({ status }) => status !== 'faded')
        .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (newest !== undefined) {
        return newest.sentence
    }
    return (dataset()?.scored.length ?? 0) === 0
        ? `Everyone starts at ${wholeNumber(INITIAL_RATING.rating)}. It moves after every round you play.`
        : 'Your rating moves after every round.'
}

// Someone who hasn't played yet; How to play is offered to them on this screen (and to
// everyone under More).
const newcomer = (): boolean => dataset()?.rounds.length === 0

const HOW_TO_PLAY_KEY = 'p'

// The rating and the way into a session sit in the middle; the rest of the app is a row
// of quiet buttons along the bottom.
export const HomeScreen = (): View => Screen({
    label: 'home',
    layout: 'centre',
    header: html`
        <p class="text-quiet">Your rating</p>
        <p class="number">${() => wholeNumber(settings().rating.rating)}</p>`,
    body: html`
        <p>${headline}</p>
        <p class="text-quiet">Next round: ${() => nextStep().step.n}-back.</p>`,
    footer: Actions(
        Button({ label: 'Start session', hotkey: 'Enter', primary: true, onClick: () => void beginSession() }),
        () => newcomer() ? Button({ label: 'How to play', hotkey: HOW_TO_PLAY_KEY, accent: true, onClick: () => void openHowToPlay({ name: 'home' }) }) : null,
    ),
    bottom: html`<div class="grid grid-cols-2 gap-2 wide:grid-cols-4">
        ${Button({ label: 'Insights', hotkey: 'i', quiet: true, onClick: () => go({ name: 'insights', index: 0 }) })}
        ${Button({ label: 'Stats', hotkey: 's', quiet: true, onClick: () => go({ name: 'stats', group: 0, page: 0 }) })}
        ${Button({ label: 'History', hotkey: 'h', quiet: true, onClick: () => go({ name: 'history', page: 0 }) })}
        ${Button({ label: 'More', hotkey: 'm', quiet: true, onClick: () => go({ name: 'more' }) })}
    </div>`,
})

export const MoreScreen = (): View => Screen({
    label: 'more',
    layout: 'centre',
    header: html`<p class="heading">More</p>`,
    footer: Actions(
        Button({ label: 'Weekly report', hotkey: 'w', onClick: () => go({ name: 'weekly' }) }),
        Button({ label: 'Experiments', hotkey: 'e', onClick: () => go({ name: 'experiments' }) }),
        Button({ label: 'How to play', hotkey: HOW_TO_PLAY_KEY, onClick: () => void openHowToPlay({ name: 'more' }) }),
        Button({ label: 'Home', hotkey: 'Escape', onClick: () => go({ name: 'home' }) }),
    ),
})

import { createSignal, onCleanup, onMount } from 'solid-js'
import html from 'solid-js/html'
import { median } from 'simple-statistics'
import {
    ROUNDS_PER_SESSION,
    endSession,
    finishBaseline,
    nextStep,
    saveNote,
    sessionStart,
    setSound,
    startFirstRound,
    startRound,
    todaysAssignment,
} from '../../app/controller'
import { dataset, go, session, settings } from '../../app/state'
import type { Sense } from '../../data/schema'
import { milliseconds, plural, signed, wholeNumber } from '../../domain/format'
import { SQUARE_COUNT } from '../../domain/letters'
import { type RoundDetail, roundDetail, roundSummary } from '../../domain/round-summary'
import { type ScoredTrial, responseFor } from '../../domain/scoring'
import { trialCountFor } from '../../domain/sequence'
import { MS_PER_SECOND } from '../../engine/audio'
import { BASELINE_MS, type BaselineCapture, runBaseline } from '../../engine/baseline'
import type { RunningRound } from '../../engine/round-runner'
import { log } from '../../log'
import { Strip } from '../charts'
import { Board, RoundControls, SOUND_KEY } from '../board'
import { SETTINGS_KEY } from '../hotkeys'
import { Actions, BigValue, Button, Kbd, Screen, TopBar, type View, focusOnMount, live } from '../parts'

// ---------- reaction test ----------

export const BaselineScreen = (): View => {
    const [phase, setPhase] = createSignal<'intro' | 'running' | 'done'>('intro')
    const [result, setResult] = createSignal<BaselineCapture | null>(null)
    let square: HTMLElement | null = null
    let target: HTMLElement | null = null
    let quit: (() => void) | null = null
    let skipped = false
    onCleanup(() => quit?.())

    const start = (): void => {
        if (square === null || target === null) {
            log.error('baseline', 'test elements missing')
            return
        }
        const running = runBaseline(square, target)
        quit = running.quit
        setPhase('running')
        void running.done.then((capture) => {
            if (!skipped) {
                setResult(capture)
                setPhase('done')
            }
        })
    }

    // Skip works halfway through too: the test leaves Escape to the Skip button.
    const skip = (): void => {
        skipped = true
        quit?.()
        void finishBaseline(null)
    }

    const outcome = (): View => {
        const capture = result()
        if (phase() !== 'done' || capture === null) {
            return null
        }
        const middle = capture.reactionTimes.length === 0 ? null : median(capture.reactionTimes)
        return html`
            ${BigValue(middle === null ? 'No responses' : milliseconds(middle))}
            <p>Median reaction time. ${plural(capture.misses, 'miss', 'misses')}, ${plural(capture.anticipations, 'press', 'presses')} too early.</p>`
    }

    return Screen({
        label: 'reaction test',
        layout: 'centre',
        header: html`<p class="heading">${() => phase() === 'done' ? 'Reaction test done' : 'Reaction test'}</p>`,
        body: html`
            ${() => phase() === 'intro' ? html`<p>
                Once a day, before your first session: press any key or tap as soon as the square turns dark.
                It takes ${BASELINE_MS / MS_PER_SECOND} seconds and measures alertness separately from memory.
            </p>` : null}
            ${outcome}
            <div
                ref=${(element: HTMLElement) => { target = element }}
                class="grid min-h-60 place-items-center rounded-lg"
                prop:hidden=${() => phase() !== 'running'}
            >
                <div ref=${(element: HTMLElement) => { square = element }} class="size-24 rounded-lg bg-surface data-lit:bg-ink"></div>
            </div>`,
        footer: live(() => {
            switch (phase()) {
                case 'intro':
                    return Actions(
                        Button({ label: 'Start test', hotkey: 'Enter', primary: true, onClick: start }),
                        Button({ label: 'Skip', hotkey: 'Escape', onClick: skip }),
                    )
                case 'running':
                    return Actions(Button({ label: 'Skip', hotkey: 'Escape', onClick: skip }))
                case 'done':
                    return Actions(Button({ label: 'Continue', hotkey: 'Enter', primary: true, onClick: () => void finishBaseline(result()) }))
            }
        }),
    })
}

// ---------- ready ----------

// Before the first round. The session only starts with that round, so Exit leaves nothing
// behind.
export const ReadyScreen = (): View => {
    const active = session()
    const forecast = active?.record.forecast ?? sessionStart().forecast
    const assignment = active?.record.experiment ?? todaysAssignment()
    const experiment = (dataset()?.experiments ?? []).find(({ id }) => id === assignment?.experimentId)
    const condition = experiment === undefined ? null
        : assignment?.condition === 'a' ? experiment.conditionA : experiment.conditionB
    const { step, stretch } = nextStep()
    return Screen({
        label: 'ready',
        layout: 'centre',
        header: html`
            <p class="text-quiet">Round ${Math.min((active?.rounds.length ?? 0) + 1, ROUNDS_PER_SESSION)} of ${ROUNDS_PER_SESSION}</p>
            <p class="heading">${step.n}-back${stretch ? ', one step harder' : ''}</p>`,
        body: [
            html`<p class="coarse:hidden">
                Press ${Kbd('a')} when the square is where it was ${step.n} back, and ${Kbd('l')} when the letter is the one you
                heard ${step.n} back.
            </p>`,
            html`<p class="hidden coarse:block">
                Tap Position when the square is where it was ${step.n} back, and Sound when the letter is the one you
                heard ${step.n} back.
            </p>`,
            forecast === null ? null : html`<p class="text-quiet">
                Today's forecast: ${wholeNumber(forecast.rating)}.${forecast.reason === null ? '' : ` ${forecast.reason}`}
            </p>`,
            condition === null ? null : html`<p class="text-quiet">Experiment today: ${condition}.</p>`,
            settings().soundOn ? null : html`<p>
                The sound is off, so this round won't be rated. Turn it on with the speaker at the top of the round<span class="coarse:hidden"> or ${Kbd(SOUND_KEY)}</span>.
            </p>`,
        ],
        footer: Actions(
            Button({ label: 'Start round', hotkey: 'Enter', primary: true, onClick: () => void startFirstRound() }),
            Button({ label: 'Exit', hotkey: 'Escape', onClick: () => go({ name: 'home' }) }),
        ),
    })
}

// ---------- play ----------

export const PlayScreen = (): View => {
    const cells: HTMLElement[] = []
    const answers: Partial<Record<Sense, HTMLElement>> = {}
    let running: RunningRound | null = null
    const [trial, setTrial] = createSignal(0)
    const { step, stretch } = nextStep()

    onMount(() => {
        const { position, sound } = answers
        if (position === undefined || sound === undefined || cells.length !== SQUARE_COUNT) {
            log.error('play', 'play elements missing')
            return
        }
        running = startRound({
            cells,
            buttons: { position, sound },
            // The keyboard belongs to the round, except for the buttons in the top bar.
            controlKeys: ['Escape', SOUND_KEY, SETTINGS_KEY],
            onTrial: (index) => setTrial(index + 1),
        })
        onCleanup(() => running?.quit())
    })

    const flipSound = (): void => {
        const on = !settings().soundOn
        running?.soundChanged(on)
        void setSound(on)
    }

    return html`<main class="frame grid grid-rows-[auto_minmax(0,1fr)]" aria-label="play" data-screen="play">
        ${TopBar(RoundControls({ onSound: flipSound, onPause: () => running?.quit() }))}
        ${Board({
            n: step.n,
            stretch,
            count: trialCountFor(step.n),
            trial,
            onCell: (element) => cells.push(element),
            onAnswer: (sense, element) => { answers[sense] = element },
        })}
    </main>`
}

// ---------- results ----------

export const ResultsScreen = (): View => {
    const active = session()
    const round = active?.rounds.at(-1)
    const scored = active?.lastScored ?? null
    const finished = (active?.rounds.length ?? 0) >= ROUNDS_PER_SESSION
    const footer = Actions(
        finished
            ? Button({ label: 'Finish session', hotkey: 'Enter', primary: true, onClick: () => void endSession() })
            : Button({ label: 'Next round', hotkey: 'Enter', primary: true, onClick: () => go({ name: 'play' }) }),
        scored === null ? null : Button({ label: 'Details', hotkey: 'd', onClick: () => go({ name: 'detail' }) }),
        finished ? null : Button({ label: 'End session', hotkey: 'Escape', onClick: () => void endSession() }),
    )
    if (round?.completed === true && round.result === null) {
        return Screen({
            label: 'results',
            layout: 'centre',
            header: html`<p class="heading">Sound was off</p>`,
            body: html`<p>
                Your rating is unchanged: without the letters, the Sound half of the round can't be played. The round is
                still saved. Turn the sound back on with the speaker button at the top of the round.
            </p>`,
            footer,
        })
    }
    if (round === undefined || !round.completed || scored === null || round.ratingAfter === null) {
        return Screen({
            label: 'results',
            layout: 'centre',
            header: html`<p class="heading">Round paused</p>`,
            body: html`<p>
                Your rating is unchanged. The next round starts fresh, since the last few squares and letters fade during a break.
                The paused round is still saved, so the stats see when you stopped.
            </p>`,
            footer,
        })
    }
    const summary = roundSummary(scored)
    const change = round.ratingAfter.rating - round.ratingBefore.rating
    return Screen({
        label: 'results',
        layout: 'centre',
        header: html`
            <p class="text-quiet">Rating</p>
            <p class="number">${wholeNumber(round.ratingAfter.rating)}</p>
            <p class="heading">${signed(change)} this ${round.stretch ? 'stretch round' : 'round'}</p>`,
        body: [html`<p>${summary.sentence}</p>`, html`<div class="flex justify-center">${Strip(summary.segments)}</div>`],
        footer,
    })
}

// ---------- round detail ----------

const TIMES = ['never', 'once', 'twice']

const timesText = (count: number): string => TIMES[count] ?? `${count} times`

const lureLine = (detail: RoundDetail): string => {
    const caught = detail.lureErrors.filter(({ count }) => count > 0)
    return caught.length === 0
        ? 'No lures caught you.'
        : `Lures that caught you: ${caught.map(({ label, count }) => `${label} ${timesText(count)}`).join(', ')}.`
}

const speedLine = (detail: RoundDetail): string =>
    detail.medianRt === null
        ? 'Too few presses to time.'
        : `Median reaction time ${milliseconds(detail.medianRt)}${detail.slowTail === null ? '' : `, slow tail ${milliseconds(detail.slowTail)}`}.`

const CLUSTERING: Record<RoundDetail['clustering'], string> = {
    'clustered': 'Your errors came in clusters, which points to lapses of focus.',
    'spread': 'Your errors were spread out, which points to memory load rather than lapses.',
    'too-few': 'Too few errors to tell whether they clustered.',
}

const HIT_COLOUR: Record<Sense, string> = { position: 'bg-position', sound: 'bg-sound-mark' }

const cellColour = (trial: ScoredTrial, sense: Sense): string => {
    const { outcome } = responseFor(trial, sense)
    return outcome === 'hit' ? HIT_COLOUR[sense] : outcome === 'miss' || outcome === 'false-alarm' ? 'bg-ink' : 'bg-surface'
}

export const DetailScreen = (): View => {
    const scored = session()?.lastScored ?? null
    const back = Actions(Button({ label: 'Back', hotkey: 'Escape', primary: true, onClick: () => go({ name: 'results' }) }))
    if (scored === null) {
        return Screen({ label: 'detail', header: html`<p class="heading">No round to show</p>`, footer: back })
    }
    const detail = roundDetail(scored)
    return Screen({
        label: 'detail',
        header: html`<p class="heading">Round detail</p>`,
        body: html`
            <p>${lureLine(detail)}</p>
            <p>${speedLine(detail)}</p>
            <p>${CLUSTERING[detail.clustering]}</p>
            <div class="grid grid-cols-[max-content_1fr] items-center gap-x-4 gap-y-2" role="img" aria-label="Every trial in order">
                ${(['position', 'sound'] satisfies Sense[]).map((sense) => html`
                    <span>${sense === 'position' ? 'Position' : 'Sound'}</span>
                    <div class="grid grid-flow-col auto-cols-[minmax(0,1fr)] gap-0.75">
                        ${detail.trials.map((trial) => html`<div class=${`h-7 rounded-sm ${cellColour(trial, sense)}`}></div>`)}
                    </div>`)}
            </div>
            <p class="text-quiet">Coloured marks are hits. Dark marks are misses and false alarms.</p>`,
        footer: back,
    })
}

// ---------- session end ----------

export const SessionEndScreen = (): View => {
    const active = session()
    const [note, setNote] = createSignal('')
    const rating = settings().rating.rating
    const forecast = active?.record.forecast ?? null
    const played = (active?.rounds ?? []).filter(({ completed }) => completed).length
    const done = (): void => {
        void saveNote(note())
    }
    return Screen({
        label: 'session end',
        layout: 'centre',
        header: html`
            <p class="heading">Session done</p>
            <p class="number">${wholeNumber(rating)}</p>`,
        body: html`
            <p>${forecast === null
                ? `You played ${plural(played, 'round')}.`
                : `Forecast ${wholeNumber(forecast.rating)}. You finished at ${wholeNumber(rating)}.`}</p>
            <textarea
                class="min-h-14 min-w-0 resize-none rounded-lg bg-surface px-5 py-3.5 placeholder:text-quiet"
                aria-label="Note"
                placeholder="Add a note (optional). Enter saves, Shift+Enter starts a new line."
                ref=${focusOnMount}
                onInput=${(event: Event) => {
                    if (event.currentTarget instanceof HTMLTextAreaElement) {
                        setNote(event.currentTarget.value)
                    }
                }}
                onKeyDown=${(event: KeyboardEvent) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        done()
                    }
                }}
            ></textarea>`,
        footer: Actions(Button({ label: 'Done', hotkey: 'Enter', primary: true, onClick: done })),
    })
}

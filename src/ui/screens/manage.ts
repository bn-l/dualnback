import { differenceInCalendarDays, parseISO } from 'date-fns'
import { createSignal } from 'solid-js'
import html from 'solid-js/html'
import { activeExperiment, createExperiment, deleteEverything, stopExperiment, updateSettings } from '../../app/controller'
import { exportCsv, exportJson, importJson } from '../../app/backup'
import { type Screen as Route, dataset, go, setProblem, settings } from '../../app/state'
import { conditionFor, experimentResult } from '../../domain/experiments'
import { dayKey, plural } from '../../domain/format'
import { log } from '../../log'
import { TUNER_KEY } from '../hotkeys'
import { setTunerOpen } from '../palette'
import { Actions, Button, Screen, type View, digit, focusOnMount, live } from '../parts'

// ---------- experiments ----------

export const ExperimentsScreen = (): View => {
    const data = dataset()
    const active = activeExperiment()
    const latest = (data?.experiments ?? []).filter(({ id }) => id !== active?.id).at(-1)
    const back = Button({ label: 'Back', hotkey: 'Escape', onClick: () => go({ name: 'more' }) })
    if (active !== null && data !== null) {
        const today = dayKey(Date.now())
        const condition = conditionFor(active, today) === 'a' ? active.conditionA : active.conditionB
        const day = differenceInCalendarDays(parseISO(today), parseISO(active.startDay)) + 1
        return Screen({
            label: 'experiment',
            header: html`<p class="heading">${active.question}</p>`,
            body: html`
                <p>Today: ${condition}.</p>
                <p class="text-quiet">Day ${day} of ${active.days}.</p>
                <p>${experimentResult(active, data).sentence}</p>`,
            footer: Actions(back, Button({
                label: 'Stop experiment',
                hotkey: 'x',
                onClick: () => void stopExperiment(active).then(() => go({ name: 'experiments' })),
            })),
        })
    }
    return Screen({
        label: 'experiments',
        header: html`<p class="heading">Experiments</p>`,
        body: [
            html`<p>
                Test one change to how you play, like saying the letters out loud. Each day gets one of two conditions at
                random, and the results are compared against what your rating expected.
            </p>`,
            latest === undefined || data === null ? null : html`
                <p class="font-bold">${latest.question}</p>
                <p>${experimentResult(latest, data).sentence}</p>`,
        ],
        footer: Actions(
            Button({ label: 'New experiment', hotkey: 'n', primary: true, onClick: () => go({ name: 'new-experiment', question: '', conditionA: '', conditionB: '' }) }),
            back,
        ),
    })
}

const LENGTHS = [{ days: 7 }, { days: 14 }, { days: 21 }]
const DEFAULT_LENGTH = 14

const FIELD = 'min-h-14 min-w-0 rounded-lg bg-surface px-5 py-3.5 placeholder:text-quiet'

export const NewExperimentScreen = (initial: { question: string; conditionA: string; conditionB: string }): View => {
    const [step, setStep] = createSignal(0)
    const [question, setQuestion] = createSignal(initial.question)
    const [conditionA, setConditionA] = createSignal(initial.conditionA)
    const [conditionB, setConditionB] = createSignal(initial.conditionB)
    const [days, setDays] = createSignal(DEFAULT_LENGTH)
    const ready = (): boolean => question().trim() !== '' && conditionA().trim() !== '' && conditionB().trim() !== ''
    const next = (): void => {
        if (ready()) {
            setStep(1)
        }
    }
    const create = async (): Promise<void> => {
        await createExperiment({ question: question().trim(), conditionA: conditionA().trim(), conditionB: conditionB().trim(), days: days() })
        go({ name: 'experiments' })
    }
    const field = ({ label, placeholder, value, set, first = false }: { label: string; placeholder: string; value: () => string; set: (text: string) => void; first?: boolean }): View =>
        html`<label class="flex flex-col gap-1 short:grid short:grid-cols-[11rem_minmax(0,1fr)] short:items-center short:gap-4">
            <span class="text-quiet">${label}</span>
            <input
                class=${FIELD}
                placeholder=${placeholder}
                value=${value}
                ref=${(element: HTMLElement) => first ? focusOnMount(element) : undefined}
                onInput=${(event: Event) => {
                    if (event.currentTarget instanceof HTMLInputElement) {
                        set(event.currentTarget.value)
                    }
                }}
            />
        </label>`
    const questions = (): View => Screen({
        label: 'new experiment',
        header: html`<p class="heading">New experiment</p>`,
        body: html`<form class="flex flex-col gap-4" onSubmit=${(event: Event) => { event.preventDefault(); next() }}>
            ${field({ label: 'Question', placeholder: 'Does saying the letters help?', value: question, set: setQuestion, first: true })}
            ${field({ label: 'First condition', placeholder: 'Say them out loud', value: conditionA, set: setConditionA })}
            ${field({ label: 'Second condition', placeholder: 'Stay silent', value: conditionB, set: setConditionB })}
            <button type="submit" hidden>Next</button>
        </form>`,
        footer: Actions(
            Button({ label: 'Next', hotkey: 'Enter', primary: true, disabled: () => !ready(), onClick: next }),
            Button({ label: 'Cancel', hotkey: 'Escape', onClick: () => go({ name: 'experiments' }) }),
        ),
    })
    const length = (): View => Screen({
        label: 'experiment length',
        header: html`<p class="heading">How many days?</p>`,
        body: html`
            <div class="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-3 *:min-w-0">
                ${LENGTHS.map((option, index) => Button({ label: `${option.days} days`, hotkey: digit(index), chosen: () => option.days === days(), onClick: () => setDays(option.days) }))}
            </div>
            <p class="text-quiet">Each day gets one condition. The app tells you which before every session.</p>`,
        footer: Actions(
            Button({ label: 'Start experiment', hotkey: 'Enter', primary: true, onClick: () => void create() }),
            Button({ label: 'Back', hotkey: 'Escape', onClick: () => setStep(0) }),
        ),
    })
    return live(() => step() === 0 ? questions() : length())
}

// ---------- settings ----------

const onOff = (value: boolean): string => value ? 'on' : 'off'

const failed = (what: string) => (error: unknown): void => {
    setProblem(`${what}: ${error instanceof Error ? error.message : String(error)}`)
}

// Opened from the top bar of any screen; Back returns there.
export const SettingsScreen = (back: Route): View => {
    const [notice, setNotice] = createSignal('')
    let picker: HTMLInputElement | null = null
    const importFile = (event: Event): void => {
        const input = event.currentTarget
        const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined
        if (input instanceof HTMLInputElement && file !== undefined) {
            // The same file can be chosen again.
            input.value = ''
            setNotice(`Importing ${file.name}…`)
            importJson(file)
                .then(({ sessions, rounds }) => setNotice(`Imported ${plural(sessions, 'session')} and ${plural(rounds, 'round')} from ${file.name}.`))
                .catch((error: unknown) => {
                    log.warn('import', 'failed', error)
                    setNotice(error instanceof Error ? error.message : String(error))
                })
        }
    }
    return Screen({
        label: 'settings',
        layout: 'centre',
        header: html`<p class="heading">Settings</p>`,
        body: [
            html`<div class="grid gap-3 *:min-w-0 wide:grid-cols-2">
                ${Button({
                    label: () => `Daily reaction test: ${onOff(settings().dailyBaseline)}`,
                    hotkey: 'r',
                    onClick: () => void updateSettings({ dailyBaseline: !settings().dailyBaseline }),
                })}
                ${Button({ label: 'Colours', hotkey: TUNER_KEY, onClick: () => setTunerOpen(true) })}
                ${Button({ label: 'Export as JSON', hotkey: 'j', onClick: () => void exportJson().catch(failed('Export failed')) })}
                ${Button({ label: 'Import from JSON', hotkey: 'i', onClick: () => picker?.click() })}
                ${Button({ label: 'Export as CSV', hotkey: 'c', onClick: () => void exportCsv().catch(failed('Export failed')) })}
                ${Button({ label: 'Delete all data', hotkey: 'd', onClick: () => go({ name: 'confirm-delete', back }) })}
            </div>
            <input
                type="file"
                accept=".json,application/json"
                hidden
                aria-label="Import from JSON"
                ref=${(element: HTMLInputElement) => { picker = element }}
                onChange=${importFile}
            />`,
            html`<p class="text-quiet" aria-live="polite" prop:hidden=${() => notice() === ''}>${notice}</p>`,
        ],
        footer: Actions(Button({ label: 'Back', hotkey: 'Escape', onClick: () => go(back) })),
    })
}

export const ConfirmDeleteScreen = (back: Route): View => Screen({
    label: 'confirm delete',
    layout: 'centre',
    header: html`<p class="heading">Delete all data?</p>`,
    body: html`<p>Every round, note, experiment and finding is removed from this device. This can't be undone.</p>`,
    footer: Actions(
        Button({ label: 'Cancel', hotkey: 'Escape', primary: true, onClick: () => go({ name: 'settings', back }) }),
        Button({ label: 'Delete everything', hotkey: 'd', onClick: () => void deleteEverything().catch(failed('Delete failed')) }),
    ),
})

// Draws docs/hero.svg, the animation at the top of the README: ten trials of a 2-back round
// on the play screen, with an answer pressed on every match. It is the play screen as
// Chromium lays it out at 960 by 720 (the numbers under "the screen" were measured there),
// in the Coral palette, or Night when the reader's system is dark, as the app picks them.
// The app speaks its letters; the drawing writes each one on its square. Run `just hero`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { type IconNode, Settings, Volume2 } from 'lucide'
import type { Sense } from '../src/data/schema'
import { plural } from '../src/domain/format'
import { GRID_SIZE, LETTERS, SQUARE_COUNT } from '../src/domain/letters'
import { trialCountFor } from '../src/domain/sequence'
import { log } from '../src/log'
import { CORAL, NIGHT, type Palette, derived } from '../src/ui/colours'

const OUTPUT = new URL('../docs/hero.svg', import.meta.url)
const FONTS = new URL('../node_modules/@fontsource/', import.meta.url)

// ---------- the round ----------

const N = 2
// The counter's value on the first trial drawn, so the round is under way.
const FIRST_SHOWN = 7

// Ten trials that repeat, so trial 0 follows trial 9 and the matches hold across the loop.
// Squares count across, then down, from the top left.
const TRIALS: ReadonlyArray<{ square: number; letter: string }> = [
    { square: 2, letter: 'k' },
    { square: 7, letter: 't' },
    { square: 2, letter: 'r' },
    { square: 4, letter: 't' },
    { square: 5, letter: 'h' },
    { square: 0, letter: 'q' },
    { square: 5, letter: 's' },
    { square: 1, letter: 'q' },
    { square: 8, letter: 'c' },
    { square: 1, letter: 'q' },
]

const SENSES: readonly Sense[] = ['position', 'sound']

const TRIAL_SECONDS = 1.5
// As long as the app shows a square (STIMULUS_MS in engine/round-runner.ts).
const LIT_SECONDS = 0.5
// When the pretend player presses, from the start of the trial, and for how long. On a
// trial that matches both, sound comes a moment after position.
const PRESS_AT: Record<Sense, number> = { position: 0.55, sound: 0.65 }
const PRESS_SECONDS = 0.35
const LOOP_SECONDS = TRIALS.length * TRIAL_SECONDS

// ---------- the screen ----------

// Boxes are getBoundingClientRect; the y of a text is its baseline.
const SCREEN = { width: 960, height: 720, corner: 24 }
const BRAND = { x: 60, y: 59, size: 26 }
const ICON = { y: 34, size: 32, stroke: 2.25 }
const KEY_HINT = { y: 56.5, size: 20 }
const HEADING_SIZE = 32
const HEADER = { left: 330.73, right: 629.27, y: 149.84 }
const GRID = { left: 339.52, top: 178.16, cell: 87.8, step: 96.57, corner: 13.17 }
const INSTRUCTION = { centre: 480, y: 549.82 }
const ANSWER = { top: 585.16, width: 219.11, height: 56, corner: 17.92, padding: 32, labelY: 624.16, keyY: 623.66 }
const ANSWER_LEFT: Record<Sense, number> = { position: 248.6, sound: 492.29 }
const ANSWER_LABEL: Record<Sense, string> = { position: 'Position', sound: 'Sound' }
const ANSWER_KEY: Record<Sense, string> = { position: 'A', sound: 'L' }
// Figtree's capitals stand this share of the font size above the baseline.
const CAP_HEIGHT = 0.701

// ---------- checks ----------

const problems = TRIALS.flatMap(({ square, letter }, index) => [
    ...(Number.isInteger(square) && square >= 0 && square < SQUARE_COUNT ? [] : [`trial ${index} has no square ${square}`]),
    ...(LETTERS.includes(letter) ? [] : [`trial ${index} has ${letter}, which is not one of the app's letters`]),
])
if (problems.length > 0) {
    log.error('hero', 'the trials are not a round the app could play', problems)
    throw new Error(problems.join('; '))
}

const isMatch = (sense: Sense, index: number): boolean => {
    const trial = TRIALS[index]
    const earlier = TRIALS[(index - N + TRIALS.length) % TRIALS.length]
    if (trial === undefined || earlier === undefined) {
        return false
    }
    return sense === 'position' ? trial.square === earlier.square : trial.letter === earlier.letter
}

// Drawn when nothing moves (prefers-reduced-motion): the first trial that matches both.
const STILL = Math.max(0, TRIALS.findIndex((_, index) => SENSES.every((sense) => isMatch(sense, index))))

// ---------- markup ----------

const HUNDREDTHS = 100
const PERCENT = 100
const PERCENT_DECIMALS = 3

const num = (value: number): string => String(Math.round(value * HUNDREDTHS) / HUNDREDTHS)
const percent = (seconds: number): string => `${Number(((seconds / LOOP_SECONDS) * PERCENT).toFixed(PERCENT_DECIMALS))}%`
const shown = (on: boolean): string => on ? '1' : '0'

type Span = readonly [start: number, end: number]

// Shown during the spans and hidden otherwise, switching at once as the app does: the
// animation runs step-end, so each frame holds until the next.
const keyframes = (name: string, spans: readonly Span[]): string => {
    const onAt = (time: number): boolean => spans.some(([start, end]) => time >= start && time < end)
    const changes = [...new Set(spans.flat())].filter((time) => time > 0 && time < LOOP_SECONDS).sort((a, b) => a - b)
    const last = changes.at(-1) ?? 0
    const frames = [`0% { opacity: ${shown(onAt(0))} }`, ...changes.map((time) => `${percent(time)} { opacity: ${shown(onAt(time))} }`)]
    return `@keyframes ${name} { ${[...frames, `100% { opacity: ${shown(onAt(last))} }`].join(' ')} }`
}

const trialStart = (index: number): number => index * TRIAL_SECONDS

const element = ([tag, attributes]: IconNode[number]): string => {
    const pairs = Object.entries(attributes).filter(([, value]) => value !== undefined)
    return `<${tag} ${pairs.map(([key, value]) => `${key}="${String(value)}"`).join(' ')}/>`
}

const lucide = (icon: IconNode, x: number): string =>
    `<svg class="line" x="${num(x)}" y="${ICON.y}" width="${ICON.size}" height="${ICON.size}" viewBox="0 0 24 24" fill="none" stroke-width="${ICON.stroke}" stroke-linecap="round" stroke-linejoin="round">` +
    `${icon.map(element).join('')}</svg>`

// Two rounded bars, as PauseIcon in ui/board.ts.
const pause = (x: number): string =>
    `<svg class="quiet" x="${num(x)}" y="${ICON.y}" width="24" height="${ICON.size}" viewBox="0 0 24 32">` +
    '<rect x="0" y="0" width="9" height="32" rx="4.5"/><rect x="15" y="0" width="9" height="32" rx="4.5"/></svg>'

const CONTROLS: ReadonlyArray<{ draw: (x: number) => string; x: number; key: string; keyX: number }> = [
    { draw: (x) => lucide(Volume2, x), x: 636.8, key: 'M', keyX: 680.8 },
    { draw: pause, x: 725.44, key: 'Esc', keyX: 761.44 },
    { draw: (x) => lucide(Settings, x), x: 831.36, key: 'G', keyX: 875.36 },
]

const HALVES = 2

const cellX = (square: number): number => GRID.left + (square % GRID_SIZE) * GRID.step
const cellY = (square: number): number => GRID.top + Math.floor(square / GRID_SIZE) * GRID.step
const squareRect = (square: number, extra: string): string =>
    `<rect ${extra} x="${num(cellX(square))}" y="${num(cellY(square))}" width="${GRID.cell}" height="${GRID.cell}" rx="${GRID.corner}"/>`

// A capital in the middle of its square.
const letterText = (index: number, { square, letter }: { square: number; letter: string }): string => {
    const x = cellX(square) + GRID.cell / HALVES
    const y = cellY(square) + GRID.cell / HALVES + (CAP_HEIGHT * HEADING_SIZE) / HALVES
    return `<text class="on-fill step letter-${index}" x="${num(x)}" y="${num(y)}" font-size="${HEADING_SIZE}" text-anchor="middle" opacity="${shown(index === STILL)}">${letter.toUpperCase()}</text>`
}

// An answer at rest (surface, label in ink, key in quiet), or held down (its sense's colour,
// label and key in on-fill).
const answer = (sense: Sense, down: boolean): string => {
    const left = ANSWER_LEFT[sense]
    const [fill, label, hint] = down ? [sense, ' class="on-fill"', 'on-fill'] : ['surface', '', 'quiet']
    return [
        `<rect class="${fill}" x="${left}" y="${ANSWER.top}" width="${ANSWER.width}" height="${ANSWER.height}" rx="${ANSWER.corner}"/>`,
        `<text${label} x="${num(left + ANSWER.padding)}" y="${ANSWER.labelY}" font-size="${HEADING_SIZE}">${ANSWER_LABEL[sense]}</text>`,
        `<text class="key ${hint}" x="${num(left + ANSWER.width - ANSWER.padding)}" y="${ANSWER.keyY}" font-size="${HEADING_SIZE}" text-anchor="end">${ANSWER_KEY[sense]}</text>`,
    ].join('\n    ')
}

const variables = (palette: Palette): string => {
    const { quiet, onFill } = derived(palette)
    return [
        `--bg: ${palette.background};`,
        `--surface: ${palette.surface};`,
        `--ink: ${palette.text};`,
        `--quiet: ${quiet};`,
        `--position: ${palette.position};`,
        `--sound: ${palette.sound};`,
        `--on-fill: ${onFill};`,
    ].join(' ')
}

const font = (family: string, weight: number, file: string): string => {
    const data = readFileSync(new URL(file, FONTS)).toString('base64')
    return `@font-face { font-family: '${family}'; font-weight: ${weight}; src: url(data:font/woff2;base64,${data}) format('woff2'); }`
}

const BOLD = 700
const MEDIUM = 500

// ---------- the animation ----------

const squares = Array.from({ length: SQUARE_COUNT }, (_, square) => square)
const litSquares = squares.filter((square) => TRIALS.some((trial) => trial.square === square))
const litSpans = (square: number): Span[] => TRIALS.flatMap((trial, index) =>
    trial.square === square ? [[trialStart(index), trialStart(index) + LIT_SECONDS] satisfies Span] : [])
const pressSpans = (sense: Sense): Span[] => TRIALS.flatMap((_, index) => {
    const at = trialStart(index) + PRESS_AT[sense]
    return isMatch(sense, index) ? [[at, at + PRESS_SECONDS] satisfies Span] : []
})

const animations = [
    ...litSquares.map((square) => keyframes(`lit-${square}`, litSpans(square))),
    ...TRIALS.map((_, index) => keyframes(`letter-${index}`, [[trialStart(index), trialStart(index) + LIT_SECONDS]])),
    ...TRIALS.map((_, index) => keyframes(`count-${index}`, [[trialStart(index), trialStart(index + 1)]])),
    ...SENSES.map((sense) => keyframes(`press-${sense}`, pressSpans(sense))),
]
const names = [
    ...litSquares.map((square) => `lit-${square}`),
    ...TRIALS.map((_, index) => `letter-${index}`),
    ...TRIALS.map((_, index) => `count-${index}`),
    ...SENSES.map((sense) => `press-${sense}`),
]

// Wide enough for the latest start, 13.5.
const SECONDS_COLUMN = 4

const still = TRIALS[STILL]
const timeline = TRIALS.map(({ square, letter }, index) => {
    const matches = SENSES.filter((sense) => isMatch(sense, index)).map((sense) => ANSWER_LABEL[sense])
    const seconds = trialStart(index).toFixed(1)
    return `       ${seconds.padStart(SECONDS_COLUMN)}s  ${FIRST_SHOWN + index} / ${trialCountFor(N)}: square ${square}, ${letter}${matches.length > 0 ? `, press ${matches.join(' and ')}` : ''}`
})

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SCREEN.width}" height="${SCREEN.height}" viewBox="0 0 ${SCREEN.width} ${SCREEN.height}" role="img" aria-label="The dual n-back play screen in a 2-back round: squares light up on the grid one at a time, each with its letter written on it, and Position or Sound is pressed whenever the square or the letter is the one from two steps back">
  <!-- Made by scripts/readme-hero.ts (just hero). Change that, not this. -->
  <defs>
    <style><![CDATA[
      ${font('Figtree', BOLD, 'figtree/files/figtree-latin-700-normal.woff2')}
      ${font('Atkinson Hyperlegible Mono', MEDIUM, 'atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-500-normal.woff2')}

      /* The palettes are the app's: Coral, and Night on a dark system. */
      svg { ${variables(CORAL)} }
      @media (prefers-color-scheme: dark) {
        svg { ${variables(NIGHT)} }
      }

      .bg { fill: var(--bg) }
      .surface { fill: var(--surface) }
      .position { fill: var(--position) }
      .sound { fill: var(--sound) }
      .line { stroke: var(--quiet) }

      /* Sizes are attributes, in the drawing's own units. */
      text { fill: var(--ink); font-family: Figtree, sans-serif; font-weight: ${BOLD} }
      .quiet { fill: var(--quiet) }
      .on-fill { fill: var(--on-fill) }
      .key { font-family: 'Atkinson Hyperlegible Mono', monospace; font-weight: ${MEDIUM} }

      /* One ${LOOP_SECONDS}s loop of ${TRIALS.length} trials, ${TRIAL_SECONDS}s apart. A square and its letter show for
         ${LIT_SECONDS}s, as long as the app shows them, and an answer is pressed on every match:
${timeline.join('\n')}
         and round again. The trials repeat, so the first is matched against the last two. */
      .step {
        animation-duration: ${LOOP_SECONDS}s;
        animation-timing-function: step-end;
        animation-iteration-count: infinite;
      }
${names.map((name) => `      .${name} { animation-name: ${name} }`).join('\n')}

${animations.map((rule) => `      ${rule}`).join('\n')}

      /* Resting on the trial the inline opacities draw: ${FIRST_SHOWN + STILL} / ${trialCountFor(N)}, a match on both. */
      @media (prefers-reduced-motion: reduce) {
        .step { animation: none !important; }
      }
    ]]></style>
  </defs>

  <rect class="bg" width="${SCREEN.width}" height="${SCREEN.height}" rx="${SCREEN.corner}"/>

  <!-- The top bar: the name, then sound, pause and settings with their keys -->
  <text x="${BRAND.x}" y="${BRAND.y}" font-size="${BRAND.size}">dual n-back</text>
  ${CONTROLS.map(({ draw, x, key, keyX }) => `${draw(x)}\n  <text class="key quiet" x="${keyX}" y="${KEY_HINT.y}" font-size="${KEY_HINT.size}">${key}</text>`).join('\n  ')}

  <!-- The board -->
  <text x="${HEADER.left}" y="${HEADER.y}" font-size="${HEADING_SIZE}">${N}-back</text>
  ${TRIALS.map((_, index) => `<text class="step count-${index}" x="${HEADER.right}" y="${HEADER.y}" font-size="${HEADING_SIZE}" text-anchor="end" opacity="${shown(index === STILL)}">${FIRST_SHOWN + index} / ${trialCountFor(N)}</text>`).join('\n  ')}

  ${squares.map((square) => squareRect(square, 'class="surface"')).join('\n  ')}
  ${litSquares.map((square) => squareRect(square, `class="position step lit-${square}" opacity="${shown(still?.square === square)}"`)).join('\n  ')}
  ${TRIALS.map((trial, index) => letterText(index, trial)).join('\n  ')}

  <text x="${INSTRUCTION.centre}" y="${INSTRUCTION.y}" font-size="${HEADING_SIZE}" text-anchor="middle">Match ${plural(N, 'step')} back</text>

  <!-- The answers, and over each the same answer held down -->
  ${SENSES.map((sense) => `<g>\n    ${answer(sense, false)}\n  </g>\n  <g class="step press-${sense}" opacity="${shown(isMatch(sense, STILL))}">\n    ${answer(sense, true)}\n  </g>`).join('\n  ')}
</svg>
`

mkdirSync(new URL('.', OUTPUT), { recursive: true })
writeFileSync(OUTPUT, svg)
log.info('hero', `wrote ${OUTPUT.pathname}`, { seconds: LOOP_SECONDS, still: STILL })

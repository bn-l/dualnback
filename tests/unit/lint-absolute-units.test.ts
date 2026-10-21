import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vite-plus/test'

// Runs both halves of local/no-absolute-units through the real linters and configs: ESLint
// with eslint.config.ts for CSS, and oxlint through `vp lint` for strings in TS.

type Finding = [line: number, column: number, value: string]

// Where `value` sits in the fixture, 1-based like linter output.
const at = (lines: string[], line: number, value: string): Finding =>
    [line, (lines[line - 1] ?? '').indexOf(value) + 1, value]

const lintCss = async (lines: string[]): Promise<Finding[]> => {
    const [result] = await new ESLint().lintText(lines.join('\n'), { filePath: 'src/fixture.css' })
    const messages = result?.messages ?? []
    // A parse error would hide every finding, so it fails the test instead.
    expect(messages.filter((message) => message.fatal === true)).toEqual([])
    return messages
        .filter((message) => message.ruleId === 'local/no-absolute-units')
        .map((message) => [message.line, message.column, message.message.split('`')[1] ?? ''])
}

const run = promisify(execFile)

// The fixture goes in test-results/, which git ignores, so `vp check` never sees it;
// --no-ignore lets `vp lint` in. Lines look like `file:6:30: message [Error/local(rule)]`.
const lintTs = async (lines: string[]): Promise<Finding[]> => {
    await mkdir('test-results', { recursive: true })
    const file = join(await mkdtemp(join('test-results', 'lint-')), 'fixture.ts')
    await writeFile(file, lines.join('\n'))
    const args = ['vp', 'lint', '--no-ignore', '--format', 'unix', file]
    // `vp lint` exits non-zero when it finds anything, so the report is read either way.
    const report = await run('npx', args).then(
        ({ stdout }) => stdout,
        (error: unknown) => {
            if (error instanceof Error && 'stdout' in error && typeof error.stdout === 'string') {
                return error.stdout
            }
            throw error
        },
    )
    return Array.from(report.matchAll(/:(\d+):(\d+): `([^`]+)`.*\[Error\/local\(no-absolute-units\)\]$/gm))
        .map(([, line, column, value]) => [Number(line), Number(column), value ?? ''])
}

describe('local/no-absolute-units in CSS', () => {
    it('flags absolute units in declarations, custom properties, at-rules and Tailwind blocks', async () => {
        // Arrange
        const css = [
            '@theme { --spacing: 4px; --radius: calc(2PX + 1rem); }',
            '@custom-variant wide { @container app (width >= 720px) { @slot; } }',
            '@media (width >= 40pc) { a { width: 1in; } }',
            '@utility frame { padding: 1cm 2mm -0.5Q; @variant wide { margin: 5pt; } }',
            '.b { grid-template-columns: minmax(96px, 1fr); }',
        ]

        // Act
        const found = await lintCss(css)

        // Assert
        expect(found).toEqual([
            at(css, 1, '4px'),
            at(css, 1, '2PX'),
            at(css, 2, '720px'),
            at(css, 3, '40pc'),
            at(css, 3, '1in'),
            at(css, 4, '1cm'),
            at(css, 4, '2mm'),
            at(css, 4, '-0.5Q'),
            at(css, 4, '5pt'),
            at(css, 5, '96px'),
        ])
    })

    it('leaves relative units, strings, urls and comments alone', async () => {
        // Arrange
        const css = [
            '@theme { --spacing: 0.25rem; --gap: max(0.5rem, var(--cell) * 0.1); --label: "9px"; }',
            '.a { width: 100cqw; height: 50%; font-size: 1.25em; grid-template-columns: 1fr 2fr; }',
            '.b { content: "3px"; background: url(icon-3px.png); /* 7px */ }',
        ]

        // Act
        const found = await lintCss(css)

        // Assert
        expect(found).toEqual([])
    })
})

describe('local/no-absolute-units in TS strings', () => {
    it('flags class strings and template markup, and nothing that only looks like a unit', async () => {
        // Arrange
        const ts = [
            "export const arbitrary = 'w-[280px] gap-[3px]'",
            "export const underscores = 'shadow-[inset_0_0_0_3pt_red]'",
            "export const uppercase = 'grid-cols-[repeat(auto-fill,minmax(96PX,1fr))]'",
            "export const others = 'top-[.5in] left-[-1.5cm] mt-[2mm] p-[1pc] m-[4Q]'",
            'export const markup = (gap: string): string => `<div style="margin: 7px ${gap}" class="h-[12px]">`',
            "export const relative = 'w-[17.5rem] gap-[0.1875rem] h-[100cqh] w-[50%] text-[1.25em] w-[10ch]'",
            "export const words = 'Presses land 4 px further. login 1st mp3 h264 3pin a1px v2.0px'",
        ]

        // Act
        const found = await lintTs(ts)

        // Assert
        expect(found).toEqual([
            at(ts, 1, '280px'),
            at(ts, 1, '3px'),
            at(ts, 2, '3pt'),
            at(ts, 3, '96PX'),
            at(ts, 4, '.5in'),
            at(ts, 4, '1.5cm'),
            at(ts, 4, '2mm'),
            at(ts, 4, '1pc'),
            at(ts, 4, '4Q'),
            at(ts, 5, '7px'),
            at(ts, 5, '12px'),
        ])
    }, 60_000)
})

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

// Absolute CSS units: px, pt, pc, cm, mm, Q and in, written straight after a number. The
// number may follow an underscore, as in a Tailwind value like shadow-[0_0_0_2px_red].
const ABSOLUTE = /(?<![A-Za-z0-9#.])\d*\.?\d+(?:px|pt|pc|cm|mm|Q|in)(?![A-Za-z])/g

const sourceFiles = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true })
    return entries
        .filter((entry) => entry.isFile() && /\.(ts|css|html)$/.test(entry.name))
        .map((entry) => join(entry.parentPath, entry.name))
}

describe('units', () => {
    test('the app uses no absolute units, only relative ones', async () => {
        // Arrange
        const files = [...await sourceFiles('src'), 'index.html']

        // Act
        const found = (await Promise.all(files.map(async (file) => {
            const text = await readFile(file, 'utf8')
            return [...text.matchAll(ABSOLUTE)].map((match) => `${file}: ${match[0]}`)
        }))).flat()

        // Assert
        expect(found).toEqual([])
    })
})

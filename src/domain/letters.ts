// The classic dual n-back letter set. C and T rhyme, which the sound-alike stat measures.
export const LETTERS: readonly string[] = ['c', 'h', 'k', 'l', 'q', 'r', 's', 't']

const RHYME_GROUPS: ReadonlyArray<readonly string[]> = [['c', 't']]

export const soundsAlike = (a: number, b: number): boolean => {
    const first = LETTERS[a]
    const second = LETTERS[b]
    return a !== b && RHYME_GROUPS.some((group) =>
        first !== undefined && second !== undefined && group.includes(first) && group.includes(second))
}

export const GRID_SIZE = 3
export const SQUARE_COUNT = GRID_SIZE * GRID_SIZE

export const gridDistance = (a: number, b: number): number =>
    Math.max(
        Math.abs(Math.floor(a / GRID_SIZE) - Math.floor(b / GRID_SIZE)),
        Math.abs((a % GRID_SIZE) - (b % GRID_SIZE)),
    )

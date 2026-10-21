import { differenceInCalendarDays, format } from 'date-fns'

const MINUS = '−'
const PERCENT = 100
const DAYS_PER_WEEK = 7
const WEEKS_BEFORE_MONTHS = 8
const DAYS_PER_MONTH = 30

// Local calendar day, yyyy-MM-dd. Every daily grouping uses this.
export const dayKey = (at: number | Date): string => format(at, 'yyyy-MM-dd')

// "+14", "−9", "0", with a true minus sign.
export const signed = (value: number): string => {
    const rounded = Math.round(value)
    return rounded > 0 ? `+${rounded}` : rounded < 0 ? `${MINUS}${Math.abs(rounded)}` : '0'
}

export const wholeNumber = (value: number): string => {
    const rounded = Math.round(value)
    return rounded < 0 ? `${MINUS}${Math.abs(rounded)}` : String(rounded)
}

export const milliseconds = (value: number): string => `${wholeNumber(value)} ms`

export const percent = (fraction: number): string => `${wholeNumber(fraction * PERCENT)}%`

export const plural = (count: number, one: string, many = `${one}s`): string =>
    `${wholeNumber(count)} ${count === 1 ? one : many}`

const span = (firstAt: number, lastAt: number): string => {
    const days = differenceInCalendarDays(lastAt, firstAt) + 1
    if (days < DAYS_PER_WEEK) {
        return plural(days, 'day')
    }
    const weeks = Math.round(days / DAYS_PER_WEEK)
    return weeks < WEEKS_BEFORE_MONTHS ? plural(weeks, 'week') : plural(Math.round(days / DAYS_PER_MONTH), 'month')
}

// "From 41 rounds over 3 weeks."
export const basis = (rounds: number, firstAt: number, lastAt: number): string =>
    `From ${plural(rounds, 'round')} over ${span(firstAt, lastAt)}.`

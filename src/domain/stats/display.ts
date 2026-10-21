import { milliseconds, percent, plural, signed, wholeNumber } from '../format'

// Display helpers for stats, built on format.ts. All use a true minus sign.

const MINUS = '−'
const PERCENT = 100
const MS = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000 }
const HOURS_BEFORE_DAYS = 48
const SECONDS_BEFORE_MINUTES = 120

export const decimal = (value: number, places: number): string => {
    const text = Math.abs(value).toFixed(places)
    return value < 0 && Number(text) !== 0 ? `${MINUS}${text}` : text
}

export const signedMs = (value: number): string => `${signed(value)} ms`

// Percentage points between two shares: "+8%", "−12%".
export const signedPercent = (fraction: number): string => `${signed(fraction * PERCENT)}%`

export const points = (value: number): string =>
    `${signed(value)} ${Math.abs(Math.round(value)) === 1 ? 'point' : 'points'}`

export const absPoints = (value: number): string => plural(Math.abs(Math.round(value)), 'point')

export const seconds = (ms: number): string =>
    ms < SECONDS_BEFORE_MINUTES * MS.second
        ? `${wholeNumber(ms / MS.second)} s`
        : `${wholeNumber(ms / MS.minute)} min`

export const hoursOrDays = (ms: number): string =>
    ms < HOURS_BEFORE_DAYS * MS.hour
        ? plural(Math.round(ms / MS.hour), 'hour')
        : `${decimal(ms / MS.day, 1)} days`

export const duration = (hours: number): string => {
    const totalMinutes = Math.round(hours * (MS.hour / MS.minute))
    const minutesPerHour = MS.hour / MS.minute
    const wholeHours = Math.floor(totalMinutes / minutesPerHour)
    const minutes = totalMinutes % minutesPerHour
    return wholeHours > 0 ? `${wholeHours} h ${minutes} min` : `${minutes} min`
}

export const absMs = (value: number): string => milliseconds(Math.abs(value))

export const absPercent = (fraction: number): string => percent(Math.abs(fraction))

export { milliseconds, percent, signed, wholeNumber }

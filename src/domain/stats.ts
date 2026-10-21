import type { Dataset } from '../data/dataset'
import type { Finding, Stat } from './analysis-types'
import { accuracySpecs } from './stats/accuracy'
import { dailySlices, fullSlice } from './stats/derive'
import { errorSpecs } from './stats/errors'
import { statFindings as findingsFrom } from './stats/findings'
import { habitSpecs } from './stats/habits'
import { progressSpecs } from './stats/self-progress'
import { toStat } from './stats/spec'
import { speedSpecs } from './stats/speed'
import { staminaSpecs } from './stats/stamina'

// Every stat in PLAN.md's Stats section, in group order, each with its daily trend.
export const computeStats = (dataset: Dataset, now: Date): Stat[] => {
    const overall = fullSlice(dataset)
    const days = dailySlices(dataset)
    return [
        ...accuracySpecs,
        ...speedSpecs,
        ...errorSpecs,
        ...staminaSpecs,
        ...habitSpecs(now),
        ...progressSpecs,
    ].map((spec) => toStat(spec, overall, days))
}

// Findings drawn straight from the stats: why you miss, timing, progress and self-knowledge.
// The insights model adds what helps and hurts and how you play.
export const statFindings = (dataset: Dataset, now: Date): Finding[] => findingsFrom(dataset, now)

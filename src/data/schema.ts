// Every record the app stores. Times named `*At` without a `perf` prefix are wall-clock
// epoch milliseconds; in-round times (onsets, presses, focus changes) come from the
// high-resolution page clock (`performance.now()` / `event.timeStamp`), anchored to the
// wall clock once per session through `SessionRecord.perfAnchor`.

export type Sense = 'position' | 'sound'

export const SENSES: readonly Sense[] = ['position', 'sound']

export type InputType = 'keyboard' | 'touch' | 'mouse' | 'pen'

export interface RatingState {
    rating: number
    rd: number
    vol: number
}

export interface DifficultyStep {
    index: number
    n: number
    intervalMs: number
    lureRate: number
    matchRate: number
    rating: number
}

export interface DeviceInfo {
    // Groups sessions played on the same kind of device, for the model's device factor.
    key: string
    userAgent: string
    screenWidth: number
    screenHeight: number
    pixelRatio: number
    coarsePointer: boolean
    colorScheme: 'light' | 'dark'
    orientation: 'portrait' | 'landscape'
}

export interface Forecast {
    rating: number
    reason: string | null
}

export interface ExperimentAssignment {
    experimentId: string
    condition: 'a' | 'b'
}

export interface SessionRecord {
    id: string
    appOpenedAt: number
    startedAt: number
    perfAnchor: number
    endedAt: number | null
    timeZone: string
    utcOffsetMinutes: number
    device: DeviceInfo
    appVersion: string
    experiment: ExperimentAssignment | null
    forecast: Forecast | null
    note: string | null
}

export interface AudioInfo {
    sampleRate: number
    baseLatency: number
    outputLatency: number
}

export interface RoundRecord {
    id: string
    sessionId: string
    index: number
    stretch: boolean
    step: DifficultyStep
    trialCount: number
    seed: number
    generatorVersion: number
    appVersion: string
    startedAt: number
    perfStart: number
    perfEnd: number | null
    completed: boolean
    quitAtTrial: number | null
    breakBeforeMs: number | null
    refreshHz: number | null
    audio: AudioInfo
    ratingBefore: RatingState
    ratingAfter: RatingState | null
    // Glicko-2 expected result against this round's difficulty step, 0–1.
    expected: number
    accuracy: number | null
    result: number | null
}

export interface TrialFlags {
    hidden: boolean
    blurred: boolean
    droppedFrames: boolean
    audioGlitch: boolean
    earlyPress: boolean
    // The sound was turned off at some point during this trial. Missing on trials saved
    // before the sound button existed, which were all played with sound.
    muted?: boolean
}

export interface TrialRecord {
    id: string
    roundId: string
    sessionId: string
    index: number
    position: number
    sound: number
    positionMatch: boolean
    soundMatch: boolean
    // Every lag other than N at which this stimulus repeats an earlier one (lures).
    positionLags: number[]
    soundLags: number[]
    // Chebyshev distance on the grid to the square N back; null before trial N.
    gridDistance: number | null
    // This sound rhymes with the one N back without being the same letter.
    soundAlike: boolean | null
    scheduledOnset: number
    visualOnset: number | null
    audioOnset: number | null
    droppedFrames: number
    flags: TrialFlags
}

export interface PressRecord {
    id: string
    roundId: string
    sessionId: string
    seq: number
    // null is a key that is neither Position nor Sound.
    sense: Sense | null
    input: InputType
    key: string | null
    repeat: boolean
    downAt: number
    upAt: number | null
    // Offset of a touch or click from the button's center, in px.
    offsetX: number | null
    offsetY: number | null
    contactWidth: number | null
    contactHeight: number | null
    pressure: number | null
}

export type FocusEventType = 'hidden' | 'visible' | 'blur' | 'focus' | 'audio-interrupted' | 'audio-running' | 'sound-off' | 'sound-on'

export interface FocusEventRecord {
    id: string
    roundId: string
    type: FocusEventType
    at: number
}

export interface ScreenViewRecord {
    id: string
    sessionId: string | null
    screen: string
    enteredAt: number
    leftAt: number | null
}

export interface BaselineRecord {
    id: string
    at: number
    deviceKey: string
    reactionTimes: number[]
    misses: number
    anticipations: number
    medianRt: number | null
}

export interface ExperimentRecord {
    id: string
    question: string
    conditionA: string
    conditionB: string
    // Local calendar day, yyyy-MM-dd.
    startDay: string
    days: number
    seed: number
    createdAt: number
    stoppedAt: number | null
}

export type FindingStatus = 'new' | 'confirmed' | 'faded'

export interface FindingRecord {
    id: string
    status: FindingStatus
    sentence: string
    effectPoints: number | null
    // Effect direction when first found; confirmation needs the same sign on new data.
    sign: number
    firstSeenAt: number
    roundsAtDetection: number
    updatedAt: number
}

export interface Settings {
    key: 'settings'
    dailyBaseline: boolean
    // The play screen's sound button. Rounds played with it off aren't rated.
    soundOn: boolean
    rating: RatingState
    ratingUpdatedAt: number | null
}

import type { AudioInfo } from '../data/schema'
import { LETTERS } from '../domain/letters'
import { log } from '../log'

export const MS_PER_SECOND = 1000
// A sample louder than this marks where the spoken letter starts; the silence before it
// is skipped so the sound's onset is the moment you hear it.
const ONSET_THRESHOLD = 0.02

export interface LetterBank {
    context: AudioContext
    // Every letter plays through this, so the sound button can turn them all off.
    output: GainNode
    buffers: AudioBuffer[]
    // Seconds of leading silence in each buffer.
    onsetOffsets: number[]
}

const leadingSilence = (buffer: AudioBuffer): number => {
    const samples = buffer.getChannelData(0)
    const first = samples.findIndex((sample) => Math.abs(sample) > ONSET_THRESHOLD)
    return first < 0 ? 0 : first / buffer.sampleRate
}

const loadLetter = async (context: AudioContext, letter: string): Promise<AudioBuffer> => {
    const response = await fetch(`/sounds/${letter}.wav`)
    if (!response.ok) {
        throw new Error(`Could not load the sound for ${letter}: HTTP ${response.status}`)
    }
    return context.decodeAudioData(await response.arrayBuffer())
}

export const createLetterBank = async (): Promise<LetterBank> => {
    const context = new AudioContext({ latencyHint: 'interactive' })
    const buffers = await Promise.all(LETTERS.map(async (letter) => loadLetter(context, letter)))
    const output = new GainNode(context)
    output.connect(context.destination)
    log.info('audio', 'letters loaded', { sampleRate: context.sampleRate, baseLatency: context.baseLatency })
    return { context, output, buffers, onsetOffsets: buffers.map(leadingSilence) }
}

// Fades rather than cuts, so turning the sound off mid-letter doesn't click.
const FADE_SECONDS = 0.01

export const setSoundOn = (bank: LetterBank, on: boolean): void => {
    bank.output.gain.setTargetAtTime(on ? 1 : 0, bank.context.currentTime, FADE_SECONDS)
}

// Must run inside a user gesture the first time, or the browser keeps audio suspended.
export const resumeAudio = async (bank: LetterBank): Promise<void> => {
    if (bank.context.state !== 'running') {
        await bank.context.resume()
    }
    if (bank.context.state !== 'running') {
        log.warn('audio', 'context did not start', bank.context.state)
    }
}

export const scheduleLetter = (bank: LetterBank, sound: number, when: number): AudioBufferSourceNode => {
    const buffer = bank.buffers[sound]
    if (buffer === undefined) {
        throw new Error(`No sound loaded for letter index ${sound}`)
    }
    const source = new AudioBufferSourceNode(bank.context, { buffer })
    source.connect(bank.output)
    source.start(when, bank.onsetOffsets[sound] ?? 0)
    return source
}

// Converts a time on the audio clock to the page clock. getOutputTimestamp pairs the
// sample currently leaving the speakers with its page time, so the result includes output
// latency. Browsers without it fall back to currentTime plus the reported latency.
export const pageTimeOf = (context: AudioContext, contextTime: number): number => {
    const stamp = context.getOutputTimestamp()
    if (stamp.contextTime !== undefined && stamp.performanceTime !== undefined && stamp.performanceTime > 0) {
        return stamp.performanceTime + (contextTime - stamp.contextTime) * MS_PER_SECOND
    }
    return performance.now() + (contextTime - context.currentTime + context.outputLatency) * MS_PER_SECOND
}

export const audioInfo = (context: AudioContext): AudioInfo => ({
    sampleRate: context.sampleRate,
    baseLatency: context.baseLatency,
    outputLatency: context.outputLatency,
})

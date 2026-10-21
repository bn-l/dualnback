import type { DeviceInfo } from '../data/schema'

const PLATFORMS: ReadonlyArray<[RegExp, string]> = [
    [/iPhone/, 'iphone'],
    [/iPad/, 'ipad'],
    [/Android/, 'android'],
    [/Macintosh|Mac OS X/, 'mac'],
    [/Windows/, 'windows'],
    [/Linux/, 'linux'],
]

const matches = (query: string): boolean => window.matchMedia(query).matches

export const deviceInfo = (): DeviceInfo => {
    const coarsePointer = matches('(pointer: coarse)')
    const platform = PLATFORMS.find(([pattern]) => pattern.test(navigator.userAgent))?.[1] ?? 'other'
    const long = Math.max(screen.width, screen.height)
    const short = Math.min(screen.width, screen.height)
    return {
        key: `${platform}-${coarsePointer ? 'touch' : 'pointer'}-${long}x${short}`,
        userAgent: navigator.userAgent,
        screenWidth: screen.width,
        screenHeight: screen.height,
        pixelRatio: window.devicePixelRatio,
        coarsePointer,
        colorScheme: matches('(prefers-color-scheme: dark)') ? 'dark' : 'light',
        orientation: matches('(orientation: portrait)') ? 'portrait' : 'landscape',
    }
}

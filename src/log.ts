// Namespaced console logging, so a problem in the browser console says where it came from.
const PREFIX = '[dual-n-back]'

const tag = (scope: string): string => `${PREFIX} ${scope}:`

export const log = {
    info: (scope: string, ...details: unknown[]): void => console.info(tag(scope), ...details),
    warn: (scope: string, ...details: unknown[]): void => console.warn(tag(scope), ...details),
    error: (scope: string, ...details: unknown[]): void => console.error(tag(scope), ...details),
}

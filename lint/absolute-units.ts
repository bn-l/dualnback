// CSS's absolute length units. They ignore the reader's font size setting, so the app
// uses relative units only (PLAN.md). Shared by the CSS rule (lint/css-plugin.ts) and the
// rule for class strings in TS (lint/local-plugin.ts).
export const ABSOLUTE_UNITS: ReadonlySet<string> = new Set(['px', 'pt', 'pc', 'in', 'cm', 'mm', 'q'])

// CSS units are case-insensitive: `4PX` is `4px`.
export const isAbsoluteUnit = (unit: string): boolean => ABSOLUTE_UNITS.has(unit.toLowerCase())

export const ABSOLUTE_UNIT_MESSAGE =
    '`{{value}}` is an absolute length. Use rem, em or another relative unit so it follows the reader\'s font size.'

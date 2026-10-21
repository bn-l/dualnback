import css from '@eslint/css'
import cssicorn from 'eslint-cssicorn'
import { defineConfig } from 'eslint/config'
import { tailwind4 } from 'tailwind-csstree'
import local from './lint/css-plugin.ts'

// ESLint lints the CSS only. TS is oxlint's job (vite.config.ts), so the two never overlap.
export default defineConfig([
    { ignores: ['dist/**', 'test-results/**', 'playwright-report/**'] },
    {
        files: ['**/*.css'],
        plugins: { css, cssicorn, local },
        language: 'css/css',
        // Teaches the parser Tailwind v4's @theme, @utility, @variant, @custom-variant and
        // @slot, which would otherwise be parse errors.
        languageOptions: { customSyntax: tailwind4 },
        // Only rules that catch CSS which doesn't do what it says. eslint-cssicorn's rules for
        // order, casing and shorter or newer spellings are left out: their fixes render the
        // same, so they cost edits without changing what ships. require-prefers-reduced-motion
        // is left out too.
        // New cssicorn rules stay off until they're added here. On GitHub but not yet in a
        // release (0.2.0): no-unknown-type-selectors, no-overridden-animation-properties.
        rules: {
            'local/no-absolute-units': 'error',

            // --- invalid or unknown: the browser drops it ---
            'cssicorn/no-invalid-media-features': 'error',
            'cssicorn/no-invalid-property-references': 'error',
            'cssicorn/no-self-referencing-custom-properties': 'error',
            'cssicorn/no-unknown-animations': 'error',
            'cssicorn/no-unknown-annotations': 'error',
            'cssicorn/no-unknown-pseudo-selectors': 'error',
            'cssicorn/no-unscoped-nesting-selector': 'error',
            'cssicorn/require-property-descriptors': 'error',

            // --- valid, but silently has no effect ---
            'cssicorn/consistent-layer-order': 'error',
            'cssicorn/no-clamped-values': 'error',
            'cssicorn/no-duplicate-at-rule-definitions': 'error',
            'cssicorn/no-duplicate-properties': 'error',
            'cssicorn/no-ineffective-keyframe-declarations': 'error',
            'cssicorn/no-ineffective-overrides': 'error',
            'cssicorn/no-ineffective-properties': 'error',
            'cssicorn/no-ineffective-selector-properties': 'error',
            'cssicorn/no-ineffective-supports-conditions': 'error',
            'cssicorn/no-ineffective-transitions': 'error',
            'cssicorn/no-overflow-axis-coercion': 'error',

            // --- the cascade doesn't resolve the way the source reads ---
            'cssicorn/no-declarations-after-nested-rules': 'error',
            'cssicorn/no-descending-specificity': 'error',
            'cssicorn/no-nesting-with-mixed-specificity': 'error',

            // --- deprecated, or breaks on mobile ---
            'cssicorn/no-deprecated-features': 'error',
            'cssicorn/no-disabled-pinch-zoom': 'error',
            'cssicorn/prefer-explicit-viewport-units': 'error',
        },
    },
])

import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite-plus'

// Lint rules mirrored from ../voice-rpg/frontend/vite.config.js — type-aware
// oxlint + tsgolint (TypeScript 7, the Go compiler), run as
// `vp check --no-fmt` (the codebase is hand-formatted; oxfmt never touches it).
// Cross-origin isolation gives performance.now() and event.timeStamp the finest
// resolution the browser allows. Every asset is same-origin, so nothing breaks.
const crossOriginIsolation = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },

    plugins: [tailwindcss()],

    server: { headers: crossOriginIsolation },
    preview: { headers: crossOriginIsolation },

    test: {
        include: ['tests/unit/**/*.test.ts'],
        environment: 'node',
    },

    lint: {
        ignorePatterns: ['dist/**'],
        // Custom rules for CLAUDE.md rules the built-ins don't cover.
        jsPlugins: ['./lint/local-plugin.ts'],
        options: {
            typeAware: true,
            typeCheck: true,
        },
        rules: {
            // A rest-omit destructure (`const { drop, ...rest } = obj`) names a field
            // only to exclude it from `rest` — that is deliberate, not an unused var.
            'no-unused-vars': ['error', { ignoreRestSiblings: true }],
            // Every promise must be handled: await it, or mark a deliberate
            // fire-and-forget with `void`. No silently-dropped rejections.
            'typescript/no-floating-promises': 'error',
            'typescript/no-misused-promises': 'error',
            'typescript/no-explicit-any': 'error',
            // No casts (see CLAUDE.md): bans both `x as T` and `<T>x`. Annotate the
            // binding or use `satisfies` instead. `as const` is caught by local/no-as-const.
            'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
            'typescript/no-non-null-assertion': 'error',
            // Bans `@ts-expect-error` outright, not just when it lacks a description.
            'typescript/ban-ts-comment': ['error', { 'ts-expect-error': true }],
            // Stop `any` from library code leaking in. Without these,
            // `const user: User = await res.json()` is a cast in disguise.
            'typescript/no-unsafe-assignment': 'error',
            'typescript/no-unsafe-return': 'error',
            'typescript/no-unsafe-argument': 'error',
            'typescript/no-unsafe-call': 'error',
            'typescript/no-unsafe-member-access': 'error',

            // --- custom rules (lint/local-plugin.ts) ---
            'local/no-as-const': 'error',
            'local/no-throw-in-promise-executor': 'error',
            'local/no-type-safety-suppression': 'error',
            'local/no-trivial-type': 'error',

            // --- type-aware strictness ---
            // allowNullableString: a `string | null` in a conditional is the idiomatic
            // "present and non-empty" check here and is safe; the valuable parts of the
            // rule (nullable number/boolean, any) stay on.
            'typescript/strict-boolean-expressions': ['error', { allowNullableString: true }],
            'typescript/switch-exhaustiveness-check': ['error', { requireDefaultForNonUnion: true }],
            'typescript/prefer-readonly': 'error',
            'typescript/consistent-type-exports': 'error',
            'typescript/promise-function-async': 'error',
            'typescript/require-array-sort-compare': 'error',

            // --- import / signature hygiene ---
            'typescript/consistent-type-imports': 'error',
            'typescript/no-import-type-side-effects': 'error',
            'typescript/method-signature-style': 'error',
            'typescript/prefer-enum-initializers': 'error',

            // --- core correctness ---
            // null:ignore keeps the idiomatic `x != null` (null OR undefined) check;
            // everything else must use === / !==.
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            'no-implicit-coercion': 'error',

            // --- "extension" rules: oxlint ships one unified implementation under the
            // bare name (no separate `typescript/` variant), so there is no core-off /
            // prefixed-on dance — just enable the bare name. ---
            'no-shadow': 'error',
            'default-param-last': 'error',
            // Calling hoisted functions above their declaration is safe, so only
            // guard variables/classes, not functions.
            'no-use-before-define': ['error', { functions: false }],
            // Cap parameter lists at 4 — past that, take an options object.
            'max-params': ['error', { max: 4 }],
            // No bare literals: name the constant so its meaning is in the code, not a
            // reviewer's head. 0/1/-1 are exempt (loop/index/step idioms), as are enums.
            'no-magic-numbers': ['error', { ignore: [0, 1, -1], ignoreEnums: true }],
        },
        overrides: [
            {
                // Test expectations are literal by nature — the number IS the assertion.
                files: ['tests/**'],
                rules: {
                    'no-magic-numbers': 'off',
                    'typescript/strict-boolean-expressions': 'off',
                },
            },
        ],
    },
})

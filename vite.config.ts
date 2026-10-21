import { defineConfig } from 'vite-plus'

// Lint rules mirrored from ../voice-rpg/frontend/vite.config.js — type-aware
// oxlint + tsgolint (TypeScript 7, the Go compiler), run as
// `vp check --no-fmt` (the codebase is hand-formatted; oxfmt never touches it).
export default defineConfig({
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },

    lint: {
        ignorePatterns: ['dist/**'],
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
            // binding or use `satisfies` instead; `as const` is still allowed.
            'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }],

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

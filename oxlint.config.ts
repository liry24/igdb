import { defineConfig } from 'oxlint'

export default defineConfig({
    categories: {
        correctness: 'error',
        perf: 'warn',
        suspicious: 'error',
    },
    env: { es2022: true, worker: true },
    ignorePatterns: ['**/coverage/**', '**/dist/**', '**/node_modules/**', '.upm-store/**', '.package-check/**'],
    options: {
        typeAware: true,
        typeCheck: true,
    },
    plugins: ['import', 'typescript', 'unicorn', 'vitest'],
    rules: {
        'import/no-cycle': 'error',
        'no-console': 'warn',
        'typescript/no-floating-promises': 'error',
    },
    overrides: [
        {
            files: ['*.config.ts', 'scripts/**/*.ts', 'tests/**/*.ts'],
            env: { node: true },
        },
        {
            files: ['scripts/**/*.ts'],
            rules: { 'no-console': 'off' },
        },
        {
            files: ['src/transport.ts', 'scripts/generate-schema.ts'],
            // Authentication retries and schema-file processing are deliberately ordered.
            rules: { 'no-await-in-loop': 'off' },
        },
        {
            files: ['tests/**/*.ts'],
            rules: {
                'typescript/no-explicit-any': 'off',
                'typescript/no-unsafe-type-assertion': 'off',
                'vitest/valid-expect': ['error', { maxArgs: 2 }],
                'no-await-in-loop': 'off',
            },
        },
    ],
})

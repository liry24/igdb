import { defineConfig } from 'oxfmt'

export default defineConfig({
    ignorePatterns: [
        'LICENSE',
        'schema/**',
        'upm.lock',
        '**/coverage/**',
        '**/dist/**',
        '**/node_modules/**',
        '.upm-store/**',
        '.package-check/**',
    ],
    printWidth: 120,
    semi: false,
    singleQuote: true,
    sortImports: true,
    sortPackageJson: true,
    tabWidth: 4,
    trailingComma: 'all',
})

import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        exclude: ['tests/**/*.test-d.ts'],
        typecheck: { enabled: false },
    },
})

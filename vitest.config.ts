import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            // Match TypeScript path for prisma client
        },
    },
    test: {
        coverage: {
            exclude: ['src/server.ts', 'src/app.ts'],
            include: ['src/**/*.ts', 'utils/**/*.ts'],
            provider: 'v8',
            reporter: ['text', 'lcov'],
            thresholds: {
                branches: 48,
                functions: 45,
                lines: 48,
                statements: 47,
            },
        },
        environment: 'node',
        // Integration tests need a database: npm run test:integration.
        exclude: ['tests/integration/**', 'node_modules/**'],
        globals: true,
        include: ['tests/**/*.test.ts'],
        setupFiles: ['tests/setup.ts'],
    },
});

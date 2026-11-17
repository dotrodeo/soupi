import { defineConfig } from 'vitest/config';

// Integration tests against a real Postgres (see tests/integration/README.md).
// DATABASE_URL must name a local database ending in "_test": the suite deletes
// every row before each test.
export default defineConfig({
    test: {
        environment: 'node',
        fileParallelism: false,
        globals: true,
        globalSetup: ['tests/integration/global-setup.ts'],
        include: ['tests/integration/**/*.test.ts'],
        setupFiles: ['tests/integration/setup.ts'],
        testTimeout: 20_000,
    },
});

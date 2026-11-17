import { execSync } from 'node:child_process';

import { assertTestDatabase } from './test-database';

/** Applies the migrations to the test database once, before any test file. */
export default function setup() {
    assertTestDatabase(process.env.DATABASE_URL);
    execSync('npx prisma migrate deploy', { env: process.env, stdio: 'inherit' });
}

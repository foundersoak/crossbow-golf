// Runs in each isolated test context: bring the D1 schema up before tests.
// @ts-expect-error virtual module provided by vitest-pool-workers
import { applyD1Migrations, env } from 'cloudflare:test'

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)

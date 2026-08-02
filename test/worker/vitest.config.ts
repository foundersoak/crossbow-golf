import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, '../../migrations'))
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: path.join(__dirname, '../../wrangler.jsonc') },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations }
        }
      })
    ],
    test: {
      include: ['test/worker/**/*.test.ts'],
      setupFiles: ['./test/worker/setup.ts']
    }
  }
})

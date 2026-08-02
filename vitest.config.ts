import { defineConfig } from 'vitest/config'

// Unit tests (shared logic, client logic) run in Node.
// Worker/Durable Object integration tests get their own project with
// @cloudflare/vitest-pool-workers (added alongside the round room).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/worker/**']
  }
})

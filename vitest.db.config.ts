import { defineConfig } from 'vitest/config'

// Tes database: menjalankan migration di PostgreSQL sungguhan (DATABASE_URL)
// lalu menguji RLS, RPC, dan perhitungan sebagai pengguna berbeda.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/db/**/*.test.ts'],
    globalSetup: ['tests/db/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})

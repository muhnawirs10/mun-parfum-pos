import { defineConfig } from '@playwright/test'

/**
 * E2E: browser sungguhan → aplikasi build produksi → server tiruan Supabase
 * (tests/e2e/shim) → PostgreSQL dengan migration asli (RLS & RPC asli).
 * Prasyarat: PostgreSQL 15+ di DATABASE_URL (default localhost:54329).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:4174',
    viewport: { width: 1280, height: 800 }, // tablet landscape
    locale: 'id-ID',
    timezoneId: 'Asia/Makassar',
    serviceWorkers: 'block', // hindari cache SW antar tes
    trace: 'off',
    acceptDownloads: true,
  },
  webServer: {
    command:
      'VITE_SUPABASE_URL=http://localhost:54400 VITE_SUPABASE_ANON_KEY=e2e-anon-key-0123456789abcdef npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port 4174 --strictPort',
    url: 'http://localhost:4174/masuk',
    timeout: 180_000,
    reuseExistingServer: false,
  },
})

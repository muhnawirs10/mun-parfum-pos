/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { headers: securityHeaders } = require('./scripts/security-headers.cjs') as { headers: (extra?: string[]) => Record<string, string> }
// asal tambahan connect-src untuk preview lokal (mis. server Supabase tiruan E2E)
const previewConnect = (process.env.PREVIEW_CSP_CONNECT ?? '').split(' ').filter(Boolean)

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt': versi baru diterapkan hanya setelah pengguna setuju,
      // agar halaman tidak dimuat ulang di tengah transaksi kasir.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/favicon-32.png', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'MUN PARFUM POS',
        short_name: 'MUN POS',
        description: 'Aplikasi kasir dan inventaris toko parfum MUN Parfum',
        lang: 'id',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#F5F5F3',
        theme_color: '#F5C518',
        categories: ['business', 'finance', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Kasir', short_name: 'Kasir', url: '/kasir', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Laporan', short_name: 'Laporan', url: '/laporan', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        // cache aset statis (shell aplikasi) untuk loading cepat
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,ico}'],
        // pustaka opsional jsPDF (html2canvas/canvg/dompurify) tidak dipakai aplikasi
        globIgnores: ['**/icons/splash-*.png', '**/html2canvas*.js', '**/index.es-*.js', '**/purify.es-*.js'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // file aplikasi ber-hash yang tidak di-precache: simpan saat pertama dipakai
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: { cacheName: 'app-assets', expiration: { maxEntries: 60, maxAgeSeconds: 60 * 24 * 60 * 60 } },
          },
          {
            // Foto produk & logo (publik) boleh di-cache
            urlPattern: ({ url }) => url.pathname.startsWith('/storage/v1/object/public/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'product-images',
              expiration: { maxEntries: 300, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Data, login, dan Edge Function: SELALU dari jaringan (tidak pernah
            // dari cache) — aplikasi cloud-first, bukan POS offline.
            urlPattern: ({ url }) => /^\/(rest|auth|functions|realtime)\/v1\//.test(url.pathname),
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: { host: true, port: 5173 },
  // preview memakai header keamanan yang sama dengan produksi (CSP ikut diuji E2E)
  preview: { headers: securityHeaders(previewConnect) },
  build: {
    rollupOptions: {
      output: {
        // Pustaka inti dipisah agar tetap ter-cache saat kode aplikasi diperbarui
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client', 'react-router-dom', 'scheduler'],
          supabase: ['@supabase/supabase-js'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'supabase/functions/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    css: false,
    // tes UI berbasis jsdom bisa lambat saat mesin sibuk; batas default 5 detik terlalu ketat
    testTimeout: 15_000,
  },
})

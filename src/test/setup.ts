import '@testing-library/jest-dom/vitest'

// jsdom tidak menyediakan ResizeObserver (dipakai komponen Radix)
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

// Halaman dimuat lazy (code splitting); impor pertama di jsdom bisa > 1 detik.
import { configure } from '@testing-library/react'
configure({ asyncUtilTimeout: 5000 })

// Modul virtual vite-plugin-pwa tidak tersedia di jsdom
import { vi } from 'vitest'
vi.mock('virtual:pwa-register/react', async () => {
  const { pwaMock } = await import('./pwa-mock')
  return {
    useRegisterSW: () => ({
      needRefresh: [pwaMock.needRefresh, (v: boolean) => (pwaMock.needRefresh = v)],
      offlineReady: [pwaMock.offlineReady, (v: boolean) => (pwaMock.offlineReady = v)],
      updateServiceWorker: pwaMock.update,
    }),
  }
})

import '@testing-library/jest-dom/vitest'

// jsdom tidak menyediakan ResizeObserver (dipakai komponen Radix)
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

import { vi } from 'vitest'

/** Status tiruan untuk virtual:pwa-register/react (diatur oleh tes). */
export const pwaMock = { needRefresh: false, offlineReady: false, update: vi.fn(async (reload?: boolean) => void reload) }

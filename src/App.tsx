import { useState } from 'react'
import { RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/features/auth/auth-context'
import { env } from '@/lib/env'
import { supabase } from '@/lib/supabase'
import { createAppRouter } from './router'
import { PwaUpdater } from './pwa/pwa-updater'
import { OfflineBanner } from '@/components/layout/offline-banner'

export default function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
          // Mutasi (transaksi, stok) TIDAK di-retry otomatis untuk mencegah duplikasi;
          // idempotency key tetap dipakai di sisi database.
          mutations: { retry: 0 },
        },
      }),
  )
  const [router] = useState(createAppRouter)
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider client={supabase} staffDomain={env?.VITE_STAFF_EMAIL_DOMAIN ?? 'staff.munparfum.local'}>
        <OfflineBanner />
        <RouterProvider router={router} />
      </AuthProvider>
      <Toaster position="top-center" richColors closeButton />
      <PwaUpdater />
    </QueryClientProvider>
  )
}

import { useState } from 'react'
import { RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { createAppRouter } from './router'

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
      <RouterProvider router={router} />
      <Toaster position="top-center" richColors closeButton />
    </QueryClientProvider>
  )
}

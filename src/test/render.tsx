import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/features/auth/auth-context'
import { routes } from '@/router'
import { createFakeSupabase, seedDb, type FakeDb, type FakeUser } from './fake-supabase'

export function renderRoute(path: string, user: FakeUser | null = null, db: FakeDb = seedDb(), activeOutletId = 'o-tkl') {
  localStorage.clear()
  if (user) localStorage.setItem(`mun-pos:active-outlet:${user.id}`, activeOutletId)
  const fake = createFakeSupabase(user, db)
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider client={fake.client} staffDomain="staff.munparfum.local">
        <RouterProvider router={router} />
      </AuthProvider>
      <Toaster />
    </QueryClientProvider>,
  )
  return { router, fake, db: fake.db, ...utils }
}

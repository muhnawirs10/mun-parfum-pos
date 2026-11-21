import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '@/features/auth/auth-context'
import { routes } from '@/router'
import { createFakeSupabase, type FakeUser } from './fake-supabase'

export function renderRoute(path: string, user: FakeUser | null = null) {
  const fake = createFakeSupabase(user)
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const utils = render(
    <AuthProvider client={fake.client} staffDomain="staff.munparfum.local">
      <RouterProvider router={router} />
    </AuthProvider>,
  )
  return { router, fake, ...utils }
}

import { Suspense, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { BottomNav } from './bottom-nav'

export function AppShell({ fallback = null }: { fallback?: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <main className="mx-auto w-full max-w-6xl px-4 pb-32 pt-6 sm:px-6 lg:px-8">
        <Suspense fallback={fallback}>
          <Outlet />
        </Suspense>
      </main>
      <BottomNav />
    </div>
  )
}

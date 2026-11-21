import { Outlet } from 'react-router-dom'
import { BottomNav } from './bottom-nav'
import { OfflineBanner } from './offline-banner'

export function AppShell() {
  return (
    <div className="min-h-dvh">
      <OfflineBanner />
      <main className="mx-auto w-full max-w-6xl px-4 pb-32 pt-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}

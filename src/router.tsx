import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from '@/components/layout/app-shell'
import { DashboardPage } from '@/pages/dashboard-page'
import { MorePage } from '@/pages/more-page'
import { NotFoundPage } from '@/pages/not-found-page'
import { PlaceholderPage } from '@/pages/placeholder-page'
import { NAV_ITEMS } from '@/lib/navigation'

const PHASE: Record<string, string> = {
  '/produk': 'Fase 3',
  '/stok': 'Fase 4',
  '/kasir': 'Fase 5',
  '/transaksi': 'Fase 5',
  '/laporan': 'Fase 6',
  '/pengeluaran': 'Fase 6',
  '/karyawan': 'Fase 7',
  '/outlet': 'Fase 7',
  '/pengaturan': 'Fase 7',
}

const item = (to: string) => NAV_ITEMS.find((i) => i.to === to)!

export const routes = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'lainnya', element: <MorePage /> },
      ...Object.entries(PHASE).map(([to, phase]) => ({
        path: to.slice(1),
        element: <PlaceholderPage item={item(to)} phase={phase} />,
      })),
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const createAppRouter = () => createBrowserRouter(routes)

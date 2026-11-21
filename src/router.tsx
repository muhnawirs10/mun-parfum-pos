import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import { AppShell } from '@/components/layout/app-shell'
import { RequireAuth, RequirePermission } from '@/features/auth/guards'
import { LoginPage } from '@/features/auth/login-page'
import { DashboardPage } from '@/pages/dashboard-page'
import { MorePage } from '@/pages/more-page'
import { NotFoundPage } from '@/pages/not-found-page'
import { PlaceholderPage } from '@/pages/placeholder-page'
import { ProductsPage } from '@/features/products/products-page'
import { NAV_ITEMS } from '@/lib/navigation'

const PHASE: Record<string, string> = {
  '/stok': 'Fase 4',
  '/kasir': 'Fase 5',
  '/transaksi': 'Fase 5',
  '/laporan': 'Fase 6',
  '/pengeluaran': 'Fase 6',
  '/karyawan': 'Fase 7',
  '/outlet': 'Fase 7',
  '/pengaturan': 'Fase 7',
}

export const routes: RouteObject[] = [
  { path: '/masuk', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'lainnya', element: <MorePage /> },
          {
            path: 'produk',
            element: (
              <RequirePermission anyOf={NAV_ITEMS.find((i) => i.to === '/produk')!.permissions}>
                <ProductsPage />
              </RequirePermission>
            ),
          },
          ...NAV_ITEMS.filter((i) => PHASE[i.to]).map((item) => ({
            path: item.to.slice(1),
            element: (
              <RequirePermission anyOf={item.permissions}>
                <PlaceholderPage item={item} phase={PHASE[item.to]} />
              </RequirePermission>
            ),
          })),
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]

export const createAppRouter = () => createBrowserRouter(routes)

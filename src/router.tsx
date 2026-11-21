import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import { AppShell } from '@/components/layout/app-shell'
import { RequireAuth, RequirePermission } from '@/features/auth/guards'
import { LoginPage } from '@/features/auth/login-page'
import { DashboardPage } from '@/pages/dashboard-page'
import { MorePage } from '@/pages/more-page'
import { NotFoundPage } from '@/pages/not-found-page'
import { PlaceholderPage } from '@/pages/placeholder-page'
import { ProductsPage } from '@/features/products/products-page'
import { StockPage } from '@/features/stock/stock-page'
import { PosPage } from '@/features/pos/pos-page'
import { TransactionsPage } from '@/features/transactions/transactions-page'
import { ReportsPage } from '@/features/reports/reports-page'
import { ExpensesPage } from '@/features/expenses/expenses-page'
import { NAV_ITEMS } from '@/lib/navigation'

const PHASE: Record<string, string> = {
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
            path: 'kasir',
            element: (
              <RequirePermission anyOf={NAV_ITEMS.find((i) => i.to === '/kasir')!.permissions}>
                <PosPage />
              </RequirePermission>
            ),
          },
          { path: 'transaksi', element: <TransactionsPage /> },
          {
            path: 'laporan',
            element: (
              <RequirePermission anyOf={NAV_ITEMS.find((i) => i.to === '/laporan')!.permissions}>
                <ReportsPage />
              </RequirePermission>
            ),
          },
          {
            path: 'pengeluaran',
            element: (
              <RequirePermission anyOf={NAV_ITEMS.find((i) => i.to === '/pengeluaran')!.permissions}>
                <ExpensesPage />
              </RequirePermission>
            ),
          },
          {
            path: 'stok',
            element: (
              <RequirePermission anyOf={NAV_ITEMS.find((i) => i.to === '/stok')!.permissions}>
                <StockPage />
              </RequirePermission>
            ),
          },
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

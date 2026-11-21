import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import { AppShell } from '@/components/layout/app-shell'
import { RequireAuth, RequirePermission } from '@/features/auth/guards'
import { LoginPage } from '@/features/auth/login-page'
import { DashboardPage } from '@/pages/dashboard-page'
import { MorePage } from '@/pages/more-page'
import { NotFoundPage } from '@/pages/not-found-page'
import { ProductsPage } from '@/features/products/products-page'
import { StockPage } from '@/features/stock/stock-page'
import { PosPage } from '@/features/pos/pos-page'
import { TransactionsPage } from '@/features/transactions/transactions-page'
import { ReportsPage } from '@/features/reports/reports-page'
import { ExpensesPage } from '@/features/expenses/expenses-page'
import { StaffPage } from '@/features/staff/staff-page'
import { OutletsPage } from '@/features/outlets/outlets-page'
import { SettingsPage } from '@/features/settings/settings-page'
import { NAV_ITEMS } from '@/lib/navigation'

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
          { path: 'pengaturan', element: <SettingsPage /> },
          {
            path: 'karyawan',
            element: (
              <RequirePermission anyOf={NAV_ITEMS.find((i) => i.to === '/karyawan')!.permissions}>
                <StaffPage />
              </RequirePermission>
            ),
          },
          {
            path: 'outlet',
            element: (
              <RequirePermission anyOf={NAV_ITEMS.find((i) => i.to === '/outlet')!.permissions}>
                <OutletsPage />
              </RequirePermission>
            ),
          },
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
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]

export const createAppRouter = () => createBrowserRouter(routes)

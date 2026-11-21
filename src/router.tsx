import { lazy, Suspense, type ComponentType } from 'react'
import { createBrowserRouter, Outlet, type RouteObject } from 'react-router-dom'
import { AppShell } from '@/components/layout/app-shell'
import { FullScreenLoader, RequireAuth, RequirePermission } from '@/features/auth/guards'
import type { Permission } from '@/features/auth/permissions'
import { NAV_ITEMS } from '@/lib/navigation'
import { NotFoundPage } from '@/pages/not-found-page'
import { PageLoader } from '@/components/layout/page-loader'

/**
 * Setiap halaman dimuat saat pertama kali dibuka (code splitting) agar
 * aplikasi cepat terbuka di tablet. Pustaka berat (PDF, Excel, zod) ikut
 * dimuat bersama halaman yang memakainya saja.
 */
function page<T extends Record<string, ComponentType>>(loader: () => Promise<T>, name: keyof T) {
  return lazy(() => loader().then((m) => ({ default: m[name] })))
}

const LoginPage = page(() => import('@/features/auth/login-page'), 'LoginPage')
const DashboardPage = page(() => import('@/pages/dashboard-page'), 'DashboardPage')
const MorePage = page(() => import('@/pages/more-page'), 'MorePage')
const ProductsPage = page(() => import('@/features/products/products-page'), 'ProductsPage')
const StockPage = page(() => import('@/features/stock/stock-page'), 'StockPage')
const PosPage = page(() => import('@/features/pos/pos-page'), 'PosPage')
const TransactionsPage = page(() => import('@/features/transactions/transactions-page'), 'TransactionsPage')
const ReportsPage = page(() => import('@/features/reports/reports-page'), 'ReportsPage')
const ExpensesPage = page(() => import('@/features/expenses/expenses-page'), 'ExpensesPage')
const StaffPage = page(() => import('@/features/staff/staff-page'), 'StaffPage')
const OutletsPage = page(() => import('@/features/outlets/outlets-page'), 'OutletsPage')
const SettingsPage = page(() => import('@/features/settings/settings-page'), 'SettingsPage')

const perms = (to: string): Permission[] | undefined => NAV_ITEMS.find((i) => i.to === to)?.permissions

function guarded(to: string, Page: ComponentType) {
  return (
    <RequirePermission anyOf={perms(to)}>
      <Page />
    </RequirePermission>
  )
}

export const routes: RouteObject[] = [
  {
    element: (
      <Suspense fallback={<FullScreenLoader />}>
        <Outlet />
      </Suspense>
    ),
    children: [
      { path: '/masuk', element: <LoginPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell fallback={<PageLoader />} />,
            children: [
              { index: true, element: <DashboardPage /> },
              { path: 'lainnya', element: <MorePage /> },
              { path: 'kasir', element: guarded('/kasir', PosPage) },
              { path: 'transaksi', element: <TransactionsPage /> },
              { path: 'pengaturan', element: <SettingsPage /> },
              { path: 'karyawan', element: guarded('/karyawan', StaffPage) },
              { path: 'outlet', element: guarded('/outlet', OutletsPage) },
              { path: 'laporan', element: guarded('/laporan', ReportsPage) },
              { path: 'pengeluaran', element: guarded('/pengeluaran', ExpensesPage) },
              { path: 'stok', element: guarded('/stok', StockPage) },
              { path: 'produk', element: guarded('/produk', ProductsPage) },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
]

export const createAppRouter = () => createBrowserRouter(routes)

/** Harus sama dengan public.role_default_permissions() di database. */
export const PERMISSIONS = [
  'pos.sell',
  'transactions.view_all',
  'transactions.void',
  'products.manage',
  'stock.manage',
  'cost.view',
  'profit.view',
  'reports.view',
  'expenses.view',
  'expenses.manage',
  'closing.perform',
  'users.manage',
  'settings.manage',
  'audit.view',
] as const

export type Permission = (typeof PERMISSIONS)[number]
export type AppRole = 'owner' | 'admin' | 'kasir'

export const ROLE_LABEL: Record<AppRole, string> = { owner: 'Pemilik', admin: 'Admin', kasir: 'Kasir' }

export interface OutletAccess {
  outlet_id: string
  outlet_code: string
  outlet_name: string
  role: AppRole
  permissions: Permission[]
}

/**
 * Pemeriksaan izin di UI hanya untuk menyembunyikan menu/tombol.
 * Keamanan sesungguhnya ditegakkan oleh RLS dan RPC di database.
 */
export function hasPermission(access: OutletAccess | null | undefined, ...anyOf: Permission[]): boolean {
  if (!access) return false
  if (anyOf.length === 0) return true
  return anyOf.some((p) => access.permissions.includes(p))
}

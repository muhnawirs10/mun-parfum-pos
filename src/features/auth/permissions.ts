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

/** Harus sama dengan public.role_default_permissions() di database. */
export const ROLE_DEFAULTS: Record<'admin' | 'kasir', Permission[]> = {
  admin: ['pos.sell', 'transactions.view_all', 'transactions.void', 'products.manage', 'stock.manage', 'cost.view', 'reports.view', 'closing.perform'],
  kasir: ['pos.sell'],
}

/** Izin tambahan yang boleh diberikan admin (users.manage) kepada kasir. */
export const DELEGABLE: Permission[] = ['closing.perform', 'transactions.view_all']

export const PERMISSION_LABEL: Record<Permission, string> = {
  'pos.sell': 'Membuat transaksi (kasir)',
  'transactions.view_all': 'Melihat semua transaksi outlet',
  'transactions.void': 'Membatalkan transaksi',
  'products.manage': 'Mengelola produk',
  'stock.manage': 'Mengelola stok',
  'cost.view': 'Melihat HPP',
  'profit.view': 'Melihat laba & laporan keuangan',
  'reports.view': 'Melihat laporan penjualan',
  'expenses.view': 'Melihat pengeluaran',
  'expenses.manage': 'Mencatat pengeluaran',
  'closing.perform': 'Closing kas',
  'users.manage': 'Mengelola kasir',
  'settings.manage': 'Mengubah pengaturan outlet',
  'audit.view': 'Melihat riwayat audit',
}

/**
 * Ubah daftar izin efektif (yang dicentang) menjadi kolom DB:
 * permissions = tambahan di luar bawaan; revoked = bawaan yang dicabut.
 */
export function splitPermissions(role: 'admin' | 'kasir', effective: Permission[]) {
  const defaults = ROLE_DEFAULTS[role]
  return {
    permissions: effective.filter((p) => !defaults.includes(p)),
    revoked: defaults.filter((p) => !effective.includes(p)),
  }
}

export function effectivePermissions(role: 'admin' | 'kasir', permissions: string[], revoked: string[]): Permission[] {
  const set = new Set<string>([...ROLE_DEFAULTS[role], ...permissions])
  revoked.forEach((p) => set.delete(p))
  return PERMISSIONS.filter((p) => set.has(p))
}

import {
  BarChart3,
  Boxes,
  CalendarCheck,
  Home,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  Store,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { Permission } from '@/features/auth/permissions'

export interface NavItem {
  to: string
  label: string
  description: string
  icon: LucideIcon
  group: 'utama' | 'operasional' | 'manajemen'
  /** Salah satu izin ini diperlukan (kosong = semua pengguna yang login). */
  permissions?: Permission[]
}

/** Sepuluh halaman wajib (spesifikasi bagian 10) + Absensi. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Beranda', description: 'Ringkasan penjualan hari ini', icon: Home, group: 'utama' },
  { to: '/produk', label: 'Produk', description: 'Kelola produk, harga, dan HPP', icon: Package, group: 'utama', permissions: ['products.manage'] },
  { to: '/kasir', label: 'Kasir', description: 'Buat transaksi penjualan', icon: ShoppingCart, group: 'utama', permissions: ['pos.sell'] },
  { to: '/laporan', label: 'Laporan', description: 'Omzet, laba, dan closing harian', icon: BarChart3, group: 'utama', permissions: ['reports.view', 'closing.perform'] },
  { to: '/transaksi', label: 'Riwayat Transaksi', description: 'Daftar transaksi dan cetak ulang struk', icon: Receipt, group: 'operasional' },
  { to: '/absensi', label: 'Absensi', description: 'Absen masuk/pulang, izin, dan rekap kehadiran', icon: CalendarCheck, group: 'operasional' },
  { to: '/pengeluaran', label: 'Pengeluaran', description: 'Catat biaya operasional', icon: Wallet, group: 'operasional', permissions: ['expenses.view', 'expenses.manage'] },
  { to: '/stok', label: 'Stok', description: 'Stok masuk, keluar, dan riwayat pergerakan', icon: Boxes, group: 'operasional', permissions: ['stock.manage'] },
  { to: '/karyawan', label: 'Karyawan', description: 'Pengguna, peran, dan hak akses', icon: Users, group: 'manajemen', permissions: ['users.manage'] },
  { to: '/outlet', label: 'Outlet', description: 'Data outlet dan perbandingan kinerja', icon: Store, group: 'manajemen', permissions: ['settings.manage'] },
  { to: '/pengaturan', label: 'Pengaturan', description: 'Akun saya, struk, dan izin stok minus', icon: Settings, group: 'manajemen' },
]

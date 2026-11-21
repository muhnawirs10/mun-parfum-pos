import {
  BarChart3,
  Boxes,
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

export interface NavItem {
  to: string
  label: string
  description: string
  icon: LucideIcon
  group: 'utama' | 'operasional' | 'manajemen'
}

/** Sepuluh halaman wajib (spesifikasi bagian 10). */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Beranda', description: 'Ringkasan penjualan hari ini', icon: Home, group: 'utama' },
  { to: '/produk', label: 'Produk', description: 'Kelola produk, harga, dan HPP', icon: Package, group: 'utama' },
  { to: '/kasir', label: 'Kasir', description: 'Buat transaksi penjualan', icon: ShoppingCart, group: 'utama' },
  { to: '/laporan', label: 'Laporan', description: 'Omzet, laba, dan closing harian', icon: BarChart3, group: 'utama' },
  { to: '/transaksi', label: 'Riwayat Transaksi', description: 'Daftar transaksi dan cetak ulang struk', icon: Receipt, group: 'operasional' },
  { to: '/pengeluaran', label: 'Pengeluaran', description: 'Catat biaya operasional', icon: Wallet, group: 'operasional' },
  { to: '/stok', label: 'Stok', description: 'Stok masuk, keluar, dan riwayat pergerakan', icon: Boxes, group: 'operasional' },
  { to: '/karyawan', label: 'Karyawan', description: 'Pengguna, peran, dan hak akses', icon: Users, group: 'manajemen' },
  { to: '/outlet', label: 'Outlet', description: 'Data outlet dan perbandingan kinerja', icon: Store, group: 'manajemen' },
  { to: '/pengaturan', label: 'Pengaturan', description: 'Struk, izin stok minus, dan preferensi', icon: Settings, group: 'manajemen' },
]

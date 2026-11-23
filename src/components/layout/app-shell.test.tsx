import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderRoute } from '@/test/render'
import { USERS } from '@/test/fake-supabase'
import { NAV_ITEMS } from '@/lib/navigation'

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })
  window.dispatchEvent(new Event(value ? 'online' : 'offline'))
}

describe('App shell', () => {
  afterEach(() => setOnline(true))

  it('menampilkan navigasi bawah dengan tombol Kasir', async () => {
    renderRoute('/', USERS.owner)
    const nav = await screen.findByRole('navigation', { name: 'Navigasi utama' })
    for (const label of ['Beranda', 'Produk', 'Kasir', 'Laporan', 'Lainnya']) {
      expect(nav).toHaveTextContent(label)
    }
  })

  it('menampilkan indikator offline saat koneksi terputus dan hilang saat pulih', async () => {
    renderRoute('/', USERS.owner)
    await screen.findByRole('navigation', { name: 'Navigasi utama' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    act(() => setOnline(false))
    expect(screen.getByRole('alert')).toHaveTextContent('Tidak ada koneksi internet')
    act(() => setOnline(true))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('semua halaman (10 wajib + Absensi) dapat dibuka', async () => {
    expect(NAV_ITEMS).toHaveLength(11)
    for (const item of NAV_ITEMS) {
      const { unmount } = renderRoute(item.to, USERS.owner)
      expect((await screen.findAllByText(item.label)).length).toBeGreaterThan(0)
      expect(screen.queryByText('Akses ditolak')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('menu Lainnya dapat dicari', async () => {
    renderRoute('/lainnya', USERS.owner)
    await userEvent.type(await screen.findByLabelText('Cari menu'), 'pengel')
    expect(screen.getByText('Pengeluaran')).toBeInTheDocument()
    expect(screen.queryByText('Karyawan')).not.toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Cari menu'))
    await userEvent.type(screen.getByLabelText('Cari menu'), 'zzz')
    expect(screen.getByText('Menu tidak ditemukan.')).toBeInTheDocument()
  })

  it('rute tidak dikenal menampilkan 404', async () => {
    renderRoute('/tidak-ada', USERS.owner)
    expect(await screen.findByText('Halaman tidak ditemukan')).toBeInTheDocument()
  })
})

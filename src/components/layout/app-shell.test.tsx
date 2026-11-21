import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderRoute } from '@/test/render'
import { NAV_ITEMS } from '@/lib/navigation'

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })
  window.dispatchEvent(new Event(value ? 'online' : 'offline'))
}

describe('App shell', () => {
  afterEach(() => setOnline(true))

  it('menampilkan navigasi bawah dengan tombol Kasir', () => {
    renderRoute('/')
    const nav = screen.getByRole('navigation', { name: 'Navigasi utama' })
    for (const label of ['Beranda', 'Produk', 'Kasir', 'Laporan', 'Lainnya']) {
      expect(nav).toHaveTextContent(label)
    }
  })

  it('menampilkan indikator offline saat koneksi terputus dan hilang saat pulih', () => {
    renderRoute('/')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    act(() => setOnline(false))
    expect(screen.getByRole('alert')).toHaveTextContent('Tidak ada koneksi internet')
    act(() => setOnline(true))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('semua 10 halaman wajib dapat dibuka', () => {
    expect(NAV_ITEMS).toHaveLength(10)
    for (const item of NAV_ITEMS) {
      const { unmount } = renderRoute(item.to)
      expect(screen.getAllByText(item.label).length).toBeGreaterThan(0)
      unmount()
    }
  })

  it('menu Lainnya dapat dicari', async () => {
    renderRoute('/lainnya')
    await userEvent.type(screen.getByLabelText('Cari menu'), 'pengel')
    expect(screen.getByText('Pengeluaran')).toBeInTheDocument()
    expect(screen.queryByText('Karyawan')).not.toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Cari menu'))
    await userEvent.type(screen.getByLabelText('Cari menu'), 'zzz')
    expect(screen.getByText('Menu tidak ditemukan.')).toBeInTheDocument()
  })

  it('rute tidak dikenal menampilkan 404', () => {
    renderRoute('/tidak-ada')
    expect(screen.getByText('Halaman tidak ditemukan')).toBeInTheDocument()
  })
})

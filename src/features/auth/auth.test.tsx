import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderRoute } from '@/test/render'
import { USERS } from '@/test/fake-supabase'
import { AuthProvider } from './auth-context'
import { identifierToEmail, loginSchema } from './identifier'
import { hasPermission } from './permissions'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { routes } from '@/router'

describe('identifier login', () => {
  it('username dipetakan ke email staf, email tetap', () => {
    expect(identifierToEmail('Kasir1', 'staff.munparfum.local')).toBe('kasir1@staff.munparfum.local')
    expect(identifierToEmail(' Owner@MunParfum.id ', 'x')).toBe('owner@munparfum.id')
  })
  it('validasi Zod', () => {
    expect(loginSchema.safeParse({ identifier: 'ab', password: '123456' }).success).toBe(false)
    expect(loginSchema.safeParse({ identifier: 'kasir 1', password: '123456' }).success).toBe(false)
    expect(loginSchema.safeParse({ identifier: 'kasir1', password: '123' }).success).toBe(false)
    expect(loginSchema.safeParse({ identifier: 'kasir1', password: '123456' }).success).toBe(true)
  })
})

describe('Login dan logout', () => {
  it('pengguna belum login diarahkan ke halaman masuk', async () => {
    const { router } = renderRoute('/laporan')
    expect(await screen.findByRole('heading', { name: 'MUN PARFUM POS' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/masuk')
  })

  it('validasi form sebelum mengirim', async () => {
    const { fake } = renderRoute('/masuk')
    await userEvent.click(await screen.findByRole('button', { name: /Masuk/ }))
    expect(screen.getByText('Masukkan email atau username')).toBeInTheDocument()
    expect(fake.calls.signIn).toHaveLength(0)
  })

  it('kata sandi salah menampilkan pesan Indonesia', async () => {
    renderRoute('/masuk')
    await userEvent.type(await screen.findByLabelText('Email atau username'), 'kasir1')
    await userEvent.type(screen.getByLabelText('Kata sandi'), 'salahsalah')
    await userEvent.click(screen.getByRole('button', { name: /Masuk/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email/username atau kata sandi salah.')
  })

  it('login dengan username → kembali ke halaman tujuan → logout', async () => {
    const { router, fake } = renderRoute('/lainnya')
    await userEvent.type(await screen.findByLabelText('Email atau username'), 'kasir1')
    await userEvent.type(screen.getByLabelText('Kata sandi'), 'rahasia123')
    await userEvent.click(screen.getByRole('button', { name: /Masuk/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/lainnya'))
    expect(fake.calls.signIn).toEqual(['kasir1@staff.munparfum.local'])
    expect(await screen.findByText('Kasir Satu')).toBeInTheDocument()
    expect(screen.getByText('MUN Parfum Takalar')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Keluar/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/masuk'))
    expect(fake.calls.signOut).toBe(1)
  })

  it('tanpa konfigurasi Supabase menampilkan layar setup', () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] })
    render(
      <AuthProvider client={null} staffDomain="x">
        <RouterProvider router={router} />
      </AuthProvider>,
    )
    expect(screen.getByText('Konfigurasi Supabase belum diisi')).toBeInTheDocument()
  })

  it('akun tanpa outlet tidak dapat masuk ke aplikasi', async () => {
    renderRoute('/', USERS.orphan)
    expect(await screen.findByText('Belum ada outlet untuk akun ini')).toBeInTheDocument()
  })
})

describe('Peran pengguna di UI', () => {
  it('kasir: menu manajemen tersembunyi dan halaman laporan ditolak', async () => {
    renderRoute('/lainnya', USERS.kasir)
    expect(await screen.findByText('Kasir Satu')).toBeInTheDocument()
    expect(screen.getByText('Riwayat Transaksi')).toBeInTheDocument()
    for (const hidden of ['Pengeluaran', 'Stok', 'Karyawan', 'Outlet', 'Pengaturan']) {
      expect(screen.queryByText(hidden)).not.toBeInTheDocument()
    }
    const r2 = renderRoute('/laporan', USERS.kasir)
    expect(await r2.findByText('Akses ditolak')).toBeInTheDocument()
  })

  it('admin: dapat membuka stok, tidak dapat membuka karyawan', async () => {
    const a = renderRoute('/stok', USERS.admin)
    expect(await a.findByText('Modul Stok sedang dibangun')).toBeInTheDocument()
    a.unmount()
    renderRoute('/karyawan', USERS.admin)
    expect(await screen.findByText('Akses ditolak')).toBeInTheDocument()
  })

  it('owner: melihat semua menu dan dapat berpindah outlet', async () => {
    renderRoute('/lainnya', USERS.owner)
    expect(await screen.findByText('Nawir')).toBeInTheDocument()
    expect(screen.getByText('@nawir08')).toBeInTheDocument()
    for (const label of ['Pengeluaran', 'Stok', 'Karyawan', 'Outlet', 'Pengaturan']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    await userEvent.click(screen.getByRole('button', { name: 'MKS' }))
    expect(screen.getByRole('button', { name: 'MKS' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('MUN Parfum Makassar')).toBeInTheDocument()
  })

  it('hasPermission', () => {
    expect(hasPermission(USERS.kasir.access[0], 'pos.sell')).toBe(true)
    expect(hasPermission(USERS.kasir.access[0], 'cost.view', 'profit.view')).toBe(false)
    expect(hasPermission(null, 'pos.sell')).toBe(false)
  })
})

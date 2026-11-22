import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderRoute } from '@/test/render'
import { USERS, type FakeUser } from '@/test/fake-supabase'
import { effectivePermissions, splitPermissions } from '@/features/auth/permissions'

const user = userEvent.setup()

const ADMIN_MANAGER: FakeUser = {
  ...USERS.admin,
  access: [{ ...USERS.admin.access[0], permissions: [...USERS.admin.access[0].permissions, 'users.manage'] }],
}

async function open(u: FakeUser = USERS.owner) {
  const r = renderRoute('/karyawan', u)
  await screen.findAllByTestId('staff-row')
  return r
}

const row = (name: string) => screen.getByText(name, { selector: 'p.font-semibold, p.font-semibold *' }).closest('[data-testid="staff-row"]') as HTMLElement

describe('izin efektif', () => {
  it('memisahkan izin tambahan dan izin bawaan yang dicabut', () => {
    expect(splitPermissions('kasir', ['pos.sell', 'closing.perform'])).toEqual({ permissions: ['closing.perform'], revoked: [] })
    expect(splitPermissions('admin', ['pos.sell', 'profit.view'])).toMatchObject({ permissions: ['profit.view'] })
    expect(splitPermissions('admin', ['pos.sell']).revoked).toContain('cost.view')
    expect(effectivePermissions('kasir', ['closing.perform'], [])).toEqual(['pos.sell', 'closing.perform'])
    expect(effectivePermissions('admin', [], ['cost.view'])).not.toContain('cost.view')
  })
})

describe('Halaman Karyawan', () => {
  it('owner melihat semua karyawan dengan peran per outlet', async () => {
    await open()
    expect(screen.getAllByTestId('staff-row')).toHaveLength(3)
    expect(row('Nawir')).toHaveTextContent('Pemilik · semua outlet')
    expect(row('Kasir Satu')).toHaveTextContent('TKL · Kasir')
    expect(row('Admin TKL')).toHaveTextContent('TKL · Admin')
    expect(within(row('Nawir')).queryByRole('button', { name: /Akses/ })).not.toBeInTheDocument()
  })

  it('owner menambah kasir dengan username lewat Edge Function; username ganda ditolak', async () => {
    const { fake, db } = await open()
    await user.click(screen.getByRole('button', { name: /Tambah/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Tambah Karyawan' })
    // outlet default = outlet yang sedang dibuka (TKL), bukan outlet pertama menurut kode (MKS)
    expect(within(dialog).getByLabelText('Outlet')).toHaveValue('o-tkl')
    await user.type(within(dialog).getByLabelText('Nama lengkap'), 'Kasir Dua')
    await user.type(within(dialog).getByLabelText('Username'), 'kasir1')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Closing kas' }))
    await user.click(within(dialog).getByRole('button', { name: /Buat akun/ }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Username kasir1 sudah dipakai')

    await user.clear(within(dialog).getByLabelText('Username'))
    await user.type(within(dialog).getByLabelText('Username'), 'Kasir2')
    await user.click(within(dialog).getByRole('button', { name: /Buat akun/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const body = fake.calls.functions.slice(-1)[0].body
    expect(body).toMatchObject({ action: 'create_staff', username: 'kasir2', full_name: 'Kasir Dua', role: 'kasir', permissions: ['closing.perform'] })
    expect(String(body.password)).toHaveLength(10)
    const created = db.staff.find((m) => m.username === 'kasir2')!
    expect(created.assignments).toEqual([expect.objectContaining({ role: 'kasir', permissions: ['closing.perform'] })])
    expect(await screen.findByText('Kasir Dua')).toBeInTheDocument()
  })

  it('admin (users.manage): hanya peran kasir dan izin aman yang bisa dipilih', async () => {
    await open(ADMIN_MANAGER)
    expect(screen.getAllByTestId('staff-row').map((r) => r.querySelector('p')!.textContent)).toEqual(expect.arrayContaining(['Admin TKLAnda', 'Kasir Satu']))
    expect(within(row('Admin TKL')).queryByRole('button', { name: /Akses/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Tambah/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(within(dialog).getByLabelText('Peran')).queryByRole('option', { name: 'Admin' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: 'Melihat laba & laporan keuangan' })).toBeDisabled()
    expect(within(dialog).getByRole('checkbox', { name: 'Closing kas' })).toBeEnabled()
    expect(within(dialog).queryByRole('button', { name: /Nonaktifkan/ })).not.toBeInTheDocument()
  })

  it('atur akses: centang izin disimpan sebagai tambahan/cabutan; penugasan bisa dinonaktifkan', async () => {
    const { fake } = await open()
    await user.click(within(row('Admin TKL')).getByRole('button', { name: /Akses/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Akses Admin TKL' })
    expect(within(dialog).getByRole('checkbox', { name: /^Melihat HPP/ })).toBeChecked()
    await user.click(within(dialog).getByRole('checkbox', { name: /^Melihat HPP/ }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Melihat laba & laporan keuangan' }))
    await user.click(within(dialog).getByRole('switch', { name: 'Aktif di outlet ini' }))
    await user.click(within(dialog).getByRole('button', { name: /Simpan akses/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const call = fake.calls.rpc.find((c) => c.fn === 'assign_outlet_user')!
    expect(call.args).toMatchObject({ p_user_id: 'u-admin', p_outlet_id: 'o-tkl', p_role: 'admin', p_permissions: ['profit.view'], p_revoked: ['cost.view'], p_active: false })
    expect(await screen.findByText(/TKL · Admin \(nonaktif\)/)).toBeInTheDocument()
  })

  it('reset sandi & nonaktifkan akun memanggil Edge Function', async () => {
    const { fake } = await open()
    await user.click(within(row('Kasir Satu')).getByRole('button', { name: /Sandi/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Reset Kata Sandi' })
    await user.clear(within(dialog).getByLabelText('Kata sandi baru'))
    await user.type(within(dialog).getByLabelText('Kata sandi baru'), 'pendek')
    await user.click(within(dialog).getByRole('button', { name: /Simpan kata sandi/ }))
    expect(within(dialog).getByText('Kata sandi minimal 8 karakter')).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText('Kata sandi baru'))
    await user.type(within(dialog).getByLabelText('Kata sandi baru'), 'sandiBaru99')
    await user.click(within(dialog).getByRole('button', { name: /Simpan kata sandi/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fake.calls.adminUpdates).toContainEqual({ id: 'u-kasir', attrs: { password: 'sandiBaru99' } })

    await user.click(within(row('Kasir Satu')).getByRole('button', { name: /Nonaktifkan/ }))
    await waitFor(() => expect(row('Kasir Satu')).toHaveTextContent('Nonaktif'))
    expect(fake.calls.adminUpdates).toContainEqual({ id: 'u-kasir', attrs: { ban_duration: '876000h' } })
  })

  it('tab aktivitas menampilkan riwayat audit (owner)', async () => {
    await open()
    await user.click(screen.getByRole('tab', { name: /Aktivitas/ }))
    const rows = await screen.findAllByTestId('audit-row')
    expect(rows[0]).toHaveTextContent('Kasir Satu membuat Transaksi · TKL')
    expect(rows[0]).toHaveTextContent('number: MP-TKL-20261121-0001')
    expect(rows[1]).toHaveTextContent('Nawir mengubah Produk')
  })

  it('kasir tidak dapat membuka halaman karyawan', async () => {
    renderRoute('/karyawan', USERS.kasir)
    expect(await screen.findByText('Akses ditolak')).toBeInTheDocument()
  })
})

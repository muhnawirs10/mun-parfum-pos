import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderRoute } from '@/test/render'
import { seedDb, USERS } from '@/test/fake-supabase'

const user = userEvent.setup()

describe('Halaman Pengaturan', () => {
  it('owner: ubah footer struk dan izinkan stok minus', async () => {
    const db = seedDb()
    const { fake } = renderRoute('/pengaturan', USERS.owner, db)
    const footer = await screen.findByLabelText('Pesan di bawah struk')
    await user.clear(footer)
    await user.type(footer, 'Wangi setiap hari!')
    await user.click(screen.getByRole('button', { name: /Simpan pesan struk/ }))
    await waitFor(() => expect(fake.calls.rpc.find((c) => c.fn === 'set_setting')!.args).toEqual({ p_outlet_id: 'o-tkl', p_key: 'receipt_footer', p_value: 'Wangi setiap hari!' }))
    await user.click(screen.getByRole('switch', { name: 'Izinkan stok minus' }))
    await waitFor(() => expect(fake.calls.rpc.filter((c) => c.fn === 'set_setting').slice(-1)[0].args).toMatchObject({ p_key: 'allow_negative_stock', p_value: true }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Izinkan stok minus' })).toBeChecked())
  })

  it('kasir: hanya akun sendiri; pengaturan outlet terkunci', async () => {
    renderRoute('/pengaturan', USERS.kasir)
    expect(await screen.findByLabelText('Pesan di bawah struk')).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Izinkan stok minus' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Simpan pesan struk/ })).not.toBeInTheDocument()
  })

  it('akun saya: ubah nama dan kata sandi dengan validasi', async () => {
    const { fake } = renderRoute('/pengaturan', USERS.kasir)
    const name = await screen.findByLabelText('Nama')
    await user.clear(name)
    await user.type(name, 'Kasir Satu Baru')
    const card = name.closest('.rounded-2xl') as HTMLElement
    await user.click(within(card).getAllByRole('button', { name: /Simpan/ })[0])
    await waitFor(() => expect(fake.calls.rpc.find((c) => c.fn === 'update_staff_name')!.args).toEqual({ p_user_id: 'u-kasir', p_full_name: 'Kasir Satu Baru' }))

    await user.type(screen.getByLabelText('Kata sandi baru'), 'sandiBaru99')
    await user.type(screen.getByLabelText('Ulangi kata sandi baru'), 'sandiBeda99')
    await user.click(screen.getByRole('button', { name: /Ganti kata sandi/ }))
    expect(screen.getByText('Konfirmasi kata sandi tidak sama')).toBeInTheDocument()
    expect(fake.calls.authUpdates).toHaveLength(0)
    await user.clear(screen.getByLabelText('Ulangi kata sandi baru'))
    await user.type(screen.getByLabelText('Ulangi kata sandi baru'), 'sandiBaru99')
    await user.click(screen.getByRole('button', { name: /Ganti kata sandi/ }))
    await waitFor(() => expect(fake.calls.authUpdates).toEqual([{ password: 'sandiBaru99' }]))
    expect(await screen.findByText('Kata sandi diganti')).toBeInTheDocument()
    void seedDb
  })
})

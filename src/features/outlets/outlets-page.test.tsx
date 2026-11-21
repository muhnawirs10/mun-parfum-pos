import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderRoute } from '@/test/render'
import { USERS } from '@/test/fake-supabase'

const user = userEvent.setup()

describe('Halaman Outlet', () => {
  it('owner melihat semua outlet beserta omzet & stok; dapat membuat outlet baru', async () => {
    const { db, fake } = renderRoute('/outlet', USERS.owner)
    const cards = await screen.findAllByTestId('outlet-card')
    expect(cards).toHaveLength(2)
    const tkl = cards.find((c) => c.textContent!.includes('MUN Parfum Takalar'))!
    expect(tkl).toHaveTextContent('Sedang dibuka')
    await waitFor(() => expect(tkl).toHaveTextContent('Stok menipis/habis2'))
    expect(fake.calls.rpc.some((c) => c.fn === 'get_sales_report' && c.args.p_outlet_id === null)).toBe(true)

    await user.click(screen.getByRole('button', { name: /Tambah outlet/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Tambah Outlet' })
    await user.type(within(dialog).getByLabelText('Kode'), 'gw-1')
    await user.type(within(dialog).getByLabelText('Nama outlet'), 'MUN Parfum Gowa')
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    expect(within(dialog).getByText('Kode 2–6 huruf/angka, contoh: TKL')).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText('Kode'))
    await user.type(within(dialog).getByLabelText('Kode'), 'tkl')
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Kode outlet TKL sudah dipakai')
    await user.clear(within(dialog).getByLabelText('Kode'))
    await user.type(within(dialog).getByLabelText('Kode'), 'gwa')
    await user.type(within(dialog).getByLabelText('Telepon'), '0811-222-333')
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(db.outlets.find((o) => o.code === 'GWA')).toMatchObject({ name: 'MUN Parfum Gowa', phone: '0811-222-333' })
    expect(await screen.findByText('MUN Parfum Gowa')).toBeInTheDocument()
  })

  it('ubah outlet & pindah outlet aktif', async () => {
    const { fake } = renderRoute('/outlet', USERS.owner)
    await screen.findAllByTestId('outlet-card')
    await user.click(screen.getByRole('button', { name: 'Ubah MUN Parfum Takalar' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ubah Outlet' })
    expect(within(dialog).getByLabelText('Kode')).toHaveValue('TKL')
    await user.clear(within(dialog).getByLabelText('Alamat'))
    await user.type(within(dialog).getByLabelText('Alamat'), 'Jl. Jend. Sudirman 10')
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fake.calls.writes.find((w) => w.table === 'outlets' && w.op === 'update')!.payload).toMatchObject({ address: 'Jl. Jend. Sudirman 10', code: 'TKL' })
    await user.click(screen.getByRole('button', { name: /Buka outlet ini/ }))
    const mks = screen.getAllByTestId('outlet-card').find((c) => c.textContent!.includes('Makassar'))!
    expect(mks).toHaveTextContent('Sedang dibuka')
  })

  it('kasir dan admin tidak dapat membuka halaman outlet', async () => {
    renderRoute('/outlet', USERS.admin)
    expect(await screen.findByText('Akses ditolak')).toBeInTheDocument()
  })
})

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderRoute } from '@/test/render'
import { createFakeSupabase, seedDb, USERS, type FakeDb, type FakeUser } from '@/test/fake-supabase'

const user = userEvent.setup()

/** Buat transaksi lewat RPC create_sale backend palsu (aturan hitung sama). */
async function seedSales(db: FakeDb) {
  const kasir = createFakeSupabase(USERS.kasir, db).client
  const admin = createFakeSupabase(USERS.admin, db).client
  const base = { p_outlet_id: 'o-tkl', p_discount_amount: '0' }
  await kasir.rpc('create_sale', { ...base, p_items: [{ product_id: 'p-1', quantity: '10', discount_amount: '0' }], p_payment_method: 'cash', p_amount_received: '50000', p_idempotency_key: 'k1' })
  await admin.rpc('create_sale', { ...base, p_items: [{ product_id: 'p-2', quantity: '5', discount_amount: '0' }], p_payment_method: 'qris', p_amount_received: null, p_idempotency_key: 'k2' })
}

async function open(u: FakeUser) {
  const db = seedDb()
  await seedSales(db)
  const r = renderRoute('/transaksi', u, db)
  await screen.findAllByTestId('tx-row')
  return r
}

describe('Riwayat transaksi', () => {
  it('owner melihat semua transaksi dan total omzet', async () => {
    await open(USERS.owner)
    const rows = screen.getAllByTestId('tx-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('AIGNER BLUE / BLUE EMO')
    expect(rows[0]).toHaveTextContent('QRIS')
    expect(rows[1]).toHaveTextContent('Kasir Satu')
    expect(screen.getByTestId('tx-omzet')).toHaveTextContent('Rp35.000')
  })

  it('kasir hanya melihat transaksinya; tidak ada tombol batal', async () => {
    await open(USERS.kasir)
    expect(screen.getAllByTestId('tx-row')).toHaveLength(1)
    expect(screen.getByText('Menampilkan transaksi Anda')).toBeInTheDocument()
    await user.click(screen.getByTestId('tx-row'))
    const dialog = await screen.findByRole('dialog', { name: 'MP-TKL-20261121-0001' })
    expect(await within(dialog).findByTestId('receipt')).toHaveTextContent('*** CETAK ULANG ***')
    expect(within(dialog).queryByRole('button', { name: /Batalkan/ })).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/Laba kotor/)).not.toBeInTheDocument()
  })

  it('cetak ulang struk memanggil print', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    await open(USERS.owner)
    await user.click(screen.getAllByTestId('tx-row')[1])
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByTestId('receipt')
    expect(within(dialog).getByText('Laba kotor Rp9.860')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /Cetak ulang struk/ }))
    expect(print).toHaveBeenCalledOnce()
    print.mockRestore()
  })

  it('pembatalan wajib alasan, mengembalikan stok, dan omzet berkurang', async () => {
    const { db, fake } = await open(USERS.owner)
    await user.click(screen.getAllByTestId('tx-row')[1])
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByTestId('receipt')
    await user.click(within(dialog).getByRole('button', { name: /^Batalkan$/ }))
    await user.click(within(dialog).getByRole('button', { name: /Batalkan transaksi/ }))
    expect(within(dialog).getByText('Alasan pembatalan wajib diisi')).toBeInTheDocument()
    expect(fake.calls.rpc.some((c) => c.fn === 'void_transaction')).toBe(false)
    await user.type(within(dialog).getByLabelText('Alasan pembatalan'), 'salah input jumlah')
    await user.click(within(dialog).getByRole('button', { name: /Batalkan transaksi/ }))
    expect(await within(dialog).findByText('Dibatalkan')).toBeInTheDocument()
    expect(within(dialog).getByText(/Alasan: salah input jumlah/)).toBeInTheDocument()
    expect(fake.calls.rpc.find((c) => c.fn === 'void_transaction')!.args).toEqual({ p_transaction_id: 't-1', p_reason: 'salah input jumlah' })
    expect(db.products.find((p) => p.id === 'p-1')!.current_stock).toBe(307)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.getByTestId('tx-omzet')).toHaveTextContent('Rp15.000'))
    expect(screen.getAllByTestId('tx-row')[1]).toHaveTextContent('Batal')
  })

  it('filter status dan pencarian dikirim ke server', async () => {
    const { fake } = await open(USERS.owner)
    await user.selectOptions(screen.getByLabelText('Filter metode'), 'qris')
    await waitFor(() => expect(screen.getAllByTestId('tx-row')).toHaveLength(1))
    await user.selectOptions(screen.getByLabelText('Filter metode'), '')
    await user.type(screen.getByLabelText('Cari transaksi'), 'valentine{Enter}')
    await waitFor(() => expect(screen.getAllByTestId('tx-row')).toHaveLength(1))
    const last = fake.calls.rpc.filter((c) => c.fn === 'get_transactions').slice(-1)[0]
    expect(last.args).toMatchObject({ p_search: 'valentine', p_method: null })
    expect(last.args.p_from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

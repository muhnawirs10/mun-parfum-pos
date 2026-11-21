import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderRoute } from '@/test/render'
import { createFakeSupabase, seedDb, USERS, type FakeDb, type FakeUser } from '@/test/fake-supabase'

const user = userEvent.setup()

async function seed(db: FakeDb) {
  const kasir = createFakeSupabase(USERS.kasir, db).client
  const base = { p_outlet_id: 'o-tkl', p_discount_amount: '0' }
  await kasir.rpc('create_sale', { ...base, p_items: [{ product_id: 'p-1', quantity: '10', discount_amount: '0' }], p_payment_method: 'cash', p_amount_received: '20000', p_idempotency_key: 'a' })
  await kasir.rpc('create_sale', { ...base, p_items: [{ product_id: 'p-2', quantity: '5', discount_amount: '0' }], p_payment_method: 'qris', p_amount_received: null, p_idempotency_key: 'b' })
  db.expenses.push({ id: 'e-1', outlet_id: 'o-tkl', expense_date: '2026-11-21', category: 'listrik', amount: 5000, description: 'Token', created_by: 'u-owner', created_at: '', deleted_at: null })
}

async function open(u: FakeUser = USERS.owner) {
  const db = seedDb()
  await seed(db)
  const r = renderRoute('/laporan', u, db)
  await screen.findByRole('heading', { name: 'Laporan' })
  return r
}

describe('Laporan', () => {
  it('owner: transaksi, penjualan, laba bersih (dengan pengeluaran), HPP, metode bayar, terlaris, laba terbesar', async () => {
    await open()
    expect(await screen.findByText('Rp35.000', { selector: 'p.text-2xl' })).toBeInTheDocument()
    // 9.860 + 8.940 = 18.800 laba kotor; − 5.000 = 13.800 laba bersih
    // kartu ringkasan + rincian sama-sama menampilkan laba bersih
    for (const el of screen.getAllByText('Laba bersih')) expect(el.parentElement).toHaveTextContent('Rp13.800')
    expect(screen.getByText('Total HPP').parentElement).toHaveTextContent('Rp16.200')
    expect(screen.getByText('Laba kotor', { selector: 'p.text-sm' }).parentElement).toHaveTextContent('Rp18.800')
    expect(screen.getByText('Kas masuk (tunai)').parentElement).toHaveTextContent('Rp20.000')
    expect(screen.getAllByTestId('method-row').map((r) => r.textContent)).toEqual(['Tunai · 1 trxRp20.000', 'QRIS · 1 trxRp15.000'])
    expect(screen.getAllByTestId('top-product')[0]).toHaveTextContent('VALENTINE / SCANDALOUS10 mlRp20.000')
    expect(screen.getAllByTestId('top-profit')[0]).toHaveTextContent('Rp9.860')

    // matikan pengeluaran → laba kotor ditampilkan sebagai profit
    await user.click(screen.getByRole('switch', { name: 'Masukkan pengeluaran' }))
    await waitFor(() => expect(screen.queryByText('Laba bersih')).not.toBeInTheDocument())
    const labels = screen.getAllByText('Laba kotor')
    expect(labels).toHaveLength(2) // kartu profit + rincian
    for (const el of labels) expect(el.parentElement).toHaveTextContent('Rp18.800')
  })

  it('periode: 7 hari, bulanan, dan rentang dikirim sebagai tanggal WITA', async () => {
    const { fake } = await open()
    await screen.findAllByTestId('method-row')
    const lastArgs = () => fake.calls.rpc.filter((c) => c.fn === 'get_sales_report').slice(-1)[0].args
    await user.click(screen.getByRole('tab', { name: '7 Hari' }))
    fireEvent.change(screen.getByLabelText('Tanggal laporan'), { target: { value: '2026-11-21' } })
    await waitFor(() => expect(lastArgs()).toMatchObject({ p_from: '2026-11-15', p_to: '2026-11-21', p_outlet_id: 'o-tkl' }))
    await user.click(screen.getByRole('tab', { name: 'Bulanan' }))
    fireEvent.change(screen.getByLabelText('Bulan laporan'), { target: { value: '2026-02' } })
    await waitFor(() => expect(lastArgs()).toMatchObject({ p_from: '2026-02-01', p_to: '2026-02-28' }))
    expect(screen.queryByRole('button', { name: /Cetak Laporan Closing/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Rentang' }))
    fireEvent.change(screen.getByLabelText('Dari tanggal'), { target: { value: '2026-11-10' } })
    fireEvent.change(screen.getByLabelText('Sampai tanggal'), { target: { value: '2026-11-20' } })
    await waitFor(() => expect(lastArgs()).toMatchObject({ p_from: '2026-11-10', p_to: '2026-11-20' }))
  })

  it('owner multi-outlet dapat membandingkan omzet semua outlet', async () => {
    const { fake } = await open()
    await screen.findAllByTestId('method-row')
    await user.selectOptions(screen.getByLabelText('Cakupan outlet'), 'all')
    const rows = await screen.findAllByTestId('outlet-row')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toHaveTextContent('TKL · MUN Parfum Takalar2 trxRp35.000laba Rp18.800')
    expect(fake.calls.rpc.filter((c) => c.fn === 'get_sales_report').slice(-1)[0].args.p_outlet_id).toBeNull()
  })

  it('admin (tanpa profit.view): tidak ada HPP/laba/sakelar pengeluaran', async () => {
    await open(USERS.admin)
    await screen.findAllByTestId('method-row')
    expect(screen.queryByText('Total HPP')).not.toBeInTheDocument()
    expect(screen.queryByText(/Laba/)).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Masukkan pengeluaran' })).not.toBeInTheDocument()
  })

  it('export PDF & Excel dan cetak closing harian mengunduh file', async () => {
    const created: Blob[] = []
    const createUrl = vi.fn((b: Blob) => (created.push(b), 'blob:x'))
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { fake } = await open()
    await screen.findAllByTestId('method-row')
    await user.click(screen.getByRole('button', { name: /Excel/ }))
    await screen.findByText('File laporan dibuat')
    await user.click(screen.getByRole('button', { name: /^PDF$/ }))
    await waitFor(() => expect(created).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: /Cetak Laporan Closing/ }))
    await waitFor(() => expect(created).toHaveLength(3))
    const names = click.mock.contexts.map((a) => (a as HTMLAnchorElement).download)
    expect(names[0]).toMatch(/^laporan_TKL_\d{4}-\d{2}-\d{2}\.xlsx$/)
    expect(names[1]).toMatch(/^laporan_TKL_.+\.pdf$/)
    expect(names[2]).toMatch(/^closing_TKL_.+\.pdf$/)
    const head = new TextDecoder('latin1').decode(new Uint8Array(await created[2].arrayBuffer()))
    expect(head.startsWith('%PDF-')).toBe(true)
    expect(head).toContain('Laporan Closing Harian')
    expect(head).toContain('Pengeluaran per kategori')
    expect(fake.calls.rpc.some((c) => c.fn === 'get_cash_sessions')).toBe(true)
    click.mockRestore()
  })

  it('closing tidak bisa dicetak tanpa transaksi', async () => {
    renderRoute('/laporan', USERS.owner)
    expect(await screen.findByText('* Belum ada transaksi penjualan pada tanggal terpilih')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cetak Laporan Closing/ })).toBeDisabled()
  })

  it('kasir tanpa izin laporan diblokir; kasir dengan closing.perform hanya melihat sesi kas', async () => {
    renderRoute('/laporan', USERS.kasir)
    expect(await screen.findByText('Akses ditolak')).toBeInTheDocument()
    const kasirClosing: FakeUser = { ...USERS.kasir, access: [{ ...USERS.kasir.access[0], permissions: ['pos.sell', 'closing.perform'] }] }
    renderRoute('/laporan', kasirClosing)
    expect(await screen.findByText('Sesi Kas Saya')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Harian' })).not.toBeInTheDocument()
  })
})

describe('Sesi kas (buka & closing)', () => {
  it('buka kas → penjualan tunai → closing menampilkan selisih', async () => {
    const db = seedDb()
    const { fake } = renderRoute('/laporan', USERS.admin, db)
    const card = await screen.findByTestId('cash-session')
    await within(card).findByText(/Kas belum dibuka/)
    await user.type(within(card).getByLabelText('Kas awal (Rp)'), '100.000')
    await user.click(within(card).getByRole('button', { name: /Buka kas/ }))
    await within(card).findByText('Kas seharusnya di laci')
    expect(fake.calls.rpc.find((c) => c.fn === 'open_cash_session')!.args).toEqual({ p_outlet_id: 'o-tkl', p_opening_cash: '100000' })

    // penjualan tunai Rp20.000 oleh admin di sesi ini (lewat backend, seperti dari perangkat kasir)
    await createFakeSupabase(USERS.admin, db).client.rpc('create_sale', { p_outlet_id: 'o-tkl', p_discount_amount: '0', p_items: [{ product_id: 'p-1', quantity: '10', discount_amount: '0' }], p_payment_method: 'cash', p_amount_received: '50000', p_idempotency_key: 'z' })

    await user.type(within(card).getByLabelText('Kas fisik hasil hitung (Rp)'), '119.000')
    await user.click(within(card).getByRole('button', { name: /Tutup kas/ }))
    const result = await within(card).findByTestId('closing-result')
    expect(result).toHaveTextContent('Kas seharusnyaRp120.000')
    expect(result).toHaveTextContent('Kas fisikRp119.000')
    expect(result).toHaveTextContent('Selisih-Rp1.000')
  })
})

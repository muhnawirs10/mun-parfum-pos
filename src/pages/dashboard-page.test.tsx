import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderRoute } from '@/test/render'
import { seedDb, USERS } from '@/test/fake-supabase'

const OWNER_DASH = {
  business_date: '2026-11-21',
  scope: 'outlet',
  transaction_count: 3,
  omzet: 95000,
  gross_profit: 46400,
  expenses_total: 7500,
  expenses_count: 1,
  product_count: 20,
  low_stock: [{ id: 'p-3', name: 'SELENA GOMES', sku: 'TKL-0003', unit: 'ML', current_stock: 48.5, min_stock: 50 }],
  recent_transactions: [
    { id: 't1', number: 'MP-TKL-20261121-0003', total: 14000, status: 'completed', payment_method: 'cash', created_at: '2026-11-21T15:17:00Z', items: 'VANILA COFFE' },
    { id: 't2', number: 'MP-TKL-20261121-0002', total: 30000, status: 'void', payment_method: 'qris', created_at: '2026-11-21T15:11:00Z', items: 'VALENTINE / SCANDALOUS' },
  ],
}

describe('Beranda', () => {
  it('owner: omzet, laba, pengeluaran, stok menipis, transaksi terakhir', async () => {
    const db = seedDb()
    db.dashboard = OWNER_DASH
    const { fake } = renderRoute('/', USERS.owner, db)
    expect(await screen.findByText('Rp95.000')).toBeInTheDocument()
    expect(fake.calls.rpc).toContainEqual({ fn: 'get_dashboard', args: { p_outlet_id: 'o-tkl' } })
    expect(screen.getByText('Transaksi Hari Ini').closest('div')!.parentElement).toHaveTextContent('3')
    expect(screen.getByText('Rp46.400')).toBeInTheDocument()
    expect(screen.getByText('Rp7.500')).toBeInTheDocument()
    expect(screen.getByText('1 catatan')).toBeInTheDocument()
    expect(screen.getByText('SELENA GOMES')).toBeInTheDocument()
    expect(screen.getByText('48,5 ml')).toBeInTheDocument()
    const recent = screen.getByText('VANILA COFFE').closest('li')!
    expect(within(recent).getByText('Rp14.000')).toBeInTheDocument()
    expect(within(recent).getByText('23:17')).toBeInTheDocument() // WITA
    expect(within(recent).getByText('Tunai')).toBeInTheDocument()
    expect(within(screen.getByText('VALENTINE / SCANDALOUS').closest('li')!).getByText('Batal')).toBeInTheDocument()
    expect(screen.getByText(/Nawir!/)).toBeInTheDocument()
  })

  it('kasir: hanya transaksi sendiri, tanpa laba, pengeluaran, atau stok menipis', async () => {
    const db = seedDb()
    db.dashboard = { ...OWNER_DASH, scope: 'own', gross_profit: null, expenses_total: null, expenses_count: null, low_stock: null, omzet: 14000 }
    renderRoute('/', USERS.kasir, db)
    expect(await screen.findByText('Penjualan Saya Hari Ini')).toBeInTheDocument()
    const card = screen.getByText('Penjualan Saya Hari Ini').closest('div')!
    expect(card).toHaveTextContent('Rp14.000')
    expect(screen.queryByText('Laba Kotor Hari Ini')).not.toBeInTheDocument()
    expect(screen.queryByText('Pengeluaran Hari Ini')).not.toBeInTheDocument()
    expect(screen.queryByText('Stok Menipis')).not.toBeInTheDocument()
    expect(screen.queryByText('Kelola Produk')).not.toBeInTheDocument()
  })

  it('gagal memuat: pesan dan tombol coba lagi', async () => {
    const { fake } = renderRoute('/', USERS.owner)
    expect(await screen.findByText(/Gagal memuat ringkasan/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Coba lagi/ }))
    expect(fake.calls.rpc.filter((c) => c.fn === 'get_dashboard').length).toBeGreaterThanOrEqual(2)
  })
})

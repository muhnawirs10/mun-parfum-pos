import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderRoute } from '@/test/render'
import { USERS } from '@/test/fake-supabase'
import { cartStore } from './cart-store'

const user = userEvent.setup()

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })
  window.dispatchEvent(new Event(value ? 'online' : 'offline'))
}

async function openPos(u = USERS.kasir) {
  cartStore.clear('o-tkl')
  const r = renderRoute('/kasir', u)
  await screen.findByRole('button', { name: 'Pilih VALENTINE / SCANDALOUS' })
  return r
}

async function addMl(name: string, qty: string, discount?: string) {
  await user.click(screen.getByRole('button', { name: `Pilih ${name}` }))
  const dialog = await screen.findByRole('dialog', { name: name })
  await user.clear(within(dialog).getByLabelText(/Jumlah/))
  await user.type(within(dialog).getByLabelText(/Jumlah/), qty)
  if (discount) await user.type(within(dialog).getByLabelText(/Diskon item/), discount)
  await user.click(within(dialog).getByRole('button', { name: /Tambah ke keranjang/ }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name })).not.toBeInTheDocument())
}

async function pay(method: 'Tunai' | 'QRIS', received?: string) {
  await user.click(screen.getByRole('button', { name: /^Bayar Rp/ }))
  const dialog = await screen.findByRole('dialog', { name: 'Pembayaran' })
  await user.click(within(dialog).getByRole('radio', { name: method }))
  if (received) await user.type(within(dialog).getByLabelText('Uang diterima'), received)
  return dialog
}

describe('Kasir', () => {
  afterEach(() => act(() => setOnline(true)))

  it('penjualan 10 ml VALENTINE tunai: total Rp20.000, kembalian Rp30.000, stok 297 ml, struk tampil', async () => {
    const { fake, db } = await openPos()
    await addMl('VALENTINE / SCANDALOUS', '10')
    expect(screen.getByTestId('cart-total')).toHaveTextContent('Rp20.000')

    const dialog = await pay('Tunai', '50.000')
    expect(within(dialog).getByTestId('pay-total')).toHaveTextContent('Rp20.000')
    expect(within(dialog).getByTestId('change')).toHaveTextContent('Rp30.000')
    await user.click(within(dialog).getByRole('button', { name: 'Bayar Rp20.000' }))

    const success = await screen.findByRole('dialog', { name: 'Transaksi berhasil' })
    expect(await within(success).findByTestId('receipt')).toHaveTextContent('MP-TKL-20261121-0001')
    expect(within(success).getByTestId('success-change')).toHaveTextContent('Kembalian Rp30.000')
    const receipt = within(success).getByTestId('receipt')
    expect(receipt).toHaveTextContent('10 ml x Rp2.000')
    expect(receipt).toHaveTextContent('TOTALRp20.000')
    expect(receipt).toHaveTextContent('KembaliRp30.000')
    expect(receipt).toHaveTextContent('Kasir: Kasir Satu')

    const call = fake.calls.rpc.find((c) => c.fn === 'create_sale')!
    expect(call.args).toMatchObject({
      p_outlet_id: 'o-tkl',
      p_items: [{ product_id: 'p-1', quantity: '10', discount_amount: '0' }],
      p_payment_method: 'cash',
      p_amount_received: '50000',
      p_discount_amount: '0',
    })
    expect(call.args.p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/)
    expect(db.products.find((p) => p.id === 'p-1')!.current_stock).toBe(297)
    expect(db.transactions[0]).toMatchObject({ total: 20000, cost_total: 10140, gross_profit: 9860 })

    // keranjang dikosongkan setelah sukses
    await user.click(within(success).getByRole('button', { name: /Transaksi baru/ }))
    expect(screen.queryByTestId('cart-line')).not.toBeInTheDocument()
  })

  it('penjualan 5 ml QRIS: tanpa input uang, dibayar pas', async () => {
    const { fake } = await openPos()
    await addMl('VALENTINE / SCANDALOUS', '5')
    const dialog = await pay('QRIS')
    expect(within(dialog).queryByLabelText('Uang diterima')).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/referensi/), 'QR-8812')
    await user.click(within(dialog).getByRole('button', { name: 'Bayar Rp10.000' }))
    await screen.findByRole('dialog', { name: 'Transaksi berhasil' })
    expect(fake.calls.rpc.find((c) => c.fn === 'create_sale')!.args).toMatchObject({
      p_payment_method: 'qris',
      p_amount_received: null,
      p_payment_reference: 'QR-8812',
    })
    expect(await screen.findByTestId('receipt')).toHaveTextContent('Ref: QR-8812')
    // salinan khusus cetak dirender langsung di <body>, di luar dialog
    const printCopy = screen.getByTestId('receipt-print')
    expect(printCopy.closest('.print-root')!.parentElement).toBe(document.body)
    expect(printCopy).toHaveTextContent('Ref: QR-8812')
  })

  it('diskon item dan diskon transaksi; uang kurang ditolak sebelum dikirim', async () => {
    const { fake } = await openPos()
    await addMl('VALENTINE / SCANDALOUS', '10', '1.000')
    await user.type(screen.getByLabelText('Diskon transaksi'), '2.000{Enter}')
    await waitFor(() => expect(screen.getByTestId('cart-total')).toHaveTextContent('Rp17.000'))
    const dialog = await pay('Tunai', '15.000')
    await user.click(within(dialog).getByRole('button', { name: 'Bayar Rp17.000' }))
    expect(within(dialog).getByText('Uang diterima kurang dari total belanja')).toBeInTheDocument()
    expect(fake.calls.rpc.some((c) => c.fn === 'create_sale')).toBe(false)
    await user.click(within(dialog).getByRole('button', { name: 'Uang pas' }))
    expect(within(dialog).getByTestId('change')).toHaveTextContent('Rp0')
    await user.click(within(dialog).getByRole('button', { name: 'Bayar Rp17.000' }))
    await screen.findByRole('dialog', { name: 'Transaksi berhasil' })
    expect(fake.calls.rpc.find((c) => c.fn === 'create_sale')!.args).toMatchObject({
      p_items: [{ product_id: 'p-1', quantity: '10', discount_amount: '1000' }],
      p_discount_amount: '2000',
      p_amount_received: '17000',
    })
  })

  it('volume desimal, tombol +/− , dan produk PCS langsung ditambahkan', async () => {
    await openPos()
    await addMl('SELENA GOMES', '2,5')
    expect(screen.getByTestId('cart-total')).toHaveTextContent('Rp5.000')
    await user.click(screen.getByRole('button', { name: 'Tambah SELENA GOMES' }))
    expect(screen.getByTestId('cart-line')).toHaveTextContent('3,5 ml')
    await user.click(screen.getByRole('button', { name: 'Kurangi SELENA GOMES' }))
    await user.click(screen.getByRole('button', { name: 'Kurangi SELENA GOMES' }))
    expect(screen.getByTestId('cart-line')).toHaveTextContent('1,5 ml')
    // stok BOTOL 0 → ditolak dengan pesan
    await user.click(screen.getByRole('button', { name: 'Pilih BOTOL SPRAY 30ML' }))
    expect(await screen.findByText('Stok BOTOL SPRAY 30ML habis')).toBeInTheDocument()
    expect(screen.getAllByTestId('cart-line')).toHaveLength(1)
  })

  it('jumlah melebihi stok ditolak di dialog; penolakan stok dari server ditampilkan dan keranjang tetap', async () => {
    const { db } = await openPos()
    await user.click(screen.getByRole('button', { name: 'Pilih SELENA GOMES' }))
    const dialog = await screen.findByRole('dialog', { name: 'SELENA GOMES' })
    await user.type(within(dialog).getByLabelText(/Jumlah/), '50')
    await user.click(within(dialog).getByRole('button', { name: /Tambah ke keranjang/ }))
    expect(within(dialog).getByText('Stok tidak cukup. Tersedia 48,5 ml')).toBeInTheDocument()
    await user.keyboard('{Escape}')

    await addMl('VALENTINE / SCANDALOUS', '10')
    db.products.find((p) => p.id === 'p-1')!.current_stock = 5 // stok berubah di perangkat lain
    const pd = await pay('QRIS')
    await user.click(within(pd).getByRole('button', { name: 'Bayar Rp20.000' }))
    expect(await within(pd).findByRole('alert')).toHaveTextContent('Stok VALENTINE / SCANDALOUS tidak cukup')
    expect(db.transactions).toHaveLength(0)
    await user.keyboard('{Escape}')
    expect(screen.getAllByTestId('cart-line')).toHaveLength(1)
  })

  it('koneksi putus setelah server menyimpan: "Coba lagi" memakai kunci sama → satu transaksi', async () => {
    const { fake, db } = await openPos()
    await addMl('VALENTINE / SCANDALOUS', '10')
    db.dropResponseOnce.create_sale = true
    const dialog = await pay('QRIS')
    await user.click(within(dialog).getByRole('button', { name: 'Bayar Rp20.000' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('BELUM dipastikan tersimpan')
    // keranjang TIDAK dikosongkan dan tidak ada klaim sukses
    expect(screen.queryByRole('dialog', { name: 'Transaksi berhasil' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Coba lagi' }))
    await screen.findByRole('dialog', { name: 'Transaksi berhasil' })
    const keys = fake.calls.rpc.filter((c) => c.fn === 'create_sale').map((c) => c.args.p_idempotency_key)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
    expect(db.transactions).toHaveLength(1)
    expect(db.products.find((p) => p.id === 'p-1')!.current_stock).toBe(297)
  })

  it('offline: tombol bayar nonaktif, tidak ada transaksi dikirim', async () => {
    const { fake } = await openPos()
    await addMl('VALENTINE / SCANDALOUS', '10')
    act(() => setOnline(false))
    expect(screen.getByRole('button', { name: /^Bayar Rp/ })).toBeDisabled()
    expect(screen.getByText(/Offline — pembayaran dinonaktifkan/)).toBeInTheDocument()
    act(() => setOnline(true))
    const dialog = await pay('QRIS')
    act(() => setOnline(false))
    expect(within(dialog).getByRole('button', { name: 'Bayar Rp20.000' })).toBeDisabled()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Offline')
    expect(fake.calls.rpc.some((c) => c.fn === 'create_sale')).toBe(false)
  })

  it('pencarian dan filter kategori katalog', async () => {
    await openPos()
    await user.type(screen.getByLabelText('Cari produk kasir'), 'aigner')
    expect(screen.getAllByRole('button', { name: /^Pilih / })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Hapus pencarian' }))
    await user.click(screen.getByRole('button', { name: 'PARFUM' }))
    expect(screen.queryByRole('button', { name: 'Pilih BOTOL SPRAY 30ML' })).not.toBeInTheDocument()
  })
})

describe('Kas di halaman Kasir', () => {
  it('kasir membuka kas dari halaman kasir; transaksi tercatat dalam sesi', async () => {
    const { fake, db } = await openPos()
    await user.click(screen.getByRole('button', { name: /Buka kas/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Kas' })
    await user.type(within(dialog).getByLabelText('Kas awal (Rp)'), '50.000')
    await user.click(within(dialog).getByRole('button', { name: /Buka kas/ }))
    expect(await within(dialog).findByText('Kas seharusnya di laci')).toBeInTheDocument()
    expect(within(dialog).getByText('Closing kas dilakukan oleh admin/pemilik.')).toBeInTheDocument()
    expect(fake.calls.rpc.find((c) => c.fn === 'open_cash_session')!.args.p_opening_cash).toBe('50000')
    await user.keyboard('{Escape}')
    expect(await screen.findByRole('button', { name: /Kas dibuka/ })).toBeInTheDocument()

    await addMl('VALENTINE / SCANDALOUS', '10')
    const pd = await pay('Tunai', '20.000')
    await user.click(within(pd).getByRole('button', { name: 'Bayar Rp20.000' }))
    await screen.findByRole('dialog', { name: 'Transaksi berhasil' })
    expect(db.transactions[0].cash_session_id).toBe(db.cashSessions[0].id)
  })
})

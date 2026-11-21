import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderRoute } from '@/test/render'
import { USERS } from '@/test/fake-supabase'

const user = userEvent.setup()

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })
  window.dispatchEvent(new Event(value ? 'online' : 'offline'))
}

async function openStock(path = '/stok', u = USERS.owner) {
  const r = renderRoute(path, u)
  await screen.findByRole('tab', { name: /Daftar Stok/ })
  return r
}

describe('Halaman Stok', () => {
  afterEach(() => act(() => setOnline(true)))

  it('ringkasan persediaan dan daftar stok dengan filter', async () => {
    await openStock()
    await screen.findAllByTestId('stock-row')
    expect(screen.getByText('Produk aktif').parentElement).toHaveTextContent('4')
    expect(screen.getByText('Stok menipis').parentElement).toHaveTextContent('1')
    expect(screen.getByText('Stok habis').parentElement).toHaveTextContent('1')
    // 307×1014 + 231×1212 + 48,5×1000 = 311.298 + 279.972 + 48.500 = 639.770
    expect(screen.getByText('Nilai persediaan (HPP)').parentElement).toHaveTextContent('Rp639.770')
    expect(screen.getAllByTestId('stock-row')).toHaveLength(4)
    await user.selectOptions(screen.getByLabelText('Filter level stok'), 'low')
    expect(screen.getAllByTestId('stock-row')).toHaveLength(2)
    await user.selectOptions(screen.getByLabelText('Filter level stok'), 'empty')
    expect(screen.getAllByTestId('stock-row')).toHaveLength(1)
    expect(screen.getByText('BOTOL SPRAY 30ML')).toBeInTheDocument()
  })

  it('stok masuk 100,5 ml: pratinjau 307 → 407,5 ml, tersimpan dengan idempotency key, stok diperbarui', async () => {
    const { fake, db } = await openStock()
    await screen.findAllByTestId('stock-row')
    await user.click(screen.getByRole('button', { name: 'Stok masuk VALENTINE / SCANDALOUS' }))
    const dialog = await screen.findByRole('dialog', { name: 'Penyesuaian Stok' })
    expect(within(dialog).getByRole('radio', { name: /Masuk/ })).toHaveAttribute('aria-checked', 'true')
    await user.type(within(dialog).getByLabelText(/Jumlah/), '100,5')
    expect(within(dialog).getByTestId('stock-after')).toHaveTextContent('407,5 ml')
    await user.click(within(dialog).getByRole('button', { name: 'Restock supplier' }))
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const call = fake.calls.rpc.find((c) => c.fn === 'adjust_stock')!
    expect(call.args).toMatchObject({ p_product_id: 'p-1', p_type: 'stock_in', p_quantity: '100.5', p_reason: 'Restock supplier' })
    expect(call.args.p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/)
    expect(db.products.find((p) => p.id === 'p-1')!.current_stock).toBe(407.5)
    const row = (await screen.findByText('VALENTINE / SCANDALOUS')).closest('[data-testid="stock-row"]') as HTMLElement
    await waitFor(() => expect(within(row).getByText('Stok: 407,5 ml')).toBeInTheDocument())
    expect(await screen.findByText(/Stok masuk tersimpan/)).toBeInTheDocument()
  })

  it('stok keluar wajib alasan dan menampilkan penolakan stok tidak cukup dari server', async () => {
    const { fake } = await openStock()
    await screen.findAllByTestId('stock-row')
    await user.click(screen.getByRole('button', { name: 'Stok keluar SELENA GOMES' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Jumlah/), '50')
    expect(within(dialog).getByTestId('stock-after')).toHaveTextContent('-1,5 ml')
    expect(within(dialog).getByText(/Stok akan minus/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    expect(within(dialog).getByText('Alasan wajib diisi untuk stok keluar / opname')).toBeInTheDocument()
    expect(fake.calls.rpc.some((c) => c.fn === 'adjust_stock')).toBe(false)

    await user.type(within(dialog).getByLabelText('Alasan'), 'Tumpah')
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('tidak cukup')
  })

  it('kirim ulang setelah error memakai idempotency key yang sama (tidak menggandakan stok)', async () => {
    const { fake, db } = await openStock()
    await screen.findAllByTestId('stock-row')
    db.failRpc.adjust_stock = { message: 'Failed to fetch' }
    await user.click(screen.getByRole('button', { name: 'Stok masuk AIGNER BLUE / BLUE EMO' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Jumlah/), '10')
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Tidak dapat terhubung ke server')
    delete db.failRpc.adjust_stock
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const keys = fake.calls.rpc.filter((c) => c.fn === 'adjust_stock').map((c) => c.args.p_idempotency_key)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
    expect(db.products.find((p) => p.id === 'p-2')!.current_stock).toBe(241)
  })

  it('opname: menyetel stok ke hasil hitung fisik; PCS menolak desimal', async () => {
    const { fake } = await openStock()
    await screen.findAllByTestId('stock-row')
    await user.click(screen.getByRole('button', { name: 'Opname' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: /Opname/ })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    expect(within(dialog).getByText('Pilih produk')).toBeInTheDocument()
    await user.selectOptions(within(dialog).getByLabelText('Produk'), 'p-4')
    await user.type(within(dialog).getByLabelText(/Stok fisik/), '2,5')
    await user.click(within(dialog).getByRole('button', { name: 'Opname rutin' }))
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    expect(within(dialog).getByText('Satuan PCS harus bilangan bulat')).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText(/Stok fisik/))
    await user.type(within(dialog).getByLabelText(/Stok fisik/), '12')
    expect(within(dialog).getByTestId('stock-after')).toHaveTextContent('12 pcs')
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fake.calls.rpc.find((c) => c.fn === 'adjust_stock')!.args).toMatchObject({ p_type: 'adjustment', p_quantity: '12', p_reason: 'Opname rutin' })
  })

  it('offline: stok tidak dikirim', async () => {
    const { fake } = await openStock()
    await screen.findAllByTestId('stock-row')
    await user.click(screen.getByRole('button', { name: 'Stok masuk VALENTINE / SCANDALOUS' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Jumlah/), '5')
    act(() => setOnline(false))
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Tidak ada koneksi internet')
    expect(fake.calls.rpc.some((c) => c.fn === 'adjust_stock')).toBe(false)
  })

  it('riwayat pergerakan: urutan terbaru, jumlah bertanda, pengguna, nomor transaksi, dan filter', async () => {
    const { fake } = await openStock()
    await user.click(screen.getByRole('tab', { name: /Riwayat/ }))
    const rows = await screen.findAllByTestId('movement-row')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Penjualan')
    expect(rows[0]).toHaveTextContent('−10 ml')
    expect(rows[0]).toHaveTextContent('317 → 307 ml')
    expect(rows[0]).toHaveTextContent('Kasir Satu')
    expect(rows[0]).toHaveTextContent('MP-TKL-20261121-0001')
    expect(rows[0]).toHaveTextContent('21 Nov 2026, 23:11') // WITA
    expect(rows[2]).toHaveTextContent('+307 ml')

    await user.selectOptions(screen.getByLabelText('Filter jenis pergerakan'), 'stock_out')
    await waitFor(() => expect(screen.getAllByTestId('movement-row')).toHaveLength(1))
    expect(screen.getByTestId('movement-row')).toHaveTextContent('Botol pecah / tumpah')
    expect(fake.calls.rpc.filter((c) => c.fn === 'get_stock_movements').slice(-1)[0].args).toMatchObject({ p_types: ['stock_out'] })
  })

  it('tautan riwayat dari halaman Produk membuka riwayat produk tsb', async () => {
    const { fake } = await openStock('/stok?produk=p-3')
    await screen.findAllByTestId('movement-row')
    expect(screen.getByRole('tab', { name: /Riwayat/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByTestId('movement-row')).toHaveLength(1)
    expect(fake.calls.rpc.find((c) => c.fn === 'get_stock_movements')!.args.p_product_id).toBe('p-3')
  })

  it('kasir tidak dapat membuka halaman stok', async () => {
    renderRoute('/stok', USERS.kasir)
    expect(await screen.findByText('Akses ditolak')).toBeInTheDocument()
  })
})

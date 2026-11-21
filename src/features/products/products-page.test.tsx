import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderRoute } from '@/test/render'
import { USERS, type FakeUser } from '@/test/fake-supabase'

const ADMIN_NO_COST: FakeUser = {
  ...USERS.admin,
  access: [{ ...USERS.admin.access[0], permissions: USERS.admin.access[0].permissions.filter((p) => p !== 'cost.view') }],
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })
  window.dispatchEvent(new Event(value ? 'online' : 'offline'))
}

async function openList(user: FakeUser = USERS.owner) {
  const r = renderRoute('/produk', user)
  await screen.findByText('VALENTINE / SCANDALOUS')
  return r
}

const user = userEvent.setup()

describe('Halaman Produk', () => {
  afterEach(() => act(() => setOnline(true)))

  it('menampilkan produk aktif outlet aktif saja, lengkap dengan SKU, harga, HPP, dan stok', async () => {
    await openList()
    expect(screen.getByText('4 produk ditemukan')).toBeInTheDocument()
    expect(screen.queryByText('PRODUK MAKASSAR')).not.toBeInTheDocument()
    expect(screen.queryByText('PRODUK LAMA')).not.toBeInTheDocument()
    const card = screen.getByText('VALENTINE / SCANDALOUS').closest('li')!
    expect(within(card).getByText('SKU: TKL-0001')).toBeInTheDocument()
    expect(within(card).getByText('Rp2.000')).toBeInTheDocument()
    expect(within(card).getByText('HPP: Rp1.014')).toBeInTheDocument()
    expect(within(card).getByText('Stok: 307 ml')).toBeInTheDocument()
    expect(within(card).getByText('PARFUM')).toBeInTheDocument()
  })

  it('pencarian nama/SKU dan filter stok menipis', async () => {
    await openList()
    await user.type(screen.getByLabelText('Cari produk'), 'aigner')
    expect(screen.getByText('1 produk ditemukan')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Cari produk'))
    await user.type(screen.getByLabelText('Cari produk'), 'tkl-0003')
    expect(screen.getByText('SELENA GOMES')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Cari produk'))

    await user.selectOptions(screen.getByLabelText('Filter status'), 'low')
    expect(screen.getByText('2 produk ditemukan')).toBeInTheDocument()
    expect(screen.getByText('Menipis · Stok: 48,5 ml')).toBeInTheDocument()
    expect(screen.getByText('Habis · Stok: 0 pcs')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Filter status'), 'inactive')
    expect(screen.getByText('PRODUK LAMA')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Filter status'), 'all')
    await user.selectOptions(screen.getByLabelText('Filter kategori'), 'none')
    expect(screen.getByText('1 produk ditemukan')).toBeInTheDocument()
    expect(screen.getByText('BOTOL SPRAY 30ML')).toBeInTheDocument()
  })

  it('tambah produk: validasi, angka format Indonesia, SKU otomatis, daftar diperbarui', async () => {
    const { fake } = await openList()
    await user.click(screen.getByRole('button', { name: /Tambah/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Tambah Produk' })
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    expect(within(dialog).getByText('Nama produk wajib diisi')).toBeInTheDocument()
    expect(within(dialog).getByText('Harga jual wajib diisi')).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByLabelText('Nama produk')).toHaveFocus())
    expect(fake.calls.rpc.filter((c) => c.fn === 'create_product')).toHaveLength(0)

    await user.type(within(dialog).getByLabelText('Nama produk'), 'DIOR SAUVAGE')
    await user.selectOptions(within(dialog).getByLabelText('Kategori'), 'c-parfum')
    await user.type(within(dialog).getByLabelText(/Harga jual/), '2.000')
    await user.type(within(dialog).getByLabelText(/HPP/), '1.014')
    await user.type(within(dialog).getByLabelText(/Stok awal/), '148,5')
    await user.type(within(dialog).getByLabelText(/Stok minimum/), '50')
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const call = fake.calls.rpc.find((c) => c.fn === 'create_product')!
    expect(call.args).toMatchObject({
      p_outlet_id: 'o-tkl',
      p_name: 'DIOR SAUVAGE',
      p_unit: 'ML',
      p_sell_price: '2000',
      p_cost_price: '1014',
      p_initial_stock: '148.5',
      p_min_stock: '50',
      p_category_id: 'c-parfum',
      p_sku: null,
    })
    expect(await screen.findByText('DIOR SAUVAGE')).toBeInTheDocument()
    expect(await screen.findByText(/Produk ditambahkan \(SKU TKL-0101\)/)).toBeInTheDocument()
  })

  it('satuan PCS menolak stok desimal; error server ditampilkan', async () => {
    const { fake } = await openList()
    await user.click(screen.getByRole('button', { name: /Tambah/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Nama produk'), 'BOTOL')
    await user.selectOptions(within(dialog).getByLabelText('Satuan stok'), 'PCS')
    await user.type(within(dialog).getByLabelText(/Harga jual/), '5000')
    await user.type(within(dialog).getByLabelText(/HPP/), '2500')
    await user.type(within(dialog).getByLabelText(/Stok awal/), '1,5')
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    expect(within(dialog).getByText('Satuan PCS harus bilangan bulat')).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText(/Stok awal/))
    await user.type(within(dialog).getByLabelText(/Stok awal/), '10')
    await user.type(within(dialog).getByLabelText('SKU'), 'TKL-0001')
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('SKU TKL-0001 sudah dipakai')
    expect(fake.calls.rpc.filter((c) => c.fn === 'create_product')).toHaveLength(1)
  })

  it('offline: produk tidak dikirim ke server', async () => {
    const { fake } = await openList()
    await user.click(screen.getByRole('button', { name: /Tambah/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Nama produk'), 'X')
    await user.type(within(dialog).getByLabelText(/Harga jual/), '1000')
    await user.type(within(dialog).getByLabelText(/HPP/), '500')
    act(() => setOnline(false))
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Tidak ada koneksi internet')
    expect(fake.calls.rpc.filter((c) => c.fn === 'create_product')).toHaveLength(0)
  })

  it('edit produk: nilai terisi, stok tidak dapat diubah dari form, bisa dinonaktifkan', async () => {
    const { fake } = await openList()
    await user.click(screen.getByRole('button', { name: 'Edit VALENTINE / SCANDALOUS' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Produk' })
    expect(within(dialog).getByLabelText(/Harga jual/)).toHaveValue('2.000')
    expect(within(dialog).getByLabelText(/HPP/)).toHaveValue('1.014')
    expect(within(dialog).queryByLabelText(/Stok awal/)).not.toBeInTheDocument()
    expect(within(dialog).getByText('307 ml')).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText(/Harga jual/))
    await user.type(within(dialog).getByLabelText(/Harga jual/), '2.500')
    await user.click(within(dialog).getByRole('switch', { name: 'Produk aktif' }))
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fake.calls.rpc.find((c) => c.fn === 'update_product')!.args).toMatchObject({
      p_product_id: 'p-1',
      p_sell_price: '2500',
      p_cost_price: '1014',
      p_is_active: false,
      p_sku: 'TKL-0001',
    })
    await waitFor(() => expect(screen.queryByText('VALENTINE / SCANDALOUS')).not.toBeInTheDocument())
  })

  it('tombol nonaktifkan memanggil set_product_active (bukan hapus)', async () => {
    const { fake } = await openList()
    await user.click(screen.getByRole('button', { name: 'Nonaktifkan AIGNER BLUE / BLUE EMO' }))
    await waitFor(() => expect(screen.queryByText('AIGNER BLUE / BLUE EMO')).not.toBeInTheDocument())
    expect(fake.calls.rpc.find((c) => c.fn === 'set_product_active')!.args).toEqual({ p_product_id: 'p-2', p_is_active: false })
    await user.selectOptions(screen.getByLabelText('Filter status'), 'inactive')
    await user.click(screen.getByRole('button', { name: 'Aktifkan AIGNER BLUE / BLUE EMO' }))
    await waitFor(() => expect(fake.calls.rpc.filter((c) => c.fn === 'set_product_active')).toHaveLength(2))
  })

  it('tanpa izin cost.view: HPP tidak dimuat, tidak tampil, dan tidak dikirim', async () => {
    const { fake } = await openList(ADMIN_NO_COST)
    expect(screen.queryByText(/HPP:/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit VALENTINE / SCANDALOUS' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByLabelText(/HPP/)).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    await waitFor(() => expect(fake.calls.rpc.some((c) => c.fn === 'update_product')).toBe(true))
    expect(fake.calls.rpc.find((c) => c.fn === 'update_product')!.args.p_cost_price).toBeNull()
  })

  it('unggah foto: tersimpan di folder outlet; file terlalu besar ditolak', async () => {
    const { db } = await openList()
    await user.click(screen.getByRole('button', { name: /Tambah/ }))
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByLabelText('Unggah foto produk')
    await user.upload(input, new File(['x'], 'foto.png', { type: 'image/png' }))
    expect(await within(dialog).findByAltText('Foto produk')).toHaveAttribute('src', expect.stringMatching(/^https:\/\/cdn\.test\/o-tkl\/.+\.png$/))
    expect(db.uploads[0]).toMatch(/^o-tkl\//)
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'besar.jpg', { type: 'image/jpeg' })
    await user.upload(input, big)
    expect(await screen.findByText('Ukuran foto maksimal 2 MB')).toBeInTheDocument()
    expect(db.uploads).toHaveLength(1)
  })

  it('kelola kategori: tambah kategori baru', async () => {
    const { fake } = await openList()
    await user.click(screen.getByRole('button', { name: /Kategori/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Kelola Kategori' })
    await user.click(within(dialog).getByRole('button', { name: /Tambah/ }))
    expect(within(dialog).getByText('Nama kategori wajib diisi')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Nama kategori baru'), 'BIBIT')
    await user.click(within(dialog).getByRole('button', { name: /Tambah/ }))
    expect(await within(dialog).findByText('BIBIT')).toBeInTheDocument()
    expect(fake.calls.writes).toContainEqual({ table: 'categories', op: 'insert', payload: { outlet_id: 'o-tkl', name: 'BIBIT' } })
  })

  it('kasir tidak dapat membuka halaman produk', async () => {
    renderRoute('/produk', USERS.kasir)
    expect(await screen.findByText('Akses ditolak')).toBeInTheDocument()
  })
})

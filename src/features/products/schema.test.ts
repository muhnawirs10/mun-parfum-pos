import { productFormSchema, type ProductFormValues } from './schema'

const base: ProductFormValues = {
  name: 'VALENTINE / SCANDALOUS',
  category_id: '',
  unit: 'ML',
  sell_price: '2.000',
  cost_price: '1.014',
  initial_stock: '307',
  min_stock: '50',
  sku: '',
  description: '',
  image_url: '',
  is_active: true,
}

describe('productFormSchema', () => {
  it('mengubah input Indonesia menjadi nilai numerik string', () => {
    const r = productFormSchema({ canEditCost: true, isCreate: true }).parse(base)
    expect(r).toMatchObject({ sell_price: '2000', cost_price: '1014', initial_stock: '307', min_stock: '50', sku: null, category_id: null })
  })

  it('stok desimal untuk ML, ditolak untuk PCS', () => {
    const s = productFormSchema({ canEditCost: true, isCreate: true })
    expect(s.parse({ ...base, initial_stock: '148,5' }).initial_stock).toBe('148.5')
    const r = s.safeParse({ ...base, unit: 'PCS', initial_stock: '1,5' })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0].message).toBe('Satuan PCS harus bilangan bulat')
  })

  it('pesan kesalahan dalam bahasa Indonesia', () => {
    const r = productFormSchema({ canEditCost: true, isCreate: true }).safeParse({ ...base, name: ' ', sell_price: 'abc', sku: 'a b' })
    const msgs = r.error!.issues.map((i) => i.message)
    expect(msgs).toContain('Nama produk wajib diisi')
    expect(msgs).toContain('Harga jual tidak valid (contoh: 2.000)')
    expect(msgs).toContain('SKU hanya huruf, angka, titik, strip, garis bawah')
  })

  it('tanpa izin HPP: cost_price dikirim null (tidak diubah)', () => {
    const r = productFormSchema({ canEditCost: false, isCreate: false }).parse({ ...base, cost_price: '' })
    expect(r.cost_price).toBeNull()
    expect(r.initial_stock).toBe('0')
  })

  it('stok kosong dianggap 0', () => {
    expect(productFormSchema({ canEditCost: true, isCreate: true }).parse({ ...base, initial_stock: '', min_stock: '' })).toMatchObject({
      initial_stock: '0',
      min_stock: '0',
    })
  })
})

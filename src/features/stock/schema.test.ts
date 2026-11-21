import { Decimal } from '@/lib/decimal'
import { adjustSchema, previewStock } from './schema'

describe('adjustSchema', () => {
  const base = { type: 'stock_in' as const, product_id: 'p-1', quantity: '100,5', reason: '' }
  it('stok masuk tanpa alasan diperbolehkan; jumlah dinormalisasi', () => {
    expect(adjustSchema('ML').parse(base).quantity).toBe('100.5')
  })
  it('stok keluar & opname wajib alasan', () => {
    const r = adjustSchema('ML').safeParse({ ...base, type: 'stock_out' })
    expect(r.error?.issues.map((i) => i.message)).toContain('Alasan wajib diisi untuk stok keluar / opname')
  })
  it('opname boleh 0, stok masuk tidak', () => {
    expect(adjustSchema('ML').safeParse({ ...base, type: 'adjustment', quantity: '0', reason: 'Opname' }).success).toBe(true)
    expect(adjustSchema('ML').safeParse({ ...base, quantity: '0' }).error?.issues[0].message).toBe('Jumlah harus lebih dari 0')
  })
  it('satuan PCS harus bulat; produk wajib dipilih', () => {
    expect(adjustSchema('PCS').safeParse({ ...base, quantity: '1,5' }).error?.issues[0].message).toBe('Satuan PCS harus bilangan bulat')
    expect(adjustSchema(null).safeParse({ ...base, product_id: '' }).error?.issues[0].message).toBe('Pilih produk')
    expect(adjustSchema('ML').safeParse({ ...base, quantity: '1.2345' }).error?.issues[0].message).toMatch(/tidak valid/)
  })
})

describe('previewStock', () => {
  const cur = Decimal.from('307')
  it('masuk, keluar, opname', () => {
    expect(previewStock('stock_in', cur, '100,5')?.after.toString()).toBe('407.5')
    expect(previewStock('stock_out', cur, '7')?.after.toString()).toBe('300')
    const adj = previewStock('adjustment', cur, '300,25')!
    expect(adj.after.toString()).toBe('300.25')
    expect(adj.delta.toString()).toBe('-6.75')
    expect(previewStock('stock_out', cur, 'x')).toBeNull()
  })
})

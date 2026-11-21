import { CartStore, cartTotals } from './cart-store'

const VAL = { productId: 'p-1', name: 'VALENTINE / SCANDALOUS', sku: 'TKL-0001', unit: 'ML' as const, price: '2000' }

describe('CartStore', () => {
  it('menambah, menggabungkan, mengubah, dan menghapus item', () => {
    const s = new CartStore()
    s.add('o', { ...VAL, qty: '10' })
    s.add('o', { ...VAL, qty: '2.5' })
    expect(s.get('o').lines).toHaveLength(1)
    expect(s.get('o').lines[0].qty).toBe('12.5')
    const key = s.get('o').lines[0].key
    s.step('o', key, -2.5)
    expect(s.get('o').lines[0].qty).toBe('10')
    s.step('o', key, -10)
    expect(s.get('o').lines).toHaveLength(0)
  })

  it('total keranjang 10 ml = Rp20.000; diskon dihitung seperti di database', () => {
    const s = new CartStore()
    s.add('o', { ...VAL, qty: '10' })
    expect(cartTotals(s.get('o')).result!.total.toString()).toBe('20000')
    s.updateLine('o', s.get('o').lines[0].key, { discount: '1000' })
    s.setMeta('o', { discount: '2000' })
    expect(cartTotals(s.get('o')).result!.total.toString()).toBe('17000')
    s.setMeta('o', { discount: '30000' })
    expect(cartTotals(s.get('o')).error).toBe('Diskon transaksi melebihi subtotal')
  })

  it('kunci checkout tetap selama keranjang tidak berubah, berganti saat berubah, dan setelah dikosongkan', () => {
    const s = new CartStore()
    s.add('o', { ...VAL, qty: '10' })
    const k1 = s.get('o').checkoutKey
    expect(s.get('o').checkoutKey).toBe(k1)
    s.setMeta('o', { customerName: 'Budi' }) // tidak mengubah isi penjualan
    expect(s.get('o').checkoutKey).toBe(k1)
    s.add('o', { ...VAL, qty: '1' })
    const k2 = s.get('o').checkoutKey
    expect(k2).not.toBe(k1)
    s.setMeta('o', { discount: '500' })
    expect(s.get('o').checkoutKey).not.toBe(k2)
    const k3 = s.get('o').checkoutKey
    s.clear('o')
    expect(s.get('o').lines).toHaveLength(0)
    expect(s.get('o').checkoutKey).not.toBe(k3)
  })

  it('item berdiskon menjadi baris tersendiri', () => {
    const s = new CartStore()
    s.add('o', { ...VAL, qty: '10' })
    s.add('o', { ...VAL, qty: '5', discount: '1000' })
    expect(s.get('o').lines.map((l) => [l.qty, l.discount])).toEqual([['10', '0'], ['5', '1000']])
  })

  it('keranjang terpisah per outlet', () => {
    const s = new CartStore()
    s.add('tkl', { ...VAL, qty: '10' })
    expect(s.get('mks').lines).toHaveLength(0)
  })
})

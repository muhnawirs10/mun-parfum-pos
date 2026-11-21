import { calcChange, calcLine, calcNetProfit, calcSale, SaleCalcError } from './sale-calc'

// Produk contoh dari spesifikasi
const VALENTINE = { price: '2000', cost: '1014', stock: '307' }

describe('Perhitungan penjualan VALENTINE / SCANDALOUS', () => {
  it('penjualan 10 ml: omzet 20.000, HPP 10.140, laba 9.860, sisa 297 ml', () => {
    const r = calcSale([{ price: VALENTINE.price, cost: VALENTINE.cost, qty: '10' }])
    expect(r.total.toString()).toBe('20000')
    expect(r.costTotal.toString()).toBe('10140')
    expect(r.grossProfit.toString()).toBe('9860')
    expect(r.qtyTotal.toString()).toBe('10')
    expect((r.qtyTotal.neg().add(VALENTINE.stock)).toString()).toBe('297')
  })

  it('penjualan 5 ml: omzet 10.000, HPP 5.070, laba 4.930', () => {
    const r = calcSale([{ ...VALENTINE, qty: '5' }])
    expect(r.total.toString()).toBe('10000')
    expect(r.costTotal.toString()).toBe('5070')
    expect(r.grossProfit.toString()).toBe('4930')
  })

  it('volume desimal 2,5 ml', () => {
    const l = calcLine({ ...VALENTINE, qty: '2.5' })
    expect(l.subtotal.toString()).toBe('5000')
    expect(l.cost.toString()).toBe('2535')
  })

  it('diskon item dan diskon transaksi mengurangi omzet', () => {
    const r = calcSale(
      [
        { ...VALENTINE, qty: '10', discount: '1000' },
        { price: '3000', cost: '1212', qty: '5' },
      ],
      '2000',
    )
    // (20000-1000) + 15000 = 34000 ; -2000 = 32000
    expect(r.subtotal.toString()).toBe('34000')
    expect(r.itemDiscountTotal.toString()).toBe('1000')
    expect(r.total.toString()).toBe('32000')
    // HPP 10140 + 6060 = 16200
    expect(r.costTotal.toString()).toBe('16200')
    expect(r.grossProfit.toString()).toBe('15800')
  })

  it('menolak diskon melebihi subtotal dan qty tidak valid', () => {
    expect(() => calcLine({ ...VALENTINE, qty: '1', discount: '2001' })).toThrow(SaleCalcError)
    expect(() => calcSale([{ ...VALENTINE, qty: '1' }], '2001')).toThrow(SaleCalcError)
    expect(() => calcLine({ ...VALENTINE, qty: '0' })).toThrow(SaleCalcError)
    expect(() => calcLine({ ...VALENTINE, qty: '-1' })).toThrow(SaleCalcError)
  })

  it('kembalian tunai', () => {
    expect(calcChange('20000', '50000').toString()).toBe('30000')
    expect(calcChange('20000', '20000').toString()).toBe('0')
    expect(() => calcChange('20000', '19999')).toThrow(SaleCalcError)
  })

  it('laba bersih = laba kotor - pengeluaran', () => {
    expect(calcNetProfit('9860', '5000').toString()).toBe('4860')
    expect(calcNetProfit('9860', '12000').toString()).toBe('-2140')
  })
})

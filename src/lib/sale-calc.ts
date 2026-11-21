import { Decimal, type DecimalInput } from './decimal'

/**
 * Aturan perhitungan penjualan. HARUS identik dengan fungsi SQL
 * `public.create_sale` (supabase/migrations). Diuji di sale-calc.test.ts
 * dan di tes database.
 *
 *  line_subtotal = round(harga × qty, 0)          — rupiah penuh
 *  line_total    = line_subtotal − diskon_item
 *  line_cost     = round(hpp × qty, 2)
 *  subtotal      = Σ line_total
 *  total (omzet) = subtotal − diskon_transaksi
 *  laba_kotor    = total − Σ line_cost
 *  kembalian     = uang_diterima − total          — hanya tunai
 */

export interface SaleLineInput {
  price: DecimalInput
  cost: DecimalInput
  qty: DecimalInput
  discount?: DecimalInput
}

export interface SaleLineResult {
  subtotal: Decimal
  discount: Decimal
  total: Decimal
  cost: Decimal
  grossProfit: Decimal
}

export interface SaleResult {
  lines: SaleLineResult[]
  subtotal: Decimal
  itemDiscountTotal: Decimal
  transactionDiscount: Decimal
  total: Decimal
  costTotal: Decimal
  grossProfit: Decimal
  qtyTotal: Decimal
}

export class SaleCalcError extends Error {}

export function calcLine(line: SaleLineInput): SaleLineResult {
  const qty = Decimal.from(line.qty)
  if (!qty.gt(0)) throw new SaleCalcError('Jumlah harus lebih dari 0')
  const price = Decimal.from(line.price)
  const cost = Decimal.from(line.cost)
  if (price.isNegative() || cost.isNegative()) throw new SaleCalcError('Harga/HPP tidak boleh negatif')
  const subtotal = price.mul(qty).round(0)
  const discount = Decimal.from(line.discount ?? 0)
  if (discount.isNegative()) throw new SaleCalcError('Diskon tidak boleh negatif')
  if (discount.gt(subtotal)) throw new SaleCalcError('Diskon item melebihi subtotal item')
  const total = subtotal.sub(discount)
  const lineCost = cost.mul(qty).round(2)
  return { subtotal, discount, total, cost: lineCost, grossProfit: total.sub(lineCost) }
}

export function calcSale(lines: SaleLineInput[], transactionDiscount: DecimalInput = 0): SaleResult {
  const results = lines.map(calcLine)
  const subtotal = Decimal.sum(results.map((r) => r.total))
  const tDisc = Decimal.from(transactionDiscount)
  if (tDisc.isNegative()) throw new SaleCalcError('Diskon tidak boleh negatif')
  if (tDisc.gt(subtotal)) throw new SaleCalcError('Diskon transaksi melebihi subtotal')
  const total = subtotal.sub(tDisc)
  const costTotal = Decimal.sum(results.map((r) => r.cost))
  return {
    lines: results,
    subtotal,
    itemDiscountTotal: Decimal.sum(results.map((r) => r.discount)),
    transactionDiscount: tDisc,
    total,
    costTotal,
    grossProfit: total.sub(costTotal),
    qtyTotal: Decimal.sum(lines.map((l) => l.qty)),
  }
}

export function calcChange(total: DecimalInput, received: DecimalInput): Decimal {
  const t = Decimal.from(total)
  const r = Decimal.from(received)
  if (r.lt(t)) throw new SaleCalcError('Uang diterima kurang dari total belanja')
  return r.sub(t)
}

/** Laba bersih = laba kotor − pengeluaran operasional. */
export function calcNetProfit(grossProfit: DecimalInput, expenses: DecimalInput): Decimal {
  return Decimal.from(grossProfit).sub(expenses)
}

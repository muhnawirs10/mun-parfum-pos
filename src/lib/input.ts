import { Decimal } from './decimal'

/**
 * Input uang gaya Indonesia: titik = pemisah ribuan, koma = desimal.
 * "2.000" → 2000, "1.014" → 1014, "1.250,50" → 1250.5, "Rp 20.000" → 20000.
 * Mengembalikan null bila tidak valid.
 */
export function parseMoneyInput(raw: string): Decimal | null {
  const s = raw.replace(/rp/i, '').replace(/\s/g, '')
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s)) return null
  return Decimal.parse(s.replace(/\./g, '').replace(',', '.'))
}

/**
 * Input jumlah/volume: koma ATAU titik sebagai desimal, tanpa pemisah ribuan.
 * "148,5" → 148.5, "2.5" → 2.5, "10" → 10. Maksimal 3 desimal.
 */
export function parseQtyInput(raw: string): Decimal | null {
  const s = raw.trim()
  if (!/^\d+([.,]\d{1,3})?$/.test(s)) return null
  return Decimal.parse(s.replace(',', '.'))
}

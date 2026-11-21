import { z } from 'zod'
import { Decimal } from '@/lib/decimal'
import { DECIMAL_UNITS, type StockUnit } from '@/lib/format'
import { parseQtyInput } from '@/lib/input'
import type { AdjustType } from './api'

/**
 * Validasi penyesuaian stok di sisi klien. RPC adjust_stock menegakkan aturan
 * yang sama (alasan wajib, satuan bulat, stok tidak minus kecuali diizinkan).
 */
export function adjustSchema(unit: StockUnit | null) {
  return z
    .object({
      type: z.enum(['stock_in', 'stock_out', 'adjustment']),
      product_id: z.string().min(1, 'Pilih produk'),
      quantity: z.string().trim(),
      reason: z.string().trim().max(500, 'Alasan maksimal 500 karakter'),
    })
    .superRefine((v, ctx) => {
      const q = parseQtyInput(v.quantity)
      const label = v.type === 'adjustment' ? 'Stok fisik' : 'Jumlah'
      if (v.quantity === '') ctx.addIssue({ code: 'custom', path: ['quantity'], message: `${label} wajib diisi` })
      else if (!q) ctx.addIssue({ code: 'custom', path: ['quantity'], message: `${label} tidak valid (maks. 3 desimal)` })
      else {
        if (v.type !== 'adjustment' && !q.gt(0)) ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Jumlah harus lebih dari 0' })
        if (unit && !DECIMAL_UNITS.includes(unit) && !q.isInteger())
          ctx.addIssue({ code: 'custom', path: ['quantity'], message: `Satuan ${unit} harus bilangan bulat` })
      }
      if (v.type !== 'stock_in' && v.reason === '')
        ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Alasan wajib diisi untuk stok keluar / opname' })
    })
    .transform((v) => ({ ...v, quantity: parseQtyInput(v.quantity)!.toString() }))
}

/** Pratinjau stok sesudah perubahan (sama dengan perhitungan di database). */
export function previewStock(type: AdjustType, current: Decimal, qtyText: string): { after: Decimal; delta: Decimal } | null {
  const q = parseQtyInput(qtyText)
  if (!q) return null
  if (type === 'adjustment') return { after: q, delta: q.sub(current) }
  const delta = type === 'stock_in' ? q : q.neg()
  return { after: current.add(delta), delta }
}

export const REASON_PRESETS: Record<AdjustType, string[]> = {
  stock_in: ['Restock supplier', 'Retur dari pelanggan', 'Koreksi input'],
  stock_out: ['Botol pecah / tumpah', 'Tester / sampel', 'Kedaluwarsa / rusak', 'Hilang', 'Pemakaian sendiri'],
  adjustment: ['Opname rutin', 'Selisih hitung fisik'],
}

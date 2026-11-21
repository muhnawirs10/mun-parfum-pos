import { z } from 'zod'
import { DECIMAL_UNITS, type StockUnit } from '@/lib/format'
import { parseMoneyInput, parseQtyInput } from '@/lib/input'

export const UNITS: StockUnit[] = ['ML', 'PCS', 'GRAM', 'UNIT', 'BOTOL']

const money = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} wajib diisi`)
    .refine((v) => parseMoneyInput(v) !== null, `${label} tidak valid (contoh: 2.000)`)
    .transform((v) => parseMoneyInput(v)!.toString())

const qty = (label: string) =>
  z
    .string()
    .trim()
    .transform((v) => (v === '' ? '0' : v))
    .refine((v) => parseQtyInput(v) !== null, `${label} tidak valid (maks. 3 desimal, contoh: 148,5)`)
    .transform((v) => parseQtyInput(v)!.toString())

/**
 * Validasi form produk (sisi klien). Validasi yang sama juga ditegakkan oleh
 * RPC create_product/update_product dan constraint database.
 */
export function productFormSchema(opts: { canEditCost: boolean; isCreate: boolean }) {
  return z
    .object({
      name: z.string().trim().min(1, 'Nama produk wajib diisi').max(120, 'Nama maksimal 120 karakter'),
      category_id: z.string().transform((v) => v || null),
      unit: z.enum(['ML', 'PCS', 'GRAM', 'UNIT', 'BOTOL']),
      sell_price: money('Harga jual'),
      cost_price: opts.canEditCost ? money('HPP') : z.string().transform(() => null),
      initial_stock: opts.isCreate ? qty('Stok awal') : z.string().transform(() => '0'),
      min_stock: qty('Stok minimum'),
      sku: z
        .string()
        .trim()
        .max(32, 'SKU maksimal 32 karakter')
        .refine((v) => v === '' || /^[A-Za-z0-9._-]+$/.test(v), 'SKU hanya huruf, angka, titik, strip, garis bawah')
        .transform((v) => v || null),
      description: z
        .string()
        .trim()
        .max(1000, 'Deskripsi maksimal 1000 karakter')
        .transform((v) => v || null),
      image_url: z.string().transform((v) => v || null),
      is_active: z.boolean(),
    })
    .superRefine((v, ctx) => {
      if (!DECIMAL_UNITS.includes(v.unit)) {
        for (const key of ['initial_stock', 'min_stock'] as const) {
          if (v[key].includes('.')) {
            ctx.addIssue({ code: 'custom', path: [key], message: `Satuan ${v.unit} harus bilangan bulat` })
          }
        }
      }
    })
}

export type ProductFormValues = z.input<ReturnType<typeof productFormSchema>>
export type ProductFormOutput = z.output<ReturnType<typeof productFormSchema>>

export const categorySchema = z.object({
  name: z.string().trim().min(1, 'Nama kategori wajib diisi').max(60, 'Maksimal 60 karakter'),
})

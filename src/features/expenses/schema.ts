import { z } from 'zod'
import { parseMoneyInput } from '@/lib/input'
import { EXPENSE_CATEGORIES } from './api'

export const expenseSchema = z.object({
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal wajib diisi'),
  category: z.enum(EXPENSE_CATEGORIES, { message: 'Pilih kategori' }),
  amount: z
    .string()
    .trim()
    .min(1, 'Nominal wajib diisi')
    .refine((v) => parseMoneyInput(v) !== null, 'Nominal tidak valid (contoh: 150.000)')
    .transform((v) => parseMoneyInput(v)!)
    .refine((d) => d.gt(0), 'Nominal harus lebih dari 0')
    .transform((d) => d.toString()),
  description: z
    .string()
    .trim()
    .max(500, 'Keterangan maksimal 500 karakter')
    .transform((v) => v || null),
})

export type ExpenseFormValues = z.input<typeof expenseSchema>

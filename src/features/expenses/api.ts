import type { SupabaseClient } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/auth-context'
import type { Period } from '@/lib/periods'

export const EXPENSE_CATEGORIES = ['sewa', 'listrik', 'air', 'gaji', 'transportasi', 'perlengkapan', 'operasional', 'lainnya'] as const
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  sewa: 'Sewa',
  listrik: 'Listrik',
  air: 'Air',
  gaji: 'Gaji',
  transportasi: 'Transportasi',
  perlengkapan: 'Perlengkapan',
  operasional: 'Operasional',
  lainnya: 'Lainnya',
}

export interface Expense {
  id: string
  expense_date: string
  category: ExpenseCategory
  amount: number
  description: string | null
  created_by_name: string | null
  created_at: string
}

export interface ExpenseList {
  count: number
  total_amount: number
  can_manage: boolean
  by_category: { category: ExpenseCategory; count: number; amount: number }[]
  items: Expense[]
}

export interface ExpenseInput {
  expense_date: string
  category: ExpenseCategory
  amount: string
  description: string | null
}

export async function fetchExpenses(client: SupabaseClient, outletId: string, p: Period, category: ExpenseCategory | null) {
  const { data, error } = await client.rpc('get_expenses', { p_outlet_id: outletId, p_from: p.from, p_to: p.to, p_category: category })
  if (error) throw error
  return data as ExpenseList
}

function useCtx() {
  const { client, activeOutlet, session } = useAuth()
  if (!client || !activeOutlet || !session) throw new Error('Sesi belum siap')
  return { client, outletId: activeOutlet.outlet_id, userId: session.user.id }
}

export function useExpenses(period: Period, category: ExpenseCategory | null, enabled = true) {
  const { client, outletId } = useCtx()
  return useQuery({
    queryKey: ['expenses', outletId, period, category],
    queryFn: () => fetchExpenses(client, outletId, period, category),
    enabled,
  })
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => ['expenses', 'sales-report', 'dashboard'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }))
}

/** Tambah/ubah pengeluaran langsung ke tabel (dibatasi RLS + dicatat audit). */
export function useSaveExpense() {
  const { client, outletId, userId } = useCtx()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: ExpenseInput }) => {
      const { error } = id
        ? await client.from('expenses').update(values).eq('id', id)
        : await client.from('expenses').insert({ ...values, outlet_id: outletId, created_by: userId })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/** Hapus = soft delete (deleted_at); data tetap ada untuk audit. */
export function useDeleteExpense() {
  const { client, userId } = useCtx()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client.from('expenses').update({ deleted_at: new Date().toISOString(), deleted_by: userId }).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

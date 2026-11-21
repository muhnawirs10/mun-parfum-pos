import type { SupabaseClient } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/auth-context'
import type { PaymentMethod } from '@/features/dashboard/api'
import type { StockUnit } from '@/lib/format'
import type { Period } from '@/lib/periods'

export interface ProductRank {
  product_id: string
  name: string
  unit: StockUnit
  quantity: number
  omzet: number
  gross_profit: number | null
}

export interface SalesReport {
  from: string
  to: string
  outlet_ids: string[]
  can_view_profit: boolean
  transaction_count: number
  omzet: number
  subtotal_before_discount: number
  discount_total: number
  average_transaction: number
  item_count: number
  cost_total: number | null
  gross_profit: number | null
  expenses_total: number | null
  net_profit: number | null
  void_count: number
  qty_by_unit: { unit: StockUnit; quantity: number }[]
  by_payment_method: { method: PaymentMethod; count: number; amount: number }[]
  top_products: ProductRank[]
  top_profit_products: ProductRank[] | null
  by_outlet: { outlet_id: string; code: string; name: string; transaction_count: number; omzet: number; gross_profit: number | null }[]
}

export interface CashSession {
  id: string
  outlet_id: string
  status: 'open' | 'closed'
  opened_at: string
  closed_at: string | null
  opened_by_name: string | null
  closed_by_name: string | null
  opening_cash: number
  transaction_count: number
  sales_total: number
  cash_sales: number
  by_payment_method: { method: PaymentMethod; amount: number }[]
  expected_cash: number
  counted_cash: number | null
  cash_difference: number | null
  note: string | null
  can_close?: boolean
}

export async function fetchSalesReport(client: SupabaseClient, p: Period, outletId: string | null, includeExpenses: boolean) {
  const { data, error } = await client.rpc('get_sales_report', {
    p_from: p.from,
    p_to: p.to,
    p_outlet_id: outletId,
    p_include_expenses: includeExpenses,
  })
  if (error) throw error
  return data as SalesReport
}

export async function fetchCashSessions(client: SupabaseClient, outletId: string, p: Period) {
  const { data, error } = await client.rpc('get_cash_sessions', { p_outlet_id: outletId, p_from: p.from, p_to: p.to })
  if (error) throw error
  return (data ?? []) as CashSession[]
}

function useCtx() {
  const { client, activeOutlet } = useAuth()
  if (!client || !activeOutlet) throw new Error('Sesi belum siap')
  return { client, outletId: activeOutlet.outlet_id }
}

/** `allOutlets` = gabungan semua outlet yang diizinkan (untuk owner). */
export function useSalesReport(period: Period, includeExpenses: boolean, allOutlets: boolean, enabled = true) {
  const { client, outletId } = useCtx()
  const target = allOutlets ? null : outletId
  return useQuery({
    queryKey: ['sales-report', target, period, includeExpenses],
    queryFn: () => fetchSalesReport(client, period, target, includeExpenses),
    enabled,
  })
}

export function useCashSessions(period: Period, enabled = true) {
  const { client, outletId } = useCtx()
  return useQuery({ queryKey: ['cash-sessions', outletId, period], queryFn: () => fetchCashSessions(client, outletId, period), enabled })
}

export function useMyCashSession() {
  const { client, outletId } = useCtx()
  return useQuery({
    queryKey: ['my-cash-session', outletId],
    queryFn: async () => {
      const { data, error } = await client.rpc('get_my_cash_session', { p_outlet_id: outletId })
      if (error) throw error
      return (data ?? null) as CashSession | null
    },
  })
}

function useInvalidateCash() {
  const qc = useQueryClient()
  return () => ['my-cash-session', 'cash-sessions'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }))
}

export function useOpenCashSession() {
  const { client, outletId } = useCtx()
  const invalidate = useInvalidateCash()
  return useMutation({
    mutationFn: async (openingCash: string) => {
      const { error } = await client.rpc('open_cash_session', { p_outlet_id: outletId, p_opening_cash: openingCash })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useCloseCashSession() {
  const { client } = useCtx()
  const invalidate = useInvalidateCash()
  return useMutation({
    mutationFn: async (v: { sessionId: string; countedCash: string; note: string | null }) => {
      const { data, error } = await client.rpc('close_cash_session', { p_session_id: v.sessionId, p_counted_cash: v.countedCash, p_note: v.note })
      if (error) throw error
      return data as CashSession
    },
    onSuccess: invalidate,
  })
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PaymentMethod } from '@/features/dashboard/api'
import type { StockUnit } from '@/lib/format'

export type TransactionStatus = 'completed' | 'void'

export interface TransactionListItem {
  id: string
  number: string
  created_at: string
  business_date: string
  status: TransactionStatus
  total: number
  payment_method: PaymentMethod
  item_count: number
  customer_name: string | null
  cashier_name: string | null
  items: string | null
}

export interface TransactionList {
  scope: 'outlet' | 'own'
  total: number
  completed_count: number
  completed_amount: number
  items: TransactionListItem[]
}

export interface TransactionDetail {
  id: string
  number: string
  business_date: string
  created_at: string
  status: TransactionStatus
  customer_name: string | null
  note: string | null
  subtotal: number
  item_discount_total: number
  discount_amount: number
  total: number
  item_count: number
  payment_method: PaymentMethod
  amount_paid: number
  change_amount: number
  cost_total: number | null
  gross_profit: number | null
  voided_at: string | null
  void_reason: string | null
  voided_by_name: string | null
  cashier_name: string | null
  can_void: boolean
  outlet: { name: string; code: string; address: string | null; phone: string | null }
  receipt_footer: string
  items: {
    id: string
    product_id: string
    product_name: string
    sku: string
    unit: StockUnit
    quantity: number
    unit_price: number
    subtotal: number
    discount_amount: number
    total: number
    gross_profit: number | null
  }[]
  payments: { method: PaymentMethod; amount: number; amount_received: number; change_amount: number; reference: string | null }[]
}

export interface TransactionFilter {
  from: string
  to: string
  status?: TransactionStatus | null
  method?: PaymentMethod | null
  search?: string | null
}

export const TX_PAGE_SIZE = 50

export async function fetchTransactions(client: SupabaseClient, outletId: string, f: TransactionFilter, offset: number) {
  const { data, error } = await client.rpc('get_transactions', {
    p_outlet_id: outletId,
    p_from: f.from,
    p_to: f.to,
    p_status: f.status || null,
    p_method: f.method || null,
    p_search: f.search?.trim() || null,
    p_limit: TX_PAGE_SIZE,
    p_offset: offset,
  })
  if (error) throw error
  return data as TransactionList
}

export async function fetchTransactionDetail(client: SupabaseClient, id: string) {
  const { data, error } = await client.rpc('get_transaction_detail', { p_transaction_id: id })
  if (error) throw error
  return data as TransactionDetail
}

export async function voidTransaction(client: SupabaseClient, id: string, reason: string) {
  const { error } = await client.rpc('void_transaction', { p_transaction_id: id, p_reason: reason })
  if (error) throw error
}

export interface SaleRequest {
  outletId: string
  items: { product_id: string; quantity: string; discount_amount: string }[]
  paymentMethod: PaymentMethod
  amountReceived: string | null
  discount: string
  reference: string | null
  customerName: string | null
  note: string | null
  idempotencyKey: string
}

export interface SaleResponse {
  id: string
  number: string
  total: number
  change_amount: number
  amount_paid: number
  replayed: boolean
}

export async function createSale(client: SupabaseClient, r: SaleRequest) {
  const { data, error } = await client.rpc('create_sale', {
    p_outlet_id: r.outletId,
    p_items: r.items,
    p_payment_method: r.paymentMethod,
    p_amount_received: r.amountReceived,
    p_idempotency_key: r.idempotencyKey,
    p_discount_amount: r.discount,
    p_payment_reference: r.reference,
    p_customer_name: r.customerName,
    p_note: r.note,
  })
  if (error) throw error
  return data as SaleResponse
}

/** Apakah owner mengizinkan stok minus di outlet ini (hanya untuk peringatan UI). */
export async function fetchAllowNegativeStock(client: SupabaseClient, outletId: string): Promise<boolean> {
  const { data, error } = await client.from('app_settings').select('outlet_id, key, value').eq('key', 'allow_negative_stock')
  if (error) throw error
  const rows = (data ?? []) as { outlet_id: string | null; value: unknown }[]
  const own = rows.find((r) => r.outlet_id === outletId)
  const global = rows.find((r) => r.outlet_id === null)
  return (own ?? global)?.value === true
}

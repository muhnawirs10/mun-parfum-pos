import type { SupabaseClient } from '@supabase/supabase-js'
import type { StockUnit } from '@/lib/format'

export type MovementType = 'initial' | 'stock_in' | 'stock_out' | 'adjustment' | 'sale' | 'sale_void' | 'transfer_in' | 'transfer_out'
export type AdjustType = 'stock_in' | 'stock_out' | 'adjustment'

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  initial: 'Stok awal',
  stock_in: 'Stok masuk',
  stock_out: 'Stok keluar',
  adjustment: 'Opname',
  sale: 'Penjualan',
  sale_void: 'Batal penjualan',
  transfer_in: 'Transfer masuk',
  transfer_out: 'Transfer keluar',
}

export interface StockMovement {
  id: string
  created_at: string
  movement_type: MovementType
  quantity: number
  stock_before: number
  stock_after: number
  reason: string | null
  product_id: string
  product_name: string
  sku: string
  unit: StockUnit
  user_name: string | null
  transaction_id: string | null
  transaction_number: string | null
}

export interface MovementPage {
  total: number
  summary: { movement_type: MovementType; count: number; quantity: number }[]
  items: StockMovement[]
}

export interface MovementFilter {
  productId?: string | null
  from?: string | null
  to?: string | null
  types?: MovementType[] | null
}

export interface StockSummary {
  active_count: number
  low_count: number
  empty_count: number
  value_at_sell_price: number
  value_at_cost: number | null
}

export const PAGE_SIZE = 50

export async function fetchMovements(client: SupabaseClient, outletId: string, f: MovementFilter, offset: number): Promise<MovementPage> {
  const { data, error } = await client.rpc('get_stock_movements', {
    p_outlet_id: outletId,
    p_product_id: f.productId || null,
    p_from: f.from || null,
    p_to: f.to || null,
    p_types: f.types?.length ? f.types : null,
    p_limit: PAGE_SIZE,
    p_offset: offset,
  })
  if (error) throw error
  return data as MovementPage
}

export async function fetchStockSummary(client: SupabaseClient, outletId: string): Promise<StockSummary> {
  const { data, error } = await client.rpc('get_stock_summary', { p_outlet_id: outletId })
  if (error) throw error
  return data as StockSummary
}

export async function adjustStock(
  client: SupabaseClient,
  args: { productId: string; type: AdjustType; quantity: string; reason: string; idempotencyKey: string },
) {
  const { data, error } = await client.rpc('adjust_stock', {
    p_product_id: args.productId,
    p_type: args.type,
    p_quantity: args.quantity,
    p_reason: args.reason,
    p_idempotency_key: args.idempotencyKey,
  })
  if (error) throw error
  return data as StockMovement & { replayed: boolean }
}

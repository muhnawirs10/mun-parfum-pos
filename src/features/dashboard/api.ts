import type { SupabaseClient } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/auth-context'
import type { StockUnit } from '@/lib/format'

export type PaymentMethod = 'cash' | 'qris' | 'transfer' | 'ewallet' | 'other'

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  ewallet: 'E-wallet',
  other: 'Lainnya',
}

export interface DashboardData {
  business_date: string
  scope: 'outlet' | 'own'
  transaction_count: number
  omzet: number
  gross_profit: number | null
  expenses_total: number | null
  expenses_count: number | null
  product_count: number
  low_stock: { id: string; name: string; sku: string; unit: StockUnit; current_stock: number; min_stock: number }[] | null
  recent_transactions: {
    id: string
    number: string
    total: number
    status: 'completed' | 'void'
    payment_method: PaymentMethod
    created_at: string
    items: string | null
  }[]
}

export async function fetchDashboard(client: SupabaseClient, outletId: string): Promise<DashboardData> {
  const { data, error } = await client.rpc('get_dashboard', { p_outlet_id: outletId })
  if (error) throw error
  return data as DashboardData
}

export function useDashboard() {
  const { client, activeOutlet } = useAuth()
  return useQuery({
    queryKey: ['dashboard', activeOutlet?.outlet_id],
    queryFn: () => fetchDashboard(client!, activeOutlet!.outlet_id),
    enabled: !!client && !!activeOutlet,
    refetchInterval: 60_000,
  })
}

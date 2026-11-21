import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/auth-context'
import * as api from './api'

function useCtx() {
  const { client, activeOutlet } = useAuth()
  if (!client || !activeOutlet) throw new Error('Sesi belum siap')
  return { client, outletId: activeOutlet.outlet_id }
}

const AFTER_SALE = ['products', 'stock-movements', 'stock-summary', 'dashboard', 'transactions', 'transaction', 'sales-report', 'my-cash-session', 'cash-sessions']

export function useTransactions(filter: api.TransactionFilter) {
  const { client, outletId } = useCtx()
  return useInfiniteQuery({
    queryKey: ['transactions', outletId, filter],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.fetchTransactions(client, outletId, filter, pageParam),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })
}

export function useTransactionDetail(id: string | null) {
  const { client } = useCtx()
  return useQuery({
    queryKey: ['transaction', id],
    queryFn: () => api.fetchTransactionDetail(client, id!),
    enabled: !!id,
  })
}

export function useCreateSale() {
  const { client } = useCtx()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (r: api.SaleRequest) => api.createSale(client, r),
    onSuccess: () => AFTER_SALE.forEach((k) => void qc.invalidateQueries({ queryKey: [k] })),
  })
}

export function useVoidTransaction() {
  const { client } = useCtx()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.voidTransaction(client, id, reason),
    onSuccess: () => AFTER_SALE.forEach((k) => void qc.invalidateQueries({ queryKey: [k] })),
  })
}

export function useAllowNegativeStock() {
  const { client, outletId } = useCtx()
  return useQuery({ queryKey: ['setting', outletId, 'allow_negative_stock'], queryFn: () => api.fetchAllowNegativeStock(client, outletId) })
}

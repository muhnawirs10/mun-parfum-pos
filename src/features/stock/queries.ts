import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/auth-context'
import * as api from './api'

function useCtx() {
  const { client, activeOutlet } = useAuth()
  if (!client || !activeOutlet) throw new Error('Sesi belum siap')
  return { client, outletId: activeOutlet.outlet_id }
}

export function useStockSummary() {
  const { client, outletId } = useCtx()
  return useQuery({ queryKey: ['stock-summary', outletId], queryFn: () => api.fetchStockSummary(client, outletId) })
}

export function useMovements(filter: api.MovementFilter) {
  const { client, outletId } = useCtx()
  return useInfiniteQuery({
    queryKey: ['stock-movements', outletId, filter],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.fetchMovements(client, outletId, filter, pageParam),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })
}

export function useAdjustStock() {
  const { client } = useCtx()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: Parameters<typeof api.adjustStock>[1]) => api.adjustStock(client, args),
    onSuccess: () => {
      for (const key of ['products', 'stock-movements', 'stock-summary', 'dashboard']) void qc.invalidateQueries({ queryKey: [key] })
    },
  })
}

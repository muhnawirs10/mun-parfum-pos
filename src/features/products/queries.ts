import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/auth-context'
import * as api from './api'
import type { ProductFormOutput } from './schema'

export const productKeys = {
  list: (outletId: string, withCost: boolean) => ['products', outletId, { withCost }] as const,
  categories: (outletId: string) => ['categories', outletId] as const,
}

function useCtx() {
  const { client, activeOutlet, can } = useAuth()
  if (!client || !activeOutlet) throw new Error('Sesi belum siap')
  return { client, outletId: activeOutlet.outlet_id, can }
}

export function useProducts() {
  const { client, outletId, can } = useCtx()
  const withCost = can('cost.view')
  return useQuery({
    queryKey: productKeys.list(outletId, withCost),
    queryFn: () => api.fetchProducts(client, outletId, withCost),
  })
}

export function useCategories() {
  const { client, outletId } = useCtx()
  return useQuery({ queryKey: productKeys.categories(outletId), queryFn: () => api.fetchCategories(client, outletId) })
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['products'] })
    void qc.invalidateQueries({ queryKey: ['categories'] })
    void qc.invalidateQueries({ queryKey: ['dashboard'] })
  }
}

export function useSaveProduct() {
  const { client, outletId } = useCtx()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, values }: { id?: string; values: ProductFormOutput }) =>
      id ? api.updateProduct(client, id, values) : api.createProduct(client, outletId, values),
    onSuccess: invalidate,
  })
}

export function useSetProductActive() {
  const { client } = useCtx()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.setProductActive(client, id, active),
    onSuccess: invalidate,
  })
}

export function useCreateCategory() {
  const { client, outletId } = useCtx()
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (name: string) => api.createCategory(client, outletId, name), onSuccess: invalidate })
}

export function useUpdateCategory() {
  const { client } = useCtx()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; is_active?: boolean } }) => api.updateCategory(client, id, patch),
    onSuccess: invalidate,
  })
}

export function useUploadImage() {
  const { client, outletId } = useCtx()
  return useMutation({ mutationFn: (file: File) => api.uploadProductImage(client, outletId, file) })
}

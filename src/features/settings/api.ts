import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/auth-context'

export interface OutletSettings {
  allow_negative_stock: boolean
  receipt_footer: string
  can_manage: boolean
  can_manage_negative_stock: boolean
}

export function useSettings() {
  const { client, activeOutlet } = useAuth()
  return useQuery({
    queryKey: ['settings', activeOutlet?.outlet_id],
    enabled: !!activeOutlet,
    queryFn: async () => {
      const { data, error } = await client!.rpc('get_settings', { p_outlet_id: activeOutlet!.outlet_id })
      if (error) throw error
      return data as OutletSettings
    },
  })
}

export function useSetSetting() {
  const { client, activeOutlet } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { key: 'allow_negative_stock' | 'receipt_footer'; value: boolean | string }) => {
      const { error } = await client!.rpc('set_setting', { p_outlet_id: activeOutlet!.outlet_id, p_key: v.key, p_value: v.value })
      if (error) throw error
    },
    onSuccess: () => ['settings', 'setting', 'transaction'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] })),
  })
}

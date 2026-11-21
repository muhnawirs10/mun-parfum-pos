import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { useAuth } from '@/features/auth/auth-context'

export interface Outlet {
  id: string
  code: string
  name: string
  address: string | null
  phone: string | null
  logo_url: string | null
  is_active: boolean
}

export const outletSchema = z.object({
  code: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => /^[A-Z0-9]{2,6}$/.test(v), 'Kode 2–6 huruf/angka, contoh: TKL'),
  name: z.string().trim().min(1, 'Nama outlet wajib diisi').max(100),
  address: z.string().trim().max(300).transform((v) => v || null),
  phone: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[0-9+() -]{6,20}$/.test(v), 'Nomor telepon tidak valid')
    .transform((v) => v || null),
  logo_url: z.string().transform((v) => v || null),
  is_active: z.boolean(),
})
export type OutletFormValues = z.input<typeof outletSchema>

export function useOutlets() {
  const { client } = useAuth()
  return useQuery({
    queryKey: ['outlets'],
    queryFn: async () => {
      const { data, error } = await client!.from('outlets').select('id, code, name, address, phone, logo_url, is_active').order('code')
      if (error) throw error
      return data as Outlet[]
    },
  })
}

export function useSaveOutlet() {
  const { client, reload } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: z.output<typeof outletSchema> }) => {
      const { error } = id ? await client!.from('outlets').update(values).eq('id', id) : await client!.from('outlets').insert(values)
      if (error) {
        if (error.code === '23505') throw new Error(`Kode outlet ${values.code} sudah dipakai`)
        throw error
      }
    },
    onSuccess: async () => {
      void qc.invalidateQueries({ queryKey: ['outlets'] })
      await reload() // daftar outlet di sesi (pemilih outlet) ikut diperbarui
    },
  })
}

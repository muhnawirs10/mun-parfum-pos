import type { SupabaseClient } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/auth-context'
import type { Permission } from '@/features/auth/permissions'

export interface StaffAssignment {
  id: string
  outlet_id: string
  outlet_code: string
  outlet_name: string
  role: 'admin' | 'kasir'
  permissions: Permission[]
  revoked_permissions: Permission[]
  is_active: boolean
}

export interface StaffMember {
  id: string
  full_name: string
  username: string | null
  is_owner: boolean
  is_active: boolean
  created_at: string
  is_self: boolean
  can_manage: boolean
  assignments: StaffAssignment[]
}

export interface AuditEntry {
  id: string
  created_at: string
  action: string
  entity: string
  entity_id: string | null
  details: Record<string, unknown>
  user_name: string | null
  outlet_code: string | null
}

/** Panggil Edge Function admin-users dan ambil pesan error yang ramah. */
export async function callAdminUsers(client: SupabaseClient, body: Record<string, unknown>) {
  const { data, error } = await client.functions.invoke('admin-users', { body })
  if (error) {
    const ctx = (error as { context?: Response }).context
    let message = error.message
    try {
      const j = ctx && typeof ctx.json === 'function' ? await ctx.json() : null
      if (j?.error) message = j.error
    } catch {
      /* respons bukan JSON */
    }
    throw new Error(message)
  }
  if (data && data.ok === false) throw new Error(data.error ?? 'Gagal')
  return data as { ok: true; user_id?: string; username?: string }
}

function useClient() {
  const { client } = useAuth()
  if (!client) throw new Error('Sesi belum siap')
  return client
}

export function useStaff() {
  const client = useClient()
  return useQuery({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data, error } = await client.rpc('list_staff')
      if (error) throw error
      return data as StaffMember[]
    },
  })
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: ['staff'] })
}

export interface CreateStaffInput {
  full_name: string
  username: string
  password: string
  outlet_id: string
  role: 'admin' | 'kasir'
  permissions: Permission[]
}

export function useCreateStaff() {
  const client = useClient()
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (v: CreateStaffInput) => callAdminUsers(client, { action: 'create_staff', ...v }), onSuccess: invalidate })
}

export function useResetPassword() {
  const client = useClient()
  return useMutation({ mutationFn: (v: { userId: string; password: string }) => callAdminUsers(client, { action: 'reset_password', user_id: v.userId, password: v.password }) })
}

export function useSetStaffActive() {
  const client = useClient()
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (v: { userId: string; active: boolean }) => callAdminUsers(client, { action: 'set_active', user_id: v.userId, active: v.active }), onSuccess: invalidate })
}

export function useAssignOutletUser() {
  const client = useClient()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (v: { userId: string; outletId: string; role: 'admin' | 'kasir'; permissions: Permission[]; revoked: Permission[]; active: boolean }) => {
      const { error } = await client.rpc('assign_outlet_user', {
        p_user_id: v.userId,
        p_outlet_id: v.outletId,
        p_role: v.role,
        p_permissions: v.permissions,
        p_revoked: v.revoked,
        p_active: v.active,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useUpdateStaffName() {
  const client = useClient()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (v: { userId: string; fullName: string }) => {
      const { error } = await client.rpc('update_staff_name', { p_user_id: v.userId, p_full_name: v.fullName })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useAuditLogs(filter: { from: string; to: string; outletId: string | null; entity: string | null }, enabled: boolean) {
  const client = useClient()
  return useQuery({
    queryKey: ['audit', filter],
    enabled,
    queryFn: async () => {
      const { data, error } = await client.rpc('get_audit_logs', {
        p_from: filter.from,
        p_to: filter.to,
        p_outlet_id: filter.outletId,
        p_entity: filter.entity,
        p_limit: 100,
        p_offset: 0,
      })
      if (error) throw error
      return data as { total: number; items: AuditEntry[] }
    },
  })
}

export const AUDIT_ENTITY_LABEL: Record<string, string> = {
  transactions: 'Transaksi',
  products: 'Produk',
  expenses: 'Pengeluaran',
  outlet_users: 'Penugasan karyawan',
  profiles: 'Akun',
  outlets: 'Outlet',
  categories: 'Kategori',
  app_settings: 'Pengaturan',
  cash_sessions: 'Sesi kas',
}

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  create: 'membuat',
  insert: 'menambah',
  update: 'mengubah',
  delete: 'menghapus',
  void: 'membatalkan',
  activate: 'mengaktifkan',
  deactivate: 'menonaktifkan',
  open: 'membuka',
  close: 'menutup',
  stock_stock_in: 'stok masuk',
  stock_stock_out: 'stok keluar',
  stock_adjustment: 'opname stok',
}

export function generatePassword(length = 10): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const buf = new Uint32Array(length)
  crypto.getRandomValues(buf)
  return Array.from(buf, (n) => chars[n % chars.length]).join('')
}

/** Outlet tempat pemanggil boleh mengelola karyawan. */
export function useManageableOutlets() {
  const { outlets, profile } = useAuth()
  return outlets.filter((o) => profile?.is_owner || o.permissions.includes('users.manage'))
}

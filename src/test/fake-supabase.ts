import type { SupabaseClient } from '@supabase/supabase-js'
import type { OutletAccess } from '@/features/auth/permissions'
import { PERMISSIONS } from '@/features/auth/permissions'

export interface FakeUser {
  id: string
  email: string
  password: string
  full_name: string
  username?: string
  is_owner?: boolean
  access: OutletAccess[]
}

const TKL = { outlet_id: 'o-tkl', outlet_code: 'TKL', outlet_name: 'MUN Parfum Takalar' }
const MKS = { outlet_id: 'o-mks', outlet_code: 'MKS', outlet_name: 'MUN Parfum Makassar' }

export const USERS: Record<'owner' | 'admin' | 'kasir' | 'orphan', FakeUser> = {
  owner: {
    id: 'u-owner',
    email: 'owner@munparfum.id',
    password: 'rahasia123',
    full_name: 'Nawir',
    username: 'nawir08',
    is_owner: true,
    access: [
      { ...TKL, role: 'owner', permissions: [...PERMISSIONS] },
      { ...MKS, role: 'owner', permissions: [...PERMISSIONS] },
    ],
  },
  admin: {
    id: 'u-admin',
    email: 'admin@staff.munparfum.local',
    password: 'rahasia123',
    full_name: 'Admin TKL',
    username: 'admin',
    access: [
      {
        ...TKL,
        role: 'admin',
        permissions: ['pos.sell', 'transactions.view_all', 'transactions.void', 'products.manage', 'stock.manage', 'cost.view', 'reports.view', 'closing.perform'],
      },
    ],
  },
  kasir: {
    id: 'u-kasir',
    email: 'kasir1@staff.munparfum.local',
    password: 'rahasia123',
    full_name: 'Kasir Satu',
    username: 'kasir1',
    access: [{ ...TKL, role: 'kasir', permissions: ['pos.sell'] }],
  },
  orphan: { id: 'u-orphan', email: 'baru@munparfum.id', password: 'rahasia123', full_name: 'Baru', access: [] },
}

/** Klien Supabase palsu yang cukup untuk AuthProvider. */
export function createFakeSupabase(initialUser: FakeUser | null = null) {
  let current: FakeUser | null = initialUser
  const listeners = new Set<(event: string, session: unknown) => void>()
  const sessionOf = (u: FakeUser | null) => (u ? { access_token: 't', user: { id: u.id, email: u.email } } : null)
  const calls = { signIn: [] as string[], signOut: 0 }

  const client = {
    auth: {
      getSession: async () => ({ data: { session: sessionOf(current) }, error: null }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        listeners.add(cb)
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }
      },
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        calls.signIn.push(email)
        const u = Object.values(USERS).find((x) => x.email === email && x.password === password)
        if (!u) return { data: { session: null }, error: { message: 'Invalid login credentials' } }
        current = u
        return { data: { session: sessionOf(u) }, error: null }
      },
      signOut: async () => {
        calls.signOut++
        current = null
        return { error: null }
      },
    },
    from: (table: string) => {
      if (table !== 'profiles') throw new Error('tabel tidak didukung: ' + table)
      return {
        select: () => ({
          eq: () => ({
            single: async () =>
              current
                ? {
                    data: {
                      id: current.id,
                      full_name: current.full_name,
                      username: current.username ?? null,
                      is_owner: !!current.is_owner,
                      is_active: true,
                    },
                    error: null,
                  }
                : { data: null, error: { message: 'not found' } },
          }),
        }),
      }
    },
    rpc: async (fn: string) => {
      if (fn !== 'my_access') throw new Error('rpc tidak didukung: ' + fn)
      return { data: current?.access ?? [], error: null }
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

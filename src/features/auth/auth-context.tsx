import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { identifierToEmail } from './identifier'
import { hasPermission, type OutletAccess, type Permission } from './permissions'

export interface Profile {
  id: string
  full_name: string
  username: string | null
  is_owner: boolean
  is_active: boolean
}

type Status = 'unconfigured' | 'loading' | 'signed_out' | 'signed_in'

export interface AuthState {
  status: Status
  session: Session | null
  profile: Profile | null
  outlets: OutletAccess[]
  activeOutlet: OutletAccess | null
  setActiveOutlet: (id: string) => void
  can: (...anyOf: Permission[]) => boolean
  signIn: (identifier: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  reload: () => Promise<void>
  loadError: string | null
}

const AuthContext = createContext<AuthState | null>(null)

const OUTLET_KEY = 'mun-pos:active-outlet'

function readStoredOutlet(userId: string): string | null {
  try {
    return localStorage.getItem(`${OUTLET_KEY}:${userId}`)
  } catch {
    return null
  }
}
function storeOutlet(userId: string, outletId: string) {
  try {
    localStorage.setItem(`${OUTLET_KEY}:${userId}`, outletId)
  } catch {
    /* penyimpanan lokal tidak tersedia — abaikan */
  }
}

export function translateAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Email/username atau kata sandi salah.'
  if (m.includes('email not confirmed')) return 'Email belum dikonfirmasi.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'Tidak dapat terhubung ke server. Periksa koneksi internet.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Terlalu banyak percobaan. Coba lagi beberapa saat.'
  return message
}

export function AuthProvider({
  client,
  staffDomain,
  children,
}: {
  client: SupabaseClient | null
  staffDomain: string
  children: React.ReactNode
}) {
  const [status, setStatus] = useState<Status>(client ? 'loading' : 'unconfigured')
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [outlets, setOutlets] = useState<OutletAccess[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadAccount = useCallback(
    async (s: Session | null) => {
      if (!client) return
      setSession(s)
      if (!s) {
        setProfile(null)
        setOutlets([])
        setActiveId(null)
        setStatus('signed_out')
        return
      }
      setLoadError(null)
      const [p, a] = await Promise.all([
        client.from('profiles').select('id, full_name, username, is_owner, is_active').eq('id', s.user.id).single(),
        client.rpc('my_access'),
      ])
      if (p.error || a.error) {
        setLoadError(translateAuthError((p.error ?? a.error)!.message))
      }
      const list = ((a.data as OutletAccess[] | null) ?? []).slice().sort((x, y) => x.outlet_code.localeCompare(y.outlet_code))
      setProfile((p.data as Profile | null) ?? null)
      setOutlets(list)
      const stored = readStoredOutlet(s.user.id)
      setActiveId(list.find((o) => o.outlet_id === stored)?.outlet_id ?? list[0]?.outlet_id ?? null)
      setStatus('signed_in')
    },
    [client],
  )

  useEffect(() => {
    if (!client) return
    let cancelled = false
    client.auth.getSession().then(({ data }) => {
      if (!cancelled) void loadAccount(data.session)
    })
    const { data } = client.auth.onAuthStateChange((event, s) => {
      // Muat ulang hanya ketika identitas berubah (bukan saat refresh token)
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // jangan memanggil Supabase secara sinkron di dalam callback
        setTimeout(() => void loadAccount(s), 0)
      } else if (s) {
        setSession(s)
      }
    })
    return () => {
      cancelled = true
      data.subscription.unsubscribe()
    }
  }, [client, loadAccount])

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      if (!client) throw new Error('Supabase belum dikonfigurasi')
      const { data, error } = await client.auth.signInWithPassword({
        email: identifierToEmail(identifier, staffDomain),
        password,
      })
      if (error) throw new Error(translateAuthError(error.message))
      await loadAccount(data.session)
    },
    [client, staffDomain, loadAccount],
  )

  const signOut = useCallback(async () => {
    if (!client) return
    await client.auth.signOut()
    await loadAccount(null)
  }, [client, loadAccount])

  const activeOutlet = useMemo(() => outlets.find((o) => o.outlet_id === activeId) ?? null, [outlets, activeId])

  const value = useMemo<AuthState>(
    () => ({
      status,
      session,
      profile,
      outlets,
      activeOutlet,
      loadError,
      setActiveOutlet: (id: string) => {
        if (!outlets.some((o) => o.outlet_id === id)) return
        setActiveId(id)
        if (session) storeOutlet(session.user.id, id)
      },
      can: (...anyOf: Permission[]) => hasPermission(activeOutlet, ...anyOf),
      signIn,
      signOut,
      reload: () => loadAccount(session),
    }),
    [status, session, profile, outlets, activeOutlet, loadError, signIn, signOut, loadAccount],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth harus dipakai di dalam AuthProvider')
  return ctx
}

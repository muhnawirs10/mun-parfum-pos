// =====================================================================
// Edge Function admin-users — VERSI SATU FILE untuk editor Dashboard Supabase
// (dihasilkan otomatis dari handler.ts + index.ts; regenerasi: npm run setup-files)
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

/**
 * Logika Edge Function `admin-users` (tanpa dependensi Deno agar dapat diuji).
 *
 * Aksi:
 *   create_staff   — buat akun Auth + tugaskan ke outlet
 *   reset_password — ganti kata sandi karyawan
 *   set_active     — aktifkan/nonaktifkan akun (owner)
 *
 * Keamanan: setiap aksi lebih dulu diotorisasi oleh fungsi database yang
 * dipanggil SEBAGAI pemanggil (JWT pengguna), sehingga aturan yang sama
 * dengan RLS berlaku. Kunci service_role hanya dipakai untuk Auth Admin API
 * dan hanya ada di lingkungan server Edge Function.
 */

export type Role = 'admin' | 'kasir'

interface RpcResult {
  data: unknown
  error: { message: string; code?: string } | null
}

export interface Deps {
  /** Pengguna dari JWT pada header Authorization (null bila tidak valid). */
  getCaller(): Promise<{ id: string } | null>
  /** Panggil RPC database sebagai pemanggil. */
  callerRpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>
  admin: {
    createUser(attrs: {
      email: string
      password: string
      email_confirm: boolean
      user_metadata: Record<string, unknown>
    }): Promise<{ data: { user: { id: string } | null } | null; error: { message: string; status?: number } | null }>
    deleteUser(id: string): Promise<{ error: unknown }>
    updateUserById(id: string, attrs: Record<string, unknown>): Promise<{ error: { message: string } | null }>
  }
  staffDomain: string
}

export interface Result {
  status: number
  body: Record<string, unknown>
}

const ok = (body: Record<string, unknown> = {}): Result => ({ status: 200, body: { ok: true, ...body } })
const fail = (status: number, error: string): Result => ({ status, body: { ok: false, error } })

const USERNAME_RE = /^[a-z0-9._]{3,32}$/
/** ID aman (UUID divalidasi ketat oleh database melalui tipe uuid). */
const ID_RE = /^[0-9A-Za-z-]{1,64}$/
const PERMISSIONS = [
  'pos.sell', 'transactions.view_all', 'transactions.void', 'products.manage', 'stock.manage', 'cost.view',
  'profit.view', 'reports.view', 'expenses.view', 'expenses.manage', 'closing.perform', 'users.manage',
  'settings.manage', 'audit.view',
]

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function validPassword(p: string | null): string | null {
  if (!p || p.length < 8) return 'Kata sandi minimal 8 karakter'
  if (p.length > 72) return 'Kata sandi maksimal 72 karakter'
  return null
}

function rpcError(e: { message: string; code?: string }): Result {
  return fail(e.code === '42501' ? 403 : 400, e.message)
}

/**
 * Ambil kunci API dari environment Edge Function. Mendukung kunci lama
 * (SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY) dan sistem kunci baru
 * (SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS: JSON objek/array atau teks).
 */
export function pickKey(env: (name: string) => string | undefined, legacy: string, modern: string): string | null {
  const direct = env(legacy)?.trim()
  if (direct) return direct
  const raw = env(modern)?.trim()
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'string') return parsed
    if (Array.isArray(parsed)) return (parsed.find((v) => typeof v === 'string') as string | undefined) ?? null
    if (parsed && typeof parsed === 'object') {
      const o = parsed as Record<string, unknown>
      const v = o.default ?? Object.values(o).find((x) => typeof x === 'string')
      return typeof v === 'string' ? v : null
    }
  } catch {
    return raw
  }
  return null
}

export async function handle(input: unknown, deps: Deps): Promise<Result> {
  const caller = await deps.getCaller()
  if (!caller) return fail(401, 'Sesi login tidak valid. Silakan masuk kembali.')
  if (!input || typeof input !== 'object') return fail(400, 'Permintaan tidak valid')
  const body = input as Record<string, unknown>

  switch (body.action) {
    case 'create_staff': {
      const username = str(body.username)?.trim().toLowerCase() ?? ''
      const fullName = str(body.full_name)?.trim() ?? ''
      const password = str(body.password)
      const outletId = str(body.outlet_id) ?? ''
      const role = body.role
      const permissions = Array.isArray(body.permissions) ? body.permissions : []
      if (!USERNAME_RE.test(username)) return fail(400, 'Username 3–32 karakter: huruf kecil, angka, titik, garis bawah')
      if (fullName.length < 1 || fullName.length > 100) return fail(400, 'Nama wajib diisi (maks. 100 karakter)')
      const pwErr = validPassword(password)
      if (pwErr) return fail(400, pwErr)
      if (!ID_RE.test(outletId)) return fail(400, 'Outlet tidak valid')
      if (role !== 'admin' && role !== 'kasir') return fail(400, 'Peran harus admin atau kasir')
      if (!permissions.every((p) => typeof p === 'string' && PERMISSIONS.includes(p))) return fail(400, 'Izin tidak dikenal')

      // 1) otorisasi sebagai pemanggil
      const can = await deps.callerRpc('can_manage_staff', { p_outlet_id: outletId, p_role: role, p_permissions: permissions })
      if (can.error) return rpcError(can.error)
      if (can.data !== true) return fail(403, 'Akses ditolak: tidak boleh membuat karyawan dengan peran/izin ini')

      // 2) buat akun Auth (service role)
      const created = await deps.admin.createUser({
        email: `${username}@${deps.staffDomain}`,
        password: password!,
        email_confirm: true,
        user_metadata: { full_name: fullName, username },
      })
      if (created.error || !created.data?.user) {
        const msg = created.error?.message ?? ''
        if (/already|registered|exists|duplicate/i.test(msg)) return fail(409, `Username ${username} sudah dipakai`)
        return fail(500, `Gagal membuat akun: ${msg || 'tidak diketahui'}`)
      }
      const userId = created.data.user.id

      // 3) tugaskan ke outlet sebagai pemanggil; bila gagal, batalkan akun
      const assigned = await deps.callerRpc('assign_outlet_user', {
        p_user_id: userId,
        p_outlet_id: outletId,
        p_role: role,
        p_permissions: permissions,
        p_revoked: [],
        p_active: true,
      })
      if (assigned.error) {
        await deps.admin.deleteUser(userId)
        return rpcError(assigned.error)
      }
      return ok({ user_id: userId, username })
    }

    case 'reset_password': {
      const userId = str(body.user_id) ?? ''
      const password = str(body.password)
      if (!ID_RE.test(userId)) return fail(400, 'Pengguna tidak valid')
      const pwErr = validPassword(password)
      if (pwErr) return fail(400, pwErr)
      const can = await deps.callerRpc('can_manage_user', { p_user_id: userId })
      if (can.error) return rpcError(can.error)
      if (can.data !== true) return fail(403, 'Akses ditolak: tidak boleh mengubah akun ini')
      const r = await deps.admin.updateUserById(userId, { password })
      if (r.error) return fail(500, `Gagal mengubah kata sandi: ${r.error.message}`)
      return ok()
    }

    case 'set_active': {
      const userId = str(body.user_id) ?? ''
      if (!ID_RE.test(userId)) return fail(400, 'Pengguna tidak valid')
      if (typeof body.active !== 'boolean') return fail(400, 'Status tidak valid')
      // fungsi DB memeriksa owner & target; akun nonaktif langsung kehilangan akses data
      const r = await deps.callerRpc('set_staff_active', { p_user_id: userId, p_active: body.active })
      if (r.error) return rpcError(r.error)
      // blokir juga login & sesi baru di Auth
      const ban = await deps.admin.updateUserById(userId, { ban_duration: body.active ? 'none' : '876000h' })
      if (ban.error) return fail(500, `Status data diperbarui, tetapi blokir login gagal: ${ban.error.message}`)
      return ok()
    }

    default:
      return fail(400, 'Aksi tidak dikenal')
  }
}

// ── penghubung Deno ──────────────────────────────────────────────────
// Supabase Edge Function (Deno): pengelolaan akun karyawan.
// Deploy: supabase functions deploy admin-users
// Secret yang dibutuhkan (otomatis tersedia di Supabase): SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. Opsional: STAFF_EMAIL_DOMAIN.

// Opsional: batasi asal (origin) yang boleh memanggil, mis.
//   supabase secrets set ALLOWED_ORIGINS="https://pos.munparfum.id"
// Tanpa secret ini semua origin diizinkan (aman karena setiap aksi tetap
// memerlukan JWT pengguna dan diotorisasi database).
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(/[\s,]+/).filter(Boolean)

function corsFor(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  const allow = ALLOWED.length === 0 ? '*' : ALLOWED.includes(origin) ? origin : ALLOWED[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

Deno.serve(async (req) => {
  const cors = corsFor(req)
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Metode tidak diizinkan' })

  const env = (n: string) => Deno.env.get(n)
  const url = env('SUPABASE_URL')!
  const anonKey = pickKey(env, 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS')
  const serviceKey = pickKey(env, 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS')
  if (!url || !anonKey || !serviceKey) {
    return json(500, { ok: false, error: 'Konfigurasi kunci Supabase di Edge Function tidak ditemukan' })
  }
  const authorization = req.headers.get('Authorization') ?? ''

  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json(400, { ok: false, error: 'Body JSON tidak valid' })
  }

  const result = await handle(body, {
    getCaller: async () => (await asCaller.auth.getUser()).data.user,
    callerRpc: async (fn, args) => await asCaller.rpc(fn, args),
    admin: admin.auth.admin,
    staffDomain: Deno.env.get('STAFF_EMAIL_DOMAIN') ?? 'staff.munparfum.local',
  })
  return json(result.status, result.body)
})

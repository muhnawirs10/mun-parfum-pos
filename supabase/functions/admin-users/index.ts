// Supabase Edge Function (Deno): pengelolaan akun karyawan.
// Deploy: supabase functions deploy admin-users
// Secret yang dibutuhkan (otomatis tersedia di Supabase): SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. Opsional: STAFF_EMAIL_DOMAIN.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handle } from './handler.ts'

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

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
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

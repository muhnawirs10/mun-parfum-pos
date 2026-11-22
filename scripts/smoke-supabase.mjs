/**
 * Uji asap terhadap project Supabase SUNGGUHAN — hanya memakai kunci publik.
 * Tidak mengubah data apa pun.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_... node scripts/smoke-supabase.mjs
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_PUBLISHABLE_KEY
if (!url || !key) {
  console.error('Isi SUPABASE_URL dan SUPABASE_PUBLISHABLE_KEY')
  process.exit(2)
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const results = []
const check = (name, ok, info = '') => results.push({ name, ok: !!ok, info })
const denied = (e) => !!e && /permission denied|42501|not allowed|unauthorized|JWT|401|403/i.test(`${e.code} ${e.message} ${e.status ?? ''}`)

// 1. Data tidak bisa dibaca tanpa login
for (const table of ['products', 'transactions', 'profiles', 'outlets', 'expenses', 'audit_logs']) {
  const { data, error } = await sb.from(table).select('id').limit(1)
  check(`anon tidak bisa membaca ${table}`, denied(error) || (Array.isArray(data) && data.length === 0), error ? error.message : `baris: ${data?.length}`)
}
// 2. Fungsi bisnis tidak bisa dipanggil tanpa login
for (const [fn, args] of [
  ['create_sale', { p_outlet_id: '00000000-0000-0000-0000-000000000000', p_items: [], p_payment_method: 'cash', p_amount_received: 0, p_idempotency_key: crypto.randomUUID() }],
  ['get_dashboard', { p_outlet_id: '00000000-0000-0000-0000-000000000000' }],
  ['list_staff', {}],
]) {
  const { error } = await sb.rpc(fn, args)
  check(`anon tidak bisa memanggil ${fn}`, denied(error), error?.message ?? 'TIDAK ADA ERROR')
}
// 3. Auth hidup; kredensial salah ditolak; sign-up publik dimatikan
{
  const { error } = await sb.auth.signInWithPassword({ email: `tidak-ada-${Date.now()}@contoh.invalid`, password: 'salah-sekali-123' })
  check('Auth aktif & menolak kredensial salah', error && /invalid login credentials/i.test(error.message), error?.message)
}
{
  const { error } = await sb.auth.signUp({ email: `uji-${Date.now()}@contoh.invalid`, password: 'percobaan-123456' })
  check('Pendaftaran publik dimatikan', error && /signup|sign up|not allowed|disabled/i.test(error.message), error?.message ?? 'PENDAFTARAN DITERIMA!')
}
// 4. Edge Function admin-users ada & menolak tanpa login
{
  const { error } = await sb.functions.invoke('admin-users', { body: { action: 'create_staff' } })
  const status = error?.context?.status
  let body = ''
  try {
    body = JSON.stringify(await error?.context?.json())
  } catch {
    /* bukan JSON */
  }
  check('Edge Function admin-users ter-deploy & menolak tanpa login', status === 401 || status === 403, `HTTP ${status} ${body}`)
}
// 5. Bucket foto ada (objek tidak ada ≠ bucket tidak ada)
{
  const r = await fetch(`${url}/storage/v1/object/public/product-images/__tidak_ada__.png`)
  const text = await r.text()
  check('Bucket product-images ada', !/bucket not found/i.test(text), `HTTP ${r.status} ${text.slice(0, 80)}`)
}

for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.info ? `  — ${r.info}` : ''}`)
const failed = results.filter((r) => !r.ok).length
console.log(failed ? `\n${failed} pemeriksaan GAGAL` : `\nSemua ${results.length} pemeriksaan lulus`)
process.exit(failed ? 1 : 0)

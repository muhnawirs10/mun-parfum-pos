/**
 * Validasi konfigurasi frontend. Sengaja tanpa zod agar pustaka validasi
 * tidak ikut dimuat di awal (zod tetap dipakai di form, dimuat per halaman).
 */
export interface Env {
  VITE_SUPABASE_URL: string
  VITE_SUPABASE_ANON_KEY: string
  VITE_STAFF_EMAIL_DOMAIN: string
}

type ParseResult = { success: true; data: Env } | { success: false; issues: string[] }

export function parseEnv(raw: Record<string, unknown>): ParseResult {
  const issues: string[] = []
  const url = typeof raw.VITE_SUPABASE_URL === 'string' ? raw.VITE_SUPABASE_URL.trim() : ''
  const key = typeof raw.VITE_SUPABASE_ANON_KEY === 'string' ? raw.VITE_SUPABASE_ANON_KEY.trim() : ''
  const domain = typeof raw.VITE_STAFF_EMAIL_DOMAIN === 'string' && raw.VITE_STAFF_EMAIL_DOMAIN.trim() ? raw.VITE_STAFF_EMAIL_DOMAIN.trim() : 'staff.munparfum.local'
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error()
  } catch {
    issues.push('VITE_SUPABASE_URL harus berupa URL')
  }
  if (key.length < 20) issues.push('VITE_SUPABASE_ANON_KEY belum diisi')
  if (domain.length < 3) issues.push('VITE_STAFF_EMAIL_DOMAIN tidak valid')
  return issues.length
    ? { success: false, issues }
    : { success: true, data: { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key, VITE_STAFF_EMAIL_DOMAIN: domain } }
}

const parsed = parseEnv(import.meta.env)

/** `null` jika konfigurasi belum lengkap — UI menampilkan layar setup. */
export const env: Env | null = parsed.success ? parsed.data : null
export const envError: string | null = parsed.success ? null : parsed.issues.join('; ')

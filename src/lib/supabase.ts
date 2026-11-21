import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env'

/**
 * Klien Supabase untuk frontend. HANYA memakai anon key.
 * service_role key tidak boleh pernah berada di kode frontend.
 */
export const supabase: SupabaseClient | null = env
  ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi. Isi file .env terlebih dahulu.')
  return supabase
}

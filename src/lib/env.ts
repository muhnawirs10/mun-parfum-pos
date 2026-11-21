import { z } from 'zod'

const envSchema = z.object({
  VITE_SUPABASE_URL: z.string().url('VITE_SUPABASE_URL harus berupa URL'),
  VITE_SUPABASE_ANON_KEY: z.string().min(20, 'VITE_SUPABASE_ANON_KEY belum diisi'),
  VITE_STAFF_EMAIL_DOMAIN: z.string().min(3).default('staff.munparfum.local'),
})

export type Env = z.infer<typeof envSchema>

export function parseEnv(raw: Record<string, unknown>) {
  return envSchema.safeParse(raw)
}

const parsed = parseEnv(import.meta.env)

/** `null` jika konfigurasi belum lengkap — UI menampilkan layar setup. */
export const env: Env | null = parsed.success ? parsed.data : null
export const envError: string | null = parsed.success
  ? null
  : parsed.error.issues.map((i) => i.message).join('; ')

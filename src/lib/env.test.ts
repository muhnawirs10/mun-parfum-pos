import { parseEnv } from './env'

describe('validasi env', () => {
  it('menolak konfigurasi kosong / URL tidak valid', () => {
    expect(parseEnv({}).success).toBe(false)
    expect(parseEnv({ VITE_SUPABASE_URL: 'bukan-url', VITE_SUPABASE_ANON_KEY: 'x'.repeat(30) })).toEqual({
      success: false,
      issues: ['VITE_SUPABASE_URL harus berupa URL'],
    })
  })
  it('menerima konfigurasi lengkap dengan domain staf bawaan', () => {
    const r = parseEnv({
      VITE_SUPABASE_URL: 'https://abc.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.x',
    })
    expect(r).toEqual({
      success: true,
      data: { VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.x', VITE_STAFF_EMAIL_DOMAIN: 'staff.munparfum.local' },
    })
  })
})

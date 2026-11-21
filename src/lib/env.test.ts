import { parseEnv } from './env'

describe('validasi env', () => {
  it('menolak konfigurasi kosong', () => {
    expect(parseEnv({}).success).toBe(false)
  })
  it('menerima konfigurasi lengkap', () => {
    const r = parseEnv({
      VITE_SUPABASE_URL: 'https://abc.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.x',
    })
    expect(r.success).toBe(true)
  })
})

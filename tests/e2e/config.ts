export const SHIM_PORT = 54400
const base = new URL(process.env.DATABASE_URL ?? 'postgres://postgres@localhost:54329/postgres')
base.pathname = '/mun_pos_e2e'
export const E2E_DB_URL = base.toString()

export const USERS = {
  owner: { email: 'owner@munparfum.id', login: 'owner@munparfum.id', password: 'rahasia123' },
  kasirMks: { email: 'kasirmks@staff.munparfum.local', login: 'kasirmks', password: 'rahasiaMks1' },
  // dibuat lewat UI di tes
  kasirBaru: { login: 'kasir.tkl', password: 'kasirTkl#2026', name: 'Kasir Takalar' },
}

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { startShim } from './shim/server'
import { E2E_DB_URL, SHIM_PORT, USERS } from './config'

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:54329/postgres'

export default async function globalSetup() {
  // 1. Database baru dari migration asli
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect()
  await admin.query('drop database if exists mun_pos_e2e with (force)')
  await admin.query('create database mun_pos_e2e')
  await admin.end()

  const db = new pg.Client({ connectionString: E2E_DB_URL })
  await db.connect()
  const root = process.cwd() // Playwright dijalankan dari akar proyek
  await db.query(readFileSync(path.join(root, 'tests/db/supabase-stub.sql'), 'utf8'))
  const dir = path.join(root, 'supabase/migrations')
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.query(readFileSync(path.join(dir, f), 'utf8'))
  }

  // 2. Data awal: owner + outlet TKL, outlet MKS + kasir & produknya
  const addUser = async (email: string, meta: Record<string, string>) =>
    (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, JSON.stringify(meta)])).rows[0].id as string
  await addUser(USERS.owner.email, { full_name: 'Nawir', username: 'nawir08' })
  await db.query(`select private.bootstrap_owner($1, 'TKL', 'MUN Parfum Takalar', 'Takalar')`, [USERS.owner.email])
  await db.query(`update public.outlets set phone = '0812-3456-7890', address = 'Jl. Poros Takalar No. 8' where code = 'TKL'`)
  const { rows: [mks] } = await db.query(`insert into public.outlets (code, name, address) values ('MKS', 'MUN Parfum Makassar', 'Makassar') returning id`)
  const kasirMks = await addUser(USERS.kasirMks.email, { full_name: 'Kasir Makassar', username: 'kasirmks' })
  await db.query(`insert into public.outlet_users (outlet_id, user_id, role) values ($1, $2, 'kasir')`, [mks.id, kasirMks])
  await db.query(`insert into public.products (outlet_id, sku, name, unit, sell_price, cost_price) values ($1, 'MKS-0001', 'PRODUK KHUSUS MAKASSAR', 'ML', 2500, 1200)`, [mks.id])
  await db.query(`select private.apply_stock_change((select id from public.products where sku = 'MKS-0001'), 100, 'initial', 'seed')`)
  await db.query(`insert into public.categories (outlet_id, name) select id, 'PARFUM' from public.outlets where code = 'TKL'`)
  await db.end()

  // 3. Server tiruan Supabase
  const shim = await startShim(E2E_DB_URL, SHIM_PORT)
  shim.state.passwords.set(USERS.owner.email, USERS.owner.password)
  shim.state.passwords.set(USERS.kasirMks.email, USERS.kasirMks.password)

  return async () => {
    await shim.close()
  }
}

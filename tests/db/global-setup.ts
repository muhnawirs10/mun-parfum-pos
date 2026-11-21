import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:54329/postgres'
export const TEST_DB = 'mun_pos_test'

export default async function setup() {
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect()
  await admin.query(`drop database if exists ${TEST_DB} with (force)`)
  await admin.query(`create database ${TEST_DB}`)
  await admin.end()

  const url = new URL(ADMIN_URL)
  url.pathname = `/${TEST_DB}`
  process.env.TEST_DATABASE_URL = url.toString()

  const db = new pg.Client({ connectionString: url.toString() })
  await db.connect()
  const root = path.resolve(__dirname, '../..')
  await db.query(readFileSync(path.join(root, 'tests/db/supabase-stub.sql'), 'utf8'))
  const dir = path.join(root, 'supabase/migrations')
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.query(readFileSync(path.join(dir, f), 'utf8'))
    } catch (e) {
      throw new Error(`Migration ${f} gagal: ${(e as Error).message}`)
    }
  }
  await db.end()
  return () => {}
}

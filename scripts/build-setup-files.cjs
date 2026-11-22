/**
 * Menghasilkan file siap-tempel untuk setup lewat Dashboard Supabase:
 *   supabase/setup.sql                              (semua migration, berurutan)
 *   supabase/functions/admin-users/standalone.ts    (Edge Function satu file)
 * Jalankan: npm run setup-files   — tes unit memastikan file selalu sinkron.
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const migDir = path.join(root, 'supabase', 'migrations')

function setupSql() {
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
  const parts = [
    '-- =====================================================================',
    '-- MUN PARFUM POS — SETUP DATABASE LENGKAP (dihasilkan otomatis, jangan diedit)',
    '-- Sumber: supabase/migrations/*.sql — regenerasi: npm run setup-files',
    '--',
    '-- Cara pakai: Supabase Dashboard → SQL Editor → New query → tempel SELURUH',
    '-- isi file ini → Run. Jalankan SEKALI pada project baru yang masih kosong.',
    '-- =====================================================================',
    '',
  ]
  for (const f of files) {
    parts.push(`-- ┌──────────────────────────────────────────────────────────────────`)
    parts.push(`-- │ ${f}`)
    parts.push(`-- └──────────────────────────────────────────────────────────────────`)
    parts.push(fs.readFileSync(path.join(migDir, f), 'utf8').trimEnd(), '')
  }
  return parts.join('\n') + '\n'
}

function standaloneFunction() {
  const fnDir = path.join(root, 'supabase', 'functions', 'admin-users')
  const handler = fs.readFileSync(path.join(fnDir, 'handler.ts'), 'utf8')
  const index = fs
    .readFileSync(path.join(fnDir, 'index.ts'), 'utf8')
    .replace(/^import \{ handle \} from '\.\/handler\.ts'\n/m, '')
    .replace(/^import \{ createClient \} from 'npm:@supabase\/supabase-js@2'\n/m, '')
  return [
    '// =====================================================================',
    '// Edge Function admin-users — VERSI SATU FILE untuk editor Dashboard Supabase',
    '// (dihasilkan otomatis dari handler.ts + index.ts; regenerasi: npm run setup-files)',
    '// =====================================================================',
    "import { createClient } from 'npm:@supabase/supabase-js@2'",
    '',
    handler.trimEnd(),
    '',
    '// ── penghubung Deno ──────────────────────────────────────────────────',
    index.trimEnd(),
    '',
  ].join('\n')
}

module.exports = { setupSql, standaloneFunction }

if (require.main === module) {
  fs.writeFileSync(path.join(root, 'supabase', 'setup.sql'), setupSql())
  fs.writeFileSync(path.join(root, 'supabase', 'functions', 'admin-users', 'standalone.ts'), standaloneFunction())
  console.log('supabase/setup.sql & supabase/functions/admin-users/standalone.ts diperbarui')
}

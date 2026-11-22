// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const gen = require('../../scripts/build-setup-files.cjs') as { setupSql: () => string; standaloneFunction: () => string }

describe('file setup Dashboard', () => {
  it('supabase/setup.sql sinkron dengan supabase/migrations (jalankan: npm run setup-files)', () => {
    expect(readFileSync('supabase/setup.sql', 'utf8')).toBe(gen.setupSql())
  })
  it('standalone.ts sinkron dengan handler.ts + index.ts', () => {
    const s = readFileSync('supabase/functions/admin-users/standalone.ts', 'utf8')
    expect(s).toBe(gen.standaloneFunction())
    expect(s.match(/^import /gm)).toHaveLength(1)
    expect(s).not.toMatch(/from '\.\/handler/)
  })
})

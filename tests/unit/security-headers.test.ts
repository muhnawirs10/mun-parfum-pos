// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sh = require('../../scripts/security-headers.cjs') as {
  csp: (extra?: string[]) => string
  headers: () => Record<string, string>
  vercelJson: () => unknown
  netlifyHeaders: () => string
}

describe('header keamanan', () => {
  it('vercel.json dan public/_headers sinkron dengan scripts/security-headers.cjs', () => {
    expect(JSON.parse(readFileSync('vercel.json', 'utf8'))).toEqual(sh.vercelJson())
    expect(readFileSync('public/_headers', 'utf8')).toBe(sh.netlifyHeaders())
  })
  it('CSP ketat: tanpa unsafe-eval/unsafe-inline script, tanpa frame, object dilarang', () => {
    const c = sh.csp()
    expect(c).toContain("script-src 'self'")
    expect(c).not.toMatch(/unsafe-eval/)
    expect(c).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect(c).toContain("frame-ancestors 'none'")
    expect(c).toContain("object-src 'none'")
    expect(c).toContain('connect-src \'self\' https://*.supabase.co wss://*.supabase.co')
    expect(sh.headers()['X-Content-Type-Options']).toBe('nosniff')
  })
})

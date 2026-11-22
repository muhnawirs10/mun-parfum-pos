/**
 * SATU SUMBER header keamanan HTTP untuk produksi & preview.
 * `node scripts/security-headers.cjs` menulis ulang vercel.json dan
 * public/_headers (Netlify / Cloudflare Pages). Tes unit memastikan file
 * tersebut selalu sinkron dengan sumber ini.
 */
const fs = require('fs')
const path = require('path')

/** @param {string[]} extraConnect asal tambahan untuk connect-src (mis. server E2E lokal) */
function csp(extraConnect = []) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    // Radix UI, sonner, dan jsPDF memakai atribut style inline
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co",
    "font-src 'self' data:",
    ['connect-src', "'self'", 'https://*.supabase.co', 'wss://*.supabase.co', ...extraConnect].join(' '),
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

function headers(extraConnect = []) {
  return {
    'Content-Security-Policy': csp(extraConnect),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  }
}

const NO_CACHE = 'no-cache'
const IMMUTABLE = 'public, max-age=31536000, immutable'

function vercelJson() {
  const h = headers()
  return {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    rewrites: [{ source: '/((?!assets/|icons/|sw.js|workbox-|manifest.webmanifest|favicon).*)', destination: '/index.html' }],
    headers: [
      { source: '/(.*)', headers: Object.entries(h).map(([key, value]) => ({ key, value })) },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: NO_CACHE }] },
      { source: '/index.html', headers: [{ key: 'Cache-Control', value: NO_CACHE }] },
      { source: '/manifest.webmanifest', headers: [{ key: 'Cache-Control', value: NO_CACHE }] },
      { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: IMMUTABLE }] },
    ],
  }
}

function netlifyHeaders() {
  const lines = ['# Dihasilkan oleh scripts/security-headers.cjs — jangan diedit manual', '/*']
  for (const [k, v] of Object.entries(headers())) lines.push(`  ${k}: ${v}`)
  lines.push('/sw.js', `  Cache-Control: ${NO_CACHE}`, '/index.html', `  Cache-Control: ${NO_CACHE}`, '/manifest.webmanifest', `  Cache-Control: ${NO_CACHE}`, '/assets/*', `  Cache-Control: ${IMMUTABLE}`)
  return lines.join('\n') + '\n'
}

module.exports = { csp, headers, vercelJson, netlifyHeaders }

if (require.main === module) {
  const root = path.join(__dirname, '..')
  fs.writeFileSync(path.join(root, 'vercel.json'), JSON.stringify(vercelJson(), null, 2) + '\n')
  fs.writeFileSync(path.join(root, 'public', '_headers'), netlifyHeaders())
  fs.writeFileSync(path.join(root, 'public', '_redirects'), '/* /index.html 200\n')
  console.log('vercel.json, public/_headers, public/_redirects diperbarui')
}

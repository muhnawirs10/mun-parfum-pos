/**
 * Memastikan hasil build frontend (dist/) tidak memuat rahasia.
 * Jalankan setelah `npm run build`: node scripts/check-bundle-secrets.cjs
 */
const fs = require('fs')
const path = require('path')

const dir = process.argv[2] ?? path.join(__dirname, '..', 'dist')
const forbidden = [
  /service_role/i,
  /SUPABASE_SERVICE_ROLE_KEY/,
  /sb_secret_[A-Za-z0-9]/, // format kunci rahasia Supabase baru
  // JWT dengan klaim role service_role (base64 dari '"role":"service_role"')
  /InJvbGUiOiJzZXJ2aWNlX3JvbGUi/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]

const files = []
;(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f)
    if (fs.statSync(p).isDirectory()) walk(p)
    else if (/\.(js|html|json|webmanifest|css|map)$/.test(f)) files.push(p)
  }
})(dir)

let bad = 0
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8')
  for (const re of forbidden) {
    if (re.test(text)) {
      console.error(`✗ ${path.relative(dir, f)} memuat pola terlarang ${re}`)
      bad++
    }
  }
}
console.log(bad ? `\n${bad} temuan rahasia di bundle!` : `✓ ${files.length} file bundle diperiksa: tidak ada rahasia`)
process.exit(bad ? 1 : 0)

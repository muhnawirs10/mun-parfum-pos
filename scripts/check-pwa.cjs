/**
 * Pemeriksaan PWA di Chromium terhadap build produksi.
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/check-pwa.cjs http://localhost:4173
 * Keluar dengan kode 1 bila ada pemeriksaan yang gagal.
 */
const { chromium } = require('playwright')

const BASE = process.argv[2] ?? 'http://localhost:4173'
const results = []
const check = (name, ok, info = '') => results.push({ name, ok: !!ok, info })

;(async () => {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy
  const browser = await chromium.launch(proxy ? { proxy: { server: proxy } } : {})
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))

  await page.goto(BASE + '/masuk', { waitUntil: 'networkidle' })

  // 1. Manifest
  const href = await page.getAttribute('link[rel="manifest"]', 'href')
  check('link manifest ada', href, href)
  const manifest = await (await page.request.get(new URL(href, BASE).toString())).json()
  check('manifest: nama & standalone', manifest.name === 'MUN PARFUM POS' && manifest.display === 'standalone', `${manifest.name} / ${manifest.display}`)
  check('manifest: start_url & lang', manifest.start_url === '/' && manifest.lang === 'id')
  check(
    'manifest: ikon 192, 512, maskable',
    ['192x192', '512x512'].every((s) => manifest.icons.some((i) => i.sizes === s)) && manifest.icons.some((i) => i.purpose === 'maskable'),
  )
  for (const icon of manifest.icons) {
    const r = await page.request.get(new URL(icon.src, BASE).toString())
    check(`ikon ${icon.src} dapat diunduh`, r.ok() && r.headers()['content-type'].includes('png'))
  }
  check(
    'apple-touch-icon & splash iOS',
    (await page.$('link[rel="apple-touch-icon"]')) && (await page.$$('link[rel="apple-touch-startup-image"]')).length >= 3,
  )

  // 2. Service worker
  // di jaringan sungguhan, precache bisa butuh beberapa detik sebelum SW 'activated'
  await page
    .waitForFunction(async () => (await navigator.serviceWorker.ready).active?.state === 'activated', null, { timeout: 30000 })
    .catch(() => {})
  const swState = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    return reg.active ? reg.active.state : null
  })
  check('service worker aktif', swState === 'activated', swState)
  await page.reload({ waitUntil: 'networkidle' })
  check('halaman dikendalikan service worker', await page.evaluate(() => !!navigator.serviceWorker.controller))

  // 3. Installability menurut Chrome
  const cdp = await ctx.newCDPSession(page)
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
  check('Chrome: dapat diinstal (tanpa installability error)', installabilityErrors.length === 0, JSON.stringify(installabilityErrors))
  // sesi CDP tambahan mengganggu emulasi navigator.onLine milik Playwright
  await cdp.detach()

  // error console hanya dinilai saat online (saat offline kegagalan jaringan memang diharapkan)
  check('tanpa error console (online)', consoleErrors.length === 0, consoleErrors.join(' | '))

  // 4. Offline: shell aplikasi dimuat dari cache
  await ctx.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#root > *', { timeout: 10000 })
  await page.waitForSelector('[role=alert]', { timeout: 5000 }).catch(() => {})
  await page.waitForSelector('text=Masuk untuk mulai berjualan', { timeout: 5000 }).catch(() => {})
  const text = await page.textContent('body')
  check('offline: aplikasi tetap terbuka dari cache', text.includes('MUN PARFUM POS'))
  check('offline: indikator offline tampil', text.includes('Tidak ada koneksi internet'), text.slice(0, 160))

  // 5. API tidak pernah dilayani dari cache
  const apiFromCache = await page.evaluate(async () => {
    try {
      await fetch('/rest/v1/products')
      return 'berhasil (salah!)'
    } catch {
      return 'gagal saat offline (benar)'
    }
  })
  check('offline: permintaan API tidak dilayani cache', apiFromCache.startsWith('gagal'), apiFromCache)
  await ctx.setOffline(false)

  await browser.close()

  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.info && !r.ok ? ' — ' + r.info : ''}`)
  const failed = results.filter((r) => !r.ok).length
  console.log(failed ? `\n${failed} pemeriksaan GAGAL` : `\nSemua ${results.length} pemeriksaan PWA lulus`)
  process.exit(failed ? 1 : 0)
})()

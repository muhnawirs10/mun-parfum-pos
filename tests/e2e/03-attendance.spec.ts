import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import QRCode from 'qrcode'
import { USERS } from './config'
import { login, selectOutlet, sql, watchCsp } from './helpers'

/** SHOTS=<folder> → simpan screenshot tampilan HP (dokumentasi). */
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` })
}

// Titik toko Makassar & geser N meter ke utara
const STORE = { latitude: -5.1477, longitude: 119.4327 }
const north = (m: number, accuracy = 6) => ({ latitude: STORE.latitude + m / 111195, longitude: STORE.longitude, accuracy })

/**
 * Kamera palsu: kamera belakang menampilkan gambar QR, kamera depan
 * menampilkan "wajah" (kotak warna). Dipasang sebelum skrip aplikasi.
 */
async function fakeCamera(ctx: BrowserContext, qrDataUrl: string | null) {
  await ctx.addInitScript((qr) => {
    const img = new Image()
    if (qr) img.src = qr
    navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
      const facing = JSON.stringify((c?.video as MediaTrackConstraints | undefined)?.facingMode ?? '')
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 480
      const ctx2 = canvas.getContext('2d')!
      const draw = () => {
        ctx2.fillStyle = '#fff'
        ctx2.fillRect(0, 0, 640, 480)
        if (facing.includes('environment') && qr && img.complete) ctx2.drawImage(img, 160, 80, 320, 320)
        else {
          ctx2.fillStyle = '#F5C518'
          ctx2.beginPath()
          ctx2.arc(320, 240, 150, 0, Math.PI * 2)
          ctx2.fill()
        }
      }
      draw()
      setInterval(draw, 100)
      return canvas.captureStream(10)
    }
  }, qrDataUrl)
}

async function newPhone(browser: Browser, geo: { latitude: number; longitude: number; accuracy: number }, qr: string | null) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 860 },
    geolocation: geo,
    permissions: ['geolocation'],
    locale: 'id-ID',
    timezoneId: 'Asia/Makassar',
    serviceWorkers: 'block',
  })
  await fakeCamera(ctx, qr)
  const page = await ctx.newPage()
  return { ctx, page }
}

async function qrFor(code: string) {
  const [o] = await sql(`select id, attendance_token from public.outlets where code = $1`, [code])
  const url = `http://localhost:4174/absen?o=${o.id}&t=${o.attendance_token}`
  return { url, dataUrl: await QRCode.toDataURL(url, { width: 512, margin: 2 }) }
}

test.describe.serial('Absensi: QR toko + GPS ≤ 10 m + selfie + satu HP', () => {
  let owner: { ctx: BrowserContext; page: Page }
  let kasir: { ctx: BrowserContext; page: Page }
  let csp: string[] = []

  test.afterAll(async () => {
    await owner?.ctx.close()
    await kasir?.ctx.close()
  })

  test('pemilik mengatur lokasi toko dari GPS & melihat QR', async ({ browser }) => {
    owner = await newPhone(browser, north(0, 5), null)
    csp = watchCsp(owner.page)
    await login(owner.page, USERS.owner.login, USERS.owner.password)
    await selectOutlet(owner.page, 'MKS')
    await owner.page.goto('/absensi')
    await expect(owner.page.getByText('Lokasi toko belum diatur')).toBeVisible()
    await owner.page.getByRole('tab', { name: /Atur/ }).click()
    await owner.page.getByRole('button', { name: 'Gunakan posisi saya sekarang' }).click()
    await expect(owner.page.getByText(/Lokasi toko disimpan/)).toBeVisible()
    await expect(owner.page.getByTestId('store-location')).toContainText('-5.147700, 119.432700')
    await expect(owner.page.getByTestId('qr-image')).toBeVisible()
    await shot(owner.page, '1-pengaturan')
    const [o] = await sql(`select latitude, longitude from public.outlets where code = 'MKS'`)
    expect(o).toEqual({ latitude: STORE.latitude, longitude: STORE.longitude })
    // jam masuk 00:00 tanpa toleransi → absen hari ini pasti tercatat terlambat
    await owner.page.getByLabel('Jam masuk').fill('00:00')
    await owner.page.getByLabel('Toleransi (menit)').fill('0')
    await owner.page.getByRole('button', { name: 'Simpan jam kerja' }).click()
    await expect(owner.page.getByText('Jam kerja disimpan')).toBeVisible()
    // unduh QR untuk dicetak
    const dl = owner.page.waitForEvent('download')
    await owner.page.getByRole('button', { name: /Unduh QR/ }).click()
    expect((await dl).suggestedFilename()).toBe('qr-absensi-MKS.pdf')
  })

  test('kasir absen masuk di toko (3 m): scan QR → selfie → tercatat dengan foto', async ({ browser }) => {
    kasir = await newPhone(browser, north(3), (await qrFor('MKS')).dataUrl)
    const kcsp = watchCsp(kasir.page)
    await login(kasir.page, USERS.kasirMks.login, USERS.kasirMks.password)
    await kasir.page.goto('/absensi')
    await kasir.page.getByRole('button', { name: 'Absen masuk' }).click()
    const d = kasir.page.getByRole('dialog', { name: 'Absen masuk' })
    // QR terbaca otomatis dari kamera → langkah selfie
    await expect(d.getByTestId('gps-status')).toContainText('siap', { timeout: 20_000 })
    await shot(kasir.page, '2-selfie')
    await d.getByRole('button', { name: /Ambil selfie/ }).click()
    await expect(d.getByTestId('check-result')).toContainText('Absen masuk berhasil')
    await expect(d.getByTestId('check-result')).toContainText(/Terlambat \d+ menit/)
    await shot(kasir.page, '3-berhasil')
    await d.getByRole('button', { name: 'Selesai' }).click()
    await expect(kasir.page.getByTestId('time-masuk')).not.toContainText('—')

    const [r] = await sql(
      `select r.check_in_distance_m, r.check_in_photo_path, r.late_minutes > 0 as late,
              exists (select 1 from storage.objects o where o.name = r.check_in_photo_path) as photo_saved
       from public.attendance_records r join public.profiles p on p.id = r.user_id where p.username = 'kasirmks'`,
    )
    expect(Number(r.check_in_distance_m)).toBeCloseTo(3, 0)
    expect(r.late).toBe(true)
    expect(r.photo_saved).toBe(true)
    const [dev] = await sql(`select status, label from public.attendance_devices d join public.profiles p on p.id = d.user_id where p.username = 'kasirmks'`)
    expect(dev.status).toBe('approved')
    expect(kcsp, 'pelanggaran CSP').toEqual([])
  })

  test('absen pulang dari 30 m ditolak & dicatat; dari dalam toko berhasil', async () => {
    await kasir.ctx.setGeolocation(north(30))
    await kasir.page.getByRole('button', { name: 'Absen pulang' }).click()
    const d = kasir.page.getByRole('dialog', { name: 'Absen pulang' })
    await expect(d.getByTestId('gps-status')).toContainText('siap', { timeout: 20_000 })
    await d.getByRole('button', { name: /Ambil selfie/ }).click()
    await expect(d.getByTestId('check-result')).toContainText('Absen ditolak')
    await expect(d.getByTestId('check-result')).toContainText(/Anda berada 30 m dari toko \(maks\. 10 m\)/)
    await shot(kasir.page, '4-ditolak-30m')
    const [a] = await sql(`select reason, round(distance_m)::int d from public.attendance_attempts order by created_at desc limit 1`)
    expect(a).toEqual({ reason: 'TOO_FAR', d: 30 })

    await kasir.ctx.setGeolocation(north(2))
    await d.getByRole('button', { name: 'Coba lagi' }).click()
    await expect(d.getByTestId('gps-status')).toContainText('siap', { timeout: 20_000 })
    await d.getByRole('button', { name: /Ambil selfie/ }).click()
    await expect(d.getByTestId('check-result')).toContainText('Absen pulang berhasil')
    await d.getByRole('button', { name: 'Selesai' }).click()
    await expect(kasir.page.getByText('Absensi hari ini selesai')).toBeVisible()
  })

  test('HP kedua untuk akun yang sama perlu persetujuan pemilik', async ({ browser }) => {
    const hp2 = await newPhone(browser, north(1), (await qrFor('MKS')).dataUrl)
    await login(hp2.page, USERS.kasirMks.login, USERS.kasirMks.password)
    await hp2.page.goto('/absensi')
    await expect(hp2.page.getByText('Akun Anda sudah terdaftar di HP lain')).toBeVisible()
    await hp2.ctx.close()
  })

  test('kasir mengajukan izin sakit → pemilik menyetujui', async () => {
    await kasir.page.getByRole('tab', { name: /Izin/ }).click()
    await kasir.page.getByRole('button', { name: 'Ajukan izin' }).click()
    const d = kasir.page.getByRole('dialog', { name: 'Ajukan izin' })
    await d.getByLabel('Jenis').selectOption('sakit')
    await d.getByLabel('Alasan').fill('Demam, ada surat dokter')
    await d.getByRole('button', { name: 'Kirim pengajuan' }).click()
    await expect(kasir.page.getByText('Pengajuan izin terkirim')).toBeVisible()
    await expect(kasir.page.getByTestId('leave-row')).toContainText('Menunggu')

    await owner.page.goto('/absensi')
    await owner.page.getByRole('tab', { name: /Izin/ }).click()
    const row = owner.page.getByTestId('leave-row').filter({ hasText: 'Kasir Makassar' })
    await row.getByRole('button', { name: 'Setujui' }).click()
    await expect(row).toContainText('Disetujui')
    const [l] = await sql(`select status, leave_type from public.leave_requests`)
    expect(l).toEqual({ status: 'approved', leave_type: 'sakit' })
  })

  test('rekap pemilik: hadir terlambat, selfie dapat dilihat, percobaan ditolak, export Excel', async () => {
    await owner.page.getByRole('tab', { name: /Rekap/ }).click()
    const emp = owner.page.getByTestId('recap-employee').filter({ hasText: 'Kasir Makassar' })
    await expect(emp).toBeVisible()
    await expect(owner.page.getByTestId('attempts')).toContainText('Di luar radius')
    await shot(owner.page, '5-rekap')
    await emp.getByRole('button', { name: /Terlambat$/ }).click()
    const d = owner.page.getByRole('dialog', { name: 'Kasir Makassar' })
    const selfie = d.getByRole('img', { name: 'Selfie masuk' })
    await expect(selfie).toBeVisible()
    await expect.poll(() => selfie.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)
    await owner.page.keyboard.press('Escape')
    const dl = owner.page.waitForEvent('download')
    await owner.page.getByRole('button', { name: 'Excel' }).click()
    expect((await dl).suggestedFilename()).toMatch(/^absensi_\d{4}-\d{2}-01_sd_\d{4}-\d{2}-\d{2}\.xlsx$|^absensi_\d{4}-\d{2}-01\.xlsx$/)
  })

  test('QR dipindai kamera bawaan HP (tautan /absen) langsung membuka langkah selfie', async () => {
    const { url } = await qrFor('MKS')
    await owner.page.goto(url.replace('http://localhost:4174', ''))
    const d = owner.page.getByRole('dialog', { name: 'Absen masuk' })
    await expect(d.getByTestId('gps-status')).toContainText('siap', { timeout: 20_000 })
    await expect(owner.page).toHaveURL(/\/absen$/)
    await d.getByRole('button', { name: /Ambil selfie/ }).click()
    await expect(d.getByTestId('check-result')).toContainText('Absen masuk berhasil')
    expect(csp, 'pelanggaran CSP').toEqual([])
  })

  test('kasir tidak dapat membaca token QR atau memalsukan absen lewat API', async () => {
    const [{ n }] = await sql(`select count(*)::int n from public.attendance_records`)
    expect(n).toBe(2)
    // token tidak ikut terkirim ke browser karyawan
    const leaked = await kasir.page.evaluate(async () => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))!
      const token = JSON.parse(localStorage.getItem(key)!).access_token
      const r = await fetch('http://localhost:54400/rest/v1/outlets?select=attendance_token', { headers: { Authorization: `Bearer ${token}` } })
      return r.status
    })
    expect(leaked).not.toBe(200)
  })
})

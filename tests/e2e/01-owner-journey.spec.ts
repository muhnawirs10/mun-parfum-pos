import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { USERS } from './config'
import { login, selectOutlet, sql, todayWita } from './helpers'

/**
 * Perjalanan pemilik toko dari awal sampai akhir. Berjalan berurutan pada satu
 * database; setiap langkah diverifikasi di UI dan langsung di database.
 */
test.describe.serial('Perjalanan pemilik: produk → stok → kasir → laporan → karyawan', () => {
  let page: import('@playwright/test').Page

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    await login(page, USERS.owner.login, USERS.owner.password)
    await selectOutlet(page, 'TKL') // default: outlet pertama menurut kode (MKS)
  })
  test.afterAll(async () => page.close())

  const stock = async () => (await sql(`select current_stock from public.products where sku = 'TKL-0001'`))[0]?.current_stock

  test('1. tambah produk VALENTINE / SCANDALOUS (Rp2.000/ml, HPP Rp1.014, stok 307 ml)', async () => {
    await page.goto('/produk')
    await page.getByRole('button', { name: 'Tambah', exact: true }).click()
    const d = page.getByRole('dialog', { name: 'Tambah Produk' })
    await d.getByLabel('Nama produk').fill('VALENTINE / SCANDALOUS')
    await d.getByLabel('Kategori').selectOption({ label: 'PARFUM' })
    await d.getByLabel(/Harga jual/).fill('2.000')
    await d.getByLabel(/HPP/).fill('1.014')
    await d.getByLabel(/Stok awal/).fill('307')
    await d.getByLabel(/Stok minimum/).fill('50')
    await d.getByRole('button', { name: /Simpan/ }).click()
    await expect(d).toBeHidden()
    await expect(page.getByText('SKU: TKL-0001')).toBeVisible()
    await expect(page.getByText('HPP: Rp1.014')).toBeVisible()

    const [p] = await sql(`select name, sell_price, cost_price, current_stock, unit from public.products where sku = 'TKL-0001'`)
    expect(p).toEqual({ name: 'VALENTINE / SCANDALOUS', sell_price: '2000.00', cost_price: '1014.00', current_stock: '307.000', unit: 'ML' })
    const mv = await sql(`select movement_type, quantity from public.stock_movements m join public.products p on p.id = m.product_id where p.sku = 'TKL-0001'`)
    expect(mv).toEqual([{ movement_type: 'initial', quantity: '307.000' }])
  })

  test('2. stok masuk & keluar tercatat di riwayat', async () => {
    await page.goto('/stok')
    await page.getByRole('button', { name: 'Stok masuk VALENTINE / SCANDALOUS' }).click()
    let d = page.getByRole('dialog', { name: 'Penyesuaian Stok' })
    await d.getByLabel(/Jumlah/).fill('10')
    await expect(d.getByTestId('stock-after')).toHaveText('317 ml')
    await d.getByRole('button', { name: 'Restock supplier' }).click()
    await d.getByRole('button', { name: /Simpan/ }).click()
    await expect(d).toBeHidden()
    expect(await stock()).toBe('317.000')

    await page.getByRole('button', { name: 'Stok keluar VALENTINE / SCANDALOUS' }).click()
    d = page.getByRole('dialog', { name: 'Penyesuaian Stok' })
    await d.getByLabel(/Jumlah/).fill('10')
    await d.getByRole('button', { name: 'Tester / sampel' }).click()
    await d.getByRole('button', { name: /Simpan/ }).click()
    await expect(d).toBeHidden()
    expect(await stock()).toBe('307.000')

    await page.getByRole('tab', { name: /Riwayat/ }).click()
    await expect(page.getByTestId('movement-row')).toHaveCount(3)
    await expect(page.getByTestId('movement-row').first()).toContainText('Tester / sampel')
  })

  async function addToCart(qty: string) {
    await page.getByRole('button', { name: 'Pilih VALENTINE / SCANDALOUS' }).click()
    const d = page.getByRole('dialog', { name: 'VALENTINE / SCANDALOUS' })
    await d.getByLabel(/Jumlah/).fill(qty)
    await d.getByRole('button', { name: /Tambah ke keranjang/ }).click()
    await expect(d).toBeHidden()
  }

  test('3. jual 10 ml tunai: total Rp20.000, kembalian Rp30.000, HPP Rp10.140, laba Rp9.860, sisa 297 ml', async () => {
    await page.goto('/kasir')
    await addToCart('10')
    await expect(page.getByTestId('cart-total')).toHaveText('Rp20.000')
    await page.getByRole('button', { name: 'Bayar Rp20.000' }).click()
    const pay = page.getByRole('dialog', { name: 'Pembayaran' })
    await pay.getByLabel('Uang diterima').fill('50.000')
    await expect(pay.getByTestId('change')).toHaveText('Rp30.000')
    await pay.getByRole('button', { name: 'Bayar Rp20.000' }).click()

    const ok = page.getByRole('dialog', { name: 'Transaksi berhasil' })
    await expect(ok.getByTestId('success-change')).toHaveText('Kembalian Rp30.000')
    const today = (await todayWita()).replace(/-/g, '')
    await expect(ok.getByTestId('receipt')).toContainText(`MP-TKL-${today}-0001`)
    await expect(ok.getByTestId('receipt')).toContainText('10 ml x Rp2.000')
    await ok.getByRole('button', { name: /Transaksi baru/ }).click()

    const [t] = await sql(`select number, total, cost_total, gross_profit, amount_paid, change_amount, status from public.transactions order by created_at`)
    expect(t).toEqual({
      number: `MP-TKL-${today}-0001`,
      total: '20000.00',
      cost_total: '10140.00',
      gross_profit: '9860.00',
      amount_paid: '50000.00',
      change_amount: '30000.00',
      status: 'completed',
    })
    expect(await stock()).toBe('297.000')
  })

  test('4. jual 5 ml QRIS', async () => {
    await addToCart('5')
    await page.getByRole('button', { name: 'Bayar Rp10.000' }).click()
    const pay = page.getByRole('dialog', { name: 'Pembayaran' })
    await pay.getByRole('radio', { name: 'QRIS' }).click()
    await pay.getByLabel(/referensi/).fill('QR-001')
    await pay.getByRole('button', { name: 'Bayar Rp10.000' }).click()
    await expect(page.getByRole('dialog', { name: 'Transaksi berhasil' })).toBeVisible()
    await page.getByRole('button', { name: /Transaksi baru/ }).click()
    const [p] = await sql(`select method, amount, reference from public.payments p join public.transactions t on t.id = p.transaction_id where t.number like '%-0002'`)
    expect(p).toEqual({ method: 'qris', amount: '10000.00', reference: 'QR-001' })
    expect(await stock()).toBe('292.000')
  })

  test('5. koneksi putus setelah server menyimpan → "Coba lagi" tidak membuat transaksi ganda', async () => {
    await addToCart('10')
    // Permintaan create_sale berikutnya DITERUSKAN ke server (transaksi COMMIT di database),
    // tetapi responsnya digagalkan ke aplikasi — mensimulasikan koneksi putus sebelum jawaban tiba.
    let dropped = false
    await page.route('**/rest/v1/rpc/create_sale', async (route) => {
      if (dropped) return route.continue()
      dropped = true
      await route.fetch() // server benar-benar memproses & menyimpan
      await route.abort('connectionreset')
    })
    await page.getByRole('button', { name: 'Bayar Rp20.000' }).click()
    const pay = page.getByRole('dialog', { name: 'Pembayaran' })
    await pay.getByRole('radio', { name: 'QRIS' }).click()
    await pay.getByRole('button', { name: 'Bayar Rp20.000' }).click()
    await expect(pay.getByRole('alert')).toContainText('BELUM dipastikan tersimpan')
    await expect(page.getByRole('dialog', { name: 'Transaksi berhasil' })).toBeHidden()
    expect((await sql(`select count(*)::int n from public.transactions`))[0].n).toBe(3) // sudah tersimpan di server

    await pay.getByRole('button', { name: 'Coba lagi' }).click()
    await expect(page.getByRole('dialog', { name: 'Transaksi berhasil' })).toBeVisible()
    await page.getByRole('button', { name: /Transaksi baru/ }).click()
    expect((await sql(`select count(*)::int n from public.transactions`))[0].n).toBe(3) // tetap 3, bukan 4
    await page.unroute('**/rest/v1/rpc/create_sale')
    expect(await stock()).toBe('282.000')
  })

  test('6. offline: tombol bayar nonaktif dan tidak ada transaksi', async () => {
    await addToCart('1')
    await page.context().setOffline(true)
    await expect(page.getByRole('alert').filter({ hasText: 'Tidak ada koneksi internet' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Bayar Rp2.000' })).toBeDisabled()
    await page.context().setOffline(false)
    await expect(page.getByText('Koneksi pulih.')).toBeVisible()
    await page.getByRole('button', { name: /Kosongkan/ }).click()
    expect((await sql(`select count(*)::int n from public.transactions`))[0].n).toBe(3)
  })

  test('7. batalkan transaksi QRIS 5 ml: stok kembali, transaksi tetap tersimpan', async () => {
    await page.goto('/transaksi')
    await page.getByTestId('tx-row').filter({ hasText: '-0002' }).click()
    const d = page.getByRole('dialog', { name: /-0002$/ })
    await expect(d.getByTestId('receipt')).toContainText('Ref: QR-001')
    await d.getByRole('button', { name: /^Batalkan$/ }).click()
    await d.getByLabel('Alasan pembatalan').fill('Pelanggan batal beli')
    await d.getByRole('button', { name: /Batalkan transaksi/ }).click()
    await expect(d.getByText('Dibatalkan', { exact: true })).toBeVisible()
    const [t] = await sql(`select status, void_reason from public.transactions where number like '%-0002'`)
    expect(t).toEqual({ status: 'void', void_reason: 'Pelanggan batal beli' })
    expect(await stock()).toBe('287.000')
  })

  test('8. pengeluaran & laporan: omzet tidak menghitung void, laba bersih dikurangi pengeluaran', async () => {
    await page.goto('/pengeluaran')
    await page.getByRole('button', { name: /Catat/ }).click()
    const d = page.getByRole('dialog', { name: 'Catat Pengeluaran' })
    await d.getByLabel('Kategori').selectOption('listrik')
    await d.getByLabel('Nominal (Rp)').fill('5.000')
    await d.getByLabel('Keterangan').fill('Token listrik')
    await d.getByRole('button', { name: /Simpan/ }).click()
    await expect(d).toBeHidden()
    await expect(page.getByTestId('expense-total')).toHaveText('Rp5.000')

    await page.goto('/laporan')
    // 2 transaksi selesai × 10 ml: omzet 40.000; HPP 20.280; laba kotor 19.720; bersih 14.720
    await expect(page.getByText('Total omzet').locator('..')).toContainText('Rp40.000')
    await expect(page.getByText('Total HPP').locator('..')).toContainText('Rp20.280')
    await expect(page.getByText('Laba kotor', { exact: true }).locator('..')).toContainText('Rp19.720')
    for (const el of await page.getByText('Laba bersih', { exact: true }).all()) await expect(el.locator('..')).toContainText('Rp14.720')
    await expect(page.getByText('1 transaksi batal tidak dihitung')).toBeVisible()
  })

  test('9. cetak laporan closing (PDF) dan export Excel', async () => {
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Cetak Laporan Closing/ }).click()])
    expect(pdf.suggestedFilename()).toMatch(/^closing_TKL_\d{4}-\d{2}-\d{2}\.pdf$/)
    const pdfText = readFileSync((await pdf.path())!).toString('latin1')
    expect(pdfText.startsWith('%PDF-')).toBe(true)
    expect(pdfText).toContain('Laporan Closing Harian')
    expect(pdfText).toContain('Rp14.720')

    const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Excel/ }).click()])
    expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/)
    expect(readFileSync((await xlsx.path())!).subarray(0, 2).toString()).toBe('PK') // arsip zip (xlsx)
  })

  test('10. tambah karyawan kasir lewat Edge Function (username + izin closing)', async () => {
    await page.goto('/karyawan')
    await page.getByRole('button', { name: 'Tambah', exact: true }).click()
    const d = page.getByRole('dialog', { name: 'Tambah Karyawan' })
    await d.getByLabel('Nama lengkap').fill(USERS.kasirBaru.name)
    await d.getByLabel('Username').fill(USERS.kasirBaru.login)
    await d.getByLabel('Kata sandi awal').fill(USERS.kasirBaru.password)
    await d.getByRole('checkbox', { name: 'Closing kas' }).check()
    await d.getByRole('button', { name: /Buat akun/ }).click()
    await expect(d).toBeHidden()
    await expect(page.getByTestId('staff-row').filter({ hasText: USERS.kasirBaru.name })).toContainText('TKL · Kasir')

    const [u] = await sql(
      `select p.username, ou.role, ou.permissions from public.profiles p join public.outlet_users ou on ou.user_id = p.id where p.username = $1`,
      [USERS.kasirBaru.login],
    )
    expect(u).toEqual({ username: 'kasir.tkl', role: 'kasir', permissions: ['closing.perform'] })
  })

  test('11. audit mencatat aktivitas penting', async () => {
    const rows = await sql(`select entity, action from public.audit_logs order by created_at`)
    const has = (entity: string, action: string) => rows.some((r) => r.entity === entity && r.action === action)
    expect(has('products', 'create')).toBe(true)
    expect(has('transactions', 'create')).toBe(true)
    expect(has('transactions', 'void')).toBe(true)
    expect(has('expenses', 'insert')).toBe(true)
    expect(has('outlet_users', 'insert')).toBe(true)
  })
})

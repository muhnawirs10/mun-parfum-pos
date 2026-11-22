import { expect, test, type Page } from '@playwright/test'
import { SHIM_PORT, USERS } from './config'
import { login, logout, sql, watchCsp } from './helpers'

/** Ambil access token sesi Supabase dari localStorage halaman. */
async function tokenOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))!
    return JSON.parse(localStorage.getItem(key)!).access_token as string
  })
}

/** Panggil API langsung (melewati UI) dengan token pengguna — simulasi penyerang. */
async function api(token: string, path: string, init: RequestInit = {}) {
  const r = await fetch(`http://localhost:${SHIM_PORT}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

test.describe.serial('Kasir baru (dibuat lewat UI di tes 01)', () => {
  let page: Page
  let csp: string[] = []
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    csp = watchCsp(page)
    await login(page, USERS.kasirBaru.login, USERS.kasirBaru.password)
  })
  test.afterAll(async () => {
    expect(csp, 'pelanggaran CSP').toEqual([])
    await page.close()
  })

  test('login dengan username; menu manajemen tersembunyi; HPP tidak tampil', async () => {
    await expect(page.getByText(`${USERS.kasirBaru.name}!`)).toBeVisible()
    await page.goto('/lainnya')
    for (const hidden of ['Produk', 'Stok', 'Karyawan', 'Outlet', 'Pengeluaran']) {
      await expect(page.getByRole('link', { name: new RegExp(`^${hidden}`) })).toHaveCount(0)
    }
    await page.goto('/produk')
    await expect(page.getByText('Akses ditolak')).toBeVisible()
    await page.goto('/kasir')
    await expect(page.getByRole('button', { name: 'Pilih VALENTINE / SCANDALOUS' })).toBeVisible()
    await expect(page.getByText(/HPP/)).toHaveCount(0)
  })

  test('buka kas → jual 2,5 ml tunai → closing dengan selisih', async () => {
    await page.getByRole('button', { name: /Buka kas/ }).click()
    const kas = page.getByRole('dialog', { name: 'Kas' })
    await kas.getByLabel('Kas awal (Rp)').fill('100.000')
    await kas.getByRole('button', { name: /Buka kas/ }).click()
    await expect(kas.getByText('Kas seharusnya di laci')).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Pilih VALENTINE / SCANDALOUS' }).click()
    const d = page.getByRole('dialog', { name: 'VALENTINE / SCANDALOUS' })
    await d.getByLabel(/Jumlah/).fill('2,5')
    await expect(d.getByTestId('line-preview')).toHaveText('Rp5.000')
    await d.getByRole('button', { name: /Tambah ke keranjang/ }).click()
    await page.getByRole('button', { name: 'Bayar Rp5.000' }).click()
    const pay = page.getByRole('dialog', { name: 'Pembayaran' })
    await pay.getByRole('button', { name: 'Uang pas' }).click()
    await pay.getByRole('button', { name: 'Bayar Rp5.000' }).click()
    await expect(page.getByRole('dialog', { name: 'Transaksi berhasil' })).toBeVisible()
    await page.getByRole('button', { name: /Transaksi baru/ }).click()

    // laporan: kasir dengan izin closing hanya melihat kartu sesi kas
    await page.goto('/laporan')
    await expect(page.getByRole('tab', { name: 'Harian' })).toHaveCount(0)
    const card = page.getByTestId('cash-session')
    await expect(card).toContainText('Rp105.000') // kas seharusnya
    await card.getByLabel('Kas fisik hasil hitung (Rp)').fill('104.000')
    await card.getByRole('button', { name: /Tutup kas/ }).click()
    await expect(card.getByTestId('closing-result')).toContainText('Selisih-Rp1.000')

    const [s] = await sql(`select status, expected_cash, counted_cash, cash_difference from public.cash_sessions`)
    expect(s).toEqual({ status: 'closed', expected_cash: '105000.00', counted_cash: '104000.00', cash_difference: '-1000.00' })
    const [t] = await sql(`select t.total, t.cost_total, t.cash_session_id is not null as in_session from public.transactions t join public.profiles p on p.id = t.cashier_id where p.username = 'kasir.tkl'`)
    expect(t).toEqual({ total: '5000.00', cost_total: '2535.00', in_session: true })
  })

  test('riwayat transaksi: hanya miliknya, tanpa tombol batal', async () => {
    await page.goto('/transaksi')
    await expect(page.getByText('Menampilkan transaksi Anda')).toBeVisible()
    await expect(page.getByTestId('tx-row')).toHaveCount(1)
    await page.getByTestId('tx-row').click()
    await expect(page.getByTestId('receipt')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Batalkan$/ })).toHaveCount(0)
  })

  test('serangan langsung ke API dengan token kasir ditolak database', async () => {
    const token = await tokenOf(page)
    const tkl = (await sql(`select id from public.outlets where code = 'TKL'`))[0].id
    const product = (await sql(`select id from public.products where sku = 'TKL-0001'`))[0].id

    // membaca HPP dari tabel
    expect((await api(token, '/rest/v1/products?select=id,cost_price')).status).toBe(403) // column privilege
    // view HPP: kosong untuk kasir
    expect((await api(token, '/rest/v1/product_costs?select=product_id,cost_price')).body).toEqual([])
    // mengubah stok langsung
    expect((await api(token, `/rest/v1/products?id=eq.${product}`, { method: 'PATCH', body: JSON.stringify({ current_stock: 9999 }) })).status).toBe(403)
    // RPC stok, produk, batal, laporan, karyawan
    const deny = async (fn: string, body: object) => {
      const r = await api(token, `/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) })
      expect(r.status, `${fn}: ${JSON.stringify(r.body)}`).toBe(403)
    }
    await deny('adjust_stock', { p_product_id: product, p_type: 'stock_in', p_quantity: 100, p_reason: 'x', p_idempotency_key: crypto.randomUUID() })
    await deny('create_product', { p_outlet_id: tkl, p_name: 'X', p_unit: 'ML', p_sell_price: 1, p_cost_price: 0 })
    await deny('get_sales_report', { p_from: '2026-01-01', p_to: '2026-12-31', p_outlet_id: tkl })
    await deny('set_setting', { p_outlet_id: tkl, p_key: 'allow_negative_stock', p_value: true })
    await deny('list_staff', {})
    const someTx = (await sql(`select id from public.transactions limit 1`))[0].id
    await deny('void_transaction', { p_transaction_id: someTx, p_reason: 'x' })
    // menaikkan izin sendiri lewat Edge Function
    const r = await api(token, '/functions/v1/admin-users', {
      method: 'POST',
      body: JSON.stringify({ action: 'create_staff', username: 'penyusup', full_name: 'X', password: 'rahasia123', outlet_id: tkl, role: 'admin', permissions: [] }),
    })
    expect(r.status).toBe(403)
    expect((await sql(`select count(*)::int n from public.profiles where username = 'penyusup'`))[0].n).toBe(0)
    expect((await sql(`select current_stock from public.products where sku = 'TKL-0001'`))[0].current_stock).toBe('284.500')
  })

  test('logout', async () => {
    await logout(page)
  })
})

test.describe.serial('Isolasi outlet: kasir Makassar', () => {
  let page: Page
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    await login(page, USERS.kasirMks.login, USERS.kasirMks.password)
  })
  test.afterAll(async () => page.close())

  test('hanya melihat produk outlet Makassar', async () => {
    await page.goto('/kasir')
    await expect(page.getByRole('button', { name: 'Pilih PRODUK KHUSUS MAKASSAR' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Pilih VALENTINE / SCANDALOUS' })).toHaveCount(0)
  })

  test('tidak dapat menjual produk / membaca transaksi outlet Takalar lewat API', async () => {
    const token = await tokenOf(page)
    const [{ tkl, mks }] = await sql(`select (select id from public.outlets where code = 'TKL') tkl, (select id from public.outlets where code = 'MKS') mks`)
    const valentine = (await sql(`select id from public.products where sku = 'TKL-0001'`))[0].id
    const sale = (outlet: string) =>
      api(token, '/rest/v1/rpc/create_sale', {
        method: 'POST',
        body: JSON.stringify({ p_outlet_id: outlet, p_items: [{ product_id: valentine, quantity: '1' }], p_payment_method: 'qris', p_amount_received: null, p_idempotency_key: crypto.randomUUID() }),
      })
    expect((await sale(tkl)).status).toBe(403)
    const cross = await sale(mks)
    expect(cross.status).toBe(404)
    expect(cross.body.message).toContain('tidak ditemukan di outlet ini')
    expect((await api(token, '/rest/v1/transactions?select=id,number')).body).toEqual([])
    expect((await api(token, '/rest/v1/products?select=id,name')).body.map((p: { name: string }) => p.name)).toEqual(['PRODUK KHUSUS MAKASSAR'])
  })
})

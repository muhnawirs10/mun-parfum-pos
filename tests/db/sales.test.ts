import { asUser, createValentine, createWorld, errorOf, sell, sql, stockOf, uuid, type World } from './helpers'

let w: World
let valentine: string

beforeEach(async () => {
  w = await createWorld()
  valentine = await createValentine(w)
})

describe('Penjualan VALENTINE / SCANDALOUS (Rp2.000/ml, HPP Rp1.014/ml, stok 307 ml)', () => {
  it('penjualan 10 ml → omzet 20.000, HPP 10.140, laba kotor 9.860, sisa 297 ml', async () => {
    const r = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { received: '20000' })
    expect(r.total).toBe(20000)
    expect(r.change_amount).toBe(0)
    expect(await stockOf(valentine)).toBe('297.000')

    const [t] = await sql(`select total, cost_total, gross_profit, status from public.transactions where id = $1`, [r.id])
    expect(t).toEqual({ total: '20000.00', cost_total: '10140.00', gross_profit: '9860.00', status: 'completed' })

    const [mv] = await sql(
      `select movement_type, quantity, stock_before, stock_after, created_by from public.stock_movements where transaction_id = $1`,
      [r.id],
    )
    expect(mv).toEqual({ movement_type: 'sale', quantity: '-10.000', stock_before: '307.000', stock_after: '297.000', created_by: w.kasirTkl })
  })

  it('penjualan 5 ml → omzet 10.000, HPP 5.070, laba 4.930, sisa 302 ml', async () => {
    const r = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '5' }], { received: '10000' })
    const [t] = await sql(`select total, cost_total, gross_profit from public.transactions where id = $1`, [r.id])
    expect(t).toEqual({ total: '10000.00', cost_total: '5070.00', gross_profit: '4930.00' })
    expect(await stockOf(valentine)).toBe('302.000')
  })

  it('volume desimal 2,5 ml', async () => {
    const r = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '2.5' }], { received: '5000' })
    const [t] = await sql(`select total, cost_total from public.transactions where id = $1`, [r.id])
    expect(t).toEqual({ total: '5000.00', cost_total: '2535.00' })
    expect(await stockOf(valentine)).toBe('304.500')
  })

  it('diskon item dan diskon transaksi', async () => {
    const r = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10', discount_amount: '1000' }], {
      received: '20000',
      discount: '2000',
    })
    // 20.000 − 1.000 − 2.000 = 17.000; HPP tetap 10.140; laba 6.860
    expect(r.total).toBe(17000)
    expect(r.change_amount).toBe(3000)
    const [t] = await sql(
      `select subtotal, item_discount_total, discount_amount, total, cost_total, gross_profit from public.transactions where id = $1`,
      [r.id],
    )
    expect(t).toEqual({
      subtotal: '19000.00',
      item_discount_total: '1000.00',
      discount_amount: '2000.00',
      total: '17000.00',
      cost_total: '10140.00',
      gross_profit: '6860.00',
    })
    expect(await errorOf(sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '1', discount_amount: '2001' }], { received: '0' }))).toMatch(
      /Diskon item/,
    )
    expect(await errorOf(sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '1' }], { received: '0', discount: '2001' }))).toMatch(
      /Diskon transaksi/,
    )
  })

  it('pembayaran tunai: kembalian dihitung, uang kurang ditolak tanpa mengubah stok', async () => {
    const r = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { received: '50000' })
    expect(r.amount_paid).toBe(50000)
    expect(r.change_amount).toBe(30000)
    const [p] = await sql(`select method, amount, amount_received, change_amount from public.payments where transaction_id = $1`, [r.id])
    expect(p).toEqual({ method: 'cash', amount: '20000.00', amount_received: '50000.00', change_amount: '30000.00' })

    const before = await stockOf(valentine)
    expect(await errorOf(sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { received: '19999' }))).toMatch(/kurang/)
    expect(await stockOf(valentine)).toBe(before)
  })

  it('pembayaran QRIS: dibayar pas, tanpa kembalian', async () => {
    const r = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { method: 'qris' })
    expect(r.payment_method).toBe('qris')
    expect(r.amount_paid).toBe(20000)
    expect(r.change_amount).toBe(0)
    expect(await errorOf(sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '1' }], { method: 'qris', received: '5000' }))).toMatch(
      /non-tunai/,
    )
  })

  it('nomor transaksi berformat MP-<KODE>-<YYYYMMDD>-0001 dan berurutan', async () => {
    const a = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '1' }], { method: 'qris' })
    const b = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '1' }], { method: 'qris' })
    const [{ code }] = await sql(`select code from public.outlets where id = $1`, [w.tkl])
    const [{ d }] = await sql(`select to_char((now() at time zone 'Asia/Makassar')::date, 'YYYYMMDD') d`)
    expect(a.number).toBe(`MP-${code}-${d}-0001`)
    expect(b.number).toBe(`MP-${code}-${d}-0002`)
  })

  it('harga & HPP tersimpan sebagai snapshot; perubahan harga tidak mengubah transaksi lama', async () => {
    const r = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { received: '20000' })
    await asUser(w.owner, `select public.update_product($1, 'VALENTINE / SCANDALOUS', 'ML', 2500, 1300)`, [valentine])
    const [i] = await sql(`select unit_price, unit_cost, total, cost_total from public.transaction_items where transaction_id = $1`, [r.id])
    expect(i).toEqual({ unit_price: '2000.00', unit_cost: '1014.00', total: '20000.00', cost_total: '10140.00' })
  })

  it('validasi stok: tidak boleh minus kecuali owner mengizinkan', async () => {
    expect(await errorOf(sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '307.5' }], { method: 'qris' }))).toMatch(
      /tidak cukup/,
    )
    expect(await stockOf(valentine)).toBe('307.000')
    // dua baris produk yang sama dijumlahkan
    expect(
      await errorOf(
        sell(w.kasirTkl, w.tkl, [
          { product_id: valentine, quantity: '200' },
          { product_id: valentine, quantity: '200' },
        ], { method: 'qris' }),
      ),
    ).toMatch(/tidak cukup/)
    expect(await stockOf(valentine)).toBe('307.000')
    expect(await sql(`select 1 from public.transactions where outlet_id = $1`, [w.tkl])).toHaveLength(0)

    // kasir/admin tidak dapat mengaktifkan izin stok minus
    expect(
      await errorOf(asUser(w.adminTkl, `insert into public.app_settings (outlet_id, key, value) values ($1, 'allow_negative_stock', 'true')`, [w.tkl])),
    ).toMatch(/row-level security/)
    await asUser(w.owner, `insert into public.app_settings (outlet_id, key, value) values ($1, 'allow_negative_stock', 'true')`, [w.tkl])
    await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '310' }], { method: 'qris' })
    expect(await stockOf(valentine)).toBe('-3.000')
  })

  it('menolak qty tidak valid, satuan bulat, produk nonaktif, dan keranjang kosong', async () => {
    const [{ r: botol }] = await asUser(w.owner, `select public.create_product($1, 'Botol Spray 30ml', 'PCS', 5000, 2500, 10) as r`, [w.tkl])
    expect(await errorOf(sell(w.kasirTkl, w.tkl, [{ product_id: botol.id, quantity: '1.5' }], { method: 'qris' }))).toMatch(/bilangan bulat/)
    expect(await errorOf(sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '0' }], { method: 'qris' }))).toMatch(/lebih dari 0/)
    expect(await errorOf(sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '-5' }], { method: 'qris' }))).toMatch(/lebih dari 0/)
    expect(await errorOf(sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '1.0005' }], { method: 'qris' }))).toMatch(/3 angka desimal/)
    expect(await errorOf(sell(w.kasirTkl, w.tkl, [], { method: 'qris' }))).toMatch(/Keranjang kosong/)
    await asUser(w.owner, `select public.set_product_active($1, false)`, [valentine])
    expect(await errorOf(sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '1' }], { method: 'qris' }))).toMatch(/tidak aktif/)
  })

  it('transaksi gagal di tengah dibatalkan seluruhnya (atomik)', async () => {
    const [{ r: b }] = await asUser(w.owner, `select public.create_product($1, 'DIOR SAUVAGE', 'ML', 2000, 1000, 5) as r`, [w.tkl])
    expect(
      await errorOf(
        sell(w.kasirTkl, w.tkl, [
          { product_id: valentine, quantity: '10' },
          { product_id: b.id, quantity: '6' }, // stok hanya 5
        ], { method: 'qris' }),
      ),
    ).toMatch(/tidak cukup/)
    expect(await stockOf(valentine)).toBe('307.000')
    expect(await stockOf(b.id)).toBe('5.000')
    expect(await sql(`select 1 from public.stock_movements where movement_type = 'sale' and outlet_id = $1`, [w.tkl])).toHaveLength(0)
  })
})

describe('Pencegahan transaksi ganda (idempotency key)', () => {
  it('pengiriman ulang dengan kunci sama mengembalikan transaksi yang sama, stok berkurang sekali', async () => {
    const key = uuid()
    const a = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { received: '20000', key })
    const b = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { received: '20000', key })
    expect(b.id).toBe(a.id)
    expect(b.replayed).toBe(true)
    expect(await stockOf(valentine)).toBe('297.000')
  })

  it('10 permintaan bersamaan dengan kunci sama → hanya 1 transaksi', async () => {
    const key = uuid()
    const results = await Promise.all(
      Array.from({ length: 10 }, () => sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { received: '20000', key })),
    )
    expect(new Set(results.map((r) => r.id)).size).toBe(1)
    expect(results.filter((r) => !r.replayed)).toHaveLength(1)
    expect(await stockOf(valentine)).toBe('297.000')
    expect(await sql(`select 1 from public.transactions where idempotency_key = $1`, [key])).toHaveLength(1)
  })

  it('penjualan bersamaan dengan kunci berbeda tidak membuat stok melampaui batas', async () => {
    // 40 × 10 ml = 400 ml > 307 ml → tepat 30 berhasil
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, () => sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { method: 'qris' })),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(30)
    expect(await stockOf(valentine)).toBe('7.000')
  })

  it('kunci milik kasir lain ditolak', async () => {
    const key = uuid()
    await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '1' }], { method: 'qris', key })
    expect(await errorOf(sell(w.adminTkl, w.tkl, [{ product_id: valentine, quantity: '1' }], { method: 'qris', key }))).toMatch(/sudah dipakai/)
  })
})

describe('Pembatalan (void)', () => {
  it('mengembalikan stok, tidak dihitung di laporan, dan tidak dapat dihapus', async () => {
    const r = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { received: '20000' })
    expect(await errorOf(asUser(w.kasirTkl, `select public.void_transaction($1, 'salah input')`, [r.id]))).toMatch(/Akses ditolak/)
    expect(await errorOf(asUser(w.adminTkl, `select public.void_transaction($1, '')`, [r.id]))).toMatch(/Alasan/)
    await asUser(w.adminTkl, `select public.void_transaction($1, 'salah input')`, [r.id])
    expect(await stockOf(valentine)).toBe('307.000')
    const [{ status }] = await sql(`select status from public.transactions where id = $1`, [r.id])
    expect(status).toBe('void')
    expect(await errorOf(asUser(w.adminTkl, `select public.void_transaction($1, 'lagi')`, [r.id]))).toMatch(/sudah dibatalkan/)
    expect(await errorOf(sql(`delete from public.transactions where id = $1`, [r.id]))).toMatch(/tidak diizinkan/)
    const movements = await sql(`select movement_type from public.stock_movements where transaction_id = $1 order by created_at`, [r.id])
    expect(movements.map((m) => m.movement_type).sort()).toEqual(['sale', 'sale_void'])
  })
})

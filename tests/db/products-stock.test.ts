import { asUser, createValentine, createWorld, errorOf, sql, stockOf, uuid, type World } from './helpers'

let w: World
beforeEach(async () => {
  w = await createWorld()
})

describe('Produk', () => {
  it('tambah produk: SKU otomatis unik per outlet + stok awal tercatat', async () => {
    const [{ r: a }] = await asUser(w.adminTkl, `select public.create_product($1, 'DIVA / PSM', 'ML', 2000, 1000, 215) r`, [w.tkl])
    const [{ r: b }] = await asUser(w.adminTkl, `select public.create_product($1, 'DIOR SAUVAGE', 'ML', 2000, 1000, 250) r`, [w.tkl])
    const [{ code }] = await sql(`select code from public.outlets where id = $1`, [w.tkl])
    expect(a.sku).toBe(`${code}-0001`)
    expect(b.sku).toBe(`${code}-0002`)
    expect(await stockOf(a.id)).toBe('215.000')
    const [mv] = await sql(`select movement_type, quantity, stock_before, stock_after, reason from public.stock_movements where product_id = $1`, [a.id])
    expect(mv).toEqual({ movement_type: 'initial', quantity: '215.000', stock_before: '0.000', stock_after: '215.000', reason: 'Stok awal' })
  })

  it('SKU manual divalidasi unik; semua satuan didukung', async () => {
    await asUser(w.owner, `select public.create_product($1, 'A', 'ML', 1, 0, 0, 0, null, null, null, '001')`, [w.tkl])
    expect(await errorOf(asUser(w.owner, `select public.create_product($1, 'B', 'ML', 1, 0, 0, 0, null, null, null, '001')`, [w.tkl]))).toMatch(
      /sudah dipakai/,
    )
    for (const unit of ['PCS', 'GRAM', 'UNIT', 'BOTOL']) {
      await asUser(w.owner, `select public.create_product($1, $2, $3::public.stock_unit, 1000, 500, 3)`, [w.tkl, 'Produk ' + unit, unit])
    }
    expect(await errorOf(asUser(w.owner, `select public.create_product($1, 'C', 'PCS', 1000, 0, 1.5)`, [w.tkl]))).toMatch(/bilangan bulat/)
    expect(await errorOf(asUser(w.owner, `select public.create_product($1, 'D', 'ML', -1, 0)`, [w.tkl]))).toMatch(/negatif/)
    expect(await errorOf(asUser(w.owner, `select public.create_product($1, '', 'ML', 1, 0)`, [w.tkl]))).toMatch(/check constraint/)
  })

  it('edit produk tidak mengubah stok dan tercatat di audit', async () => {
    const id = await createValentine(w)
    await asUser(w.adminTkl, `select public.update_product($1, 'VALENTINE', 'ML', 2200, 1100, 20)`, [id])
    const [p] = await sql(`select name, sell_price, cost_price, min_stock, current_stock from public.products where id = $1`, [id])
    expect(p).toEqual({ name: 'VALENTINE', sell_price: '2200.00', cost_price: '1100.00', min_stock: '20.000', current_stock: '307.000' })
    const [a] = await sql(`select details from public.audit_logs where entity_id = $1 and action = 'update'`, [id])
    expect(a.details.old.sell_price).toBe(2000)
    expect(a.details.new.sell_price).toBe(2200)
  })

  it('pengguna tanpa cost.view tidak dapat mengubah HPP, tetapi tetap dapat mengubah harga', async () => {
    const id = await createValentine(w)
    await asUser(w.owner, `update public.outlet_users set revoked_permissions = '{cost.view}' where user_id = $1`, [w.adminTkl])
    expect(await errorOf(asUser(w.adminTkl, `select public.update_product($1, 'V', 'ML', 2000, 1)`, [id]))).toMatch(/cost.view/)
    await asUser(w.adminTkl, `select public.update_product($1, 'V', 'ML', 2100, null)`, [id])
    const [p] = await sql(`select sell_price, cost_price from public.products where id = $1`, [id])
    expect(p).toEqual({ sell_price: '2100.00', cost_price: '1014.00' })
  })

  it('hapus = nonaktifkan; produk tetap ada untuk riwayat', async () => {
    const id = await createValentine(w)
    await asUser(w.adminTkl, `select public.set_product_active($1, false)`, [id])
    const [p] = await sql(`select is_active from public.products where id = $1`, [id])
    expect(p.is_active).toBe(false)
    await asUser(w.adminTkl, `select public.set_product_active($1, true)`, [id])
  })
})

describe('Stok', () => {
  it('stok masuk menambah stok dan mencatat pergerakan', async () => {
    const id = await createValentine(w)
    const [{ r }] = await asUser(w.adminTkl, `select public.adjust_stock($1, 'stock_in', 100.5, 'Restock supplier', $2) r`, [id, uuid()])
    expect(r.stock_before).toBe(307)
    expect(r.stock_after).toBe(407.5)
    expect(await stockOf(id)).toBe('407.500')
  })

  it('stok keluar wajib alasan dan tidak boleh melebihi stok', async () => {
    const id = await createValentine(w)
    expect(await errorOf(asUser(w.adminTkl, `select public.adjust_stock($1, 'stock_out', 7, '', $2)`, [id, uuid()]))).toMatch(/Alasan/)
    expect(await errorOf(asUser(w.adminTkl, `select public.adjust_stock($1, 'stock_out', 400, 'tumpah', $2)`, [id, uuid()]))).toMatch(
      /tidak cukup/,
    )
    await asUser(w.adminTkl, `select public.adjust_stock($1, 'stock_out', 7, 'Botol pecah', $2)`, [id, uuid()])
    expect(await stockOf(id)).toBe('300.000')
    const [mv] = await sql(`select quantity, reason, created_by from public.stock_movements where product_id = $1 and movement_type = 'stock_out'`, [id])
    expect(mv).toEqual({ quantity: '-7.000', reason: 'Botol pecah', created_by: w.adminTkl })
  })

  it('stok opname menyetel stok ke hasil hitung fisik', async () => {
    const id = await createValentine(w)
    await asUser(w.adminTkl, `select public.adjust_stock($1, 'adjustment', 300.25, 'Opname mingguan', $2)`, [id, uuid()])
    expect(await stockOf(id)).toBe('300.250')
    expect(await errorOf(asUser(w.adminTkl, `select public.adjust_stock($1, 'adjustment', 300.25, 'lagi', $2)`, [id, uuid()]))).toMatch(
      /tidak ada perubahan/,
    )
    expect(await errorOf(asUser(w.adminTkl, `select public.adjust_stock($1, 'sale', 1, 'x', $2)`, [id, uuid()]))).toMatch(/tidak diizinkan/)
    expect(await errorOf(asUser(w.adminTkl, `select public.adjust_stock($1, 'transfer_in', 1, 'x', $2)`, [id, uuid()]))).toMatch(
      /tidak diizinkan/,
    )
  })

  it('penyesuaian stok idempoten', async () => {
    const id = await createValentine(w)
    const key = uuid()
    await asUser(w.adminTkl, `select public.adjust_stock($1, 'stock_in', 10, 'x', $2)`, [id, key])
    const [{ r }] = await asUser(w.adminTkl, `select public.adjust_stock($1, 'stock_in', 10, 'x', $2) r`, [id, key])
    expect(r.replayed).toBe(true)
    expect(await stockOf(id)).toBe('317.000')
  })

  it('stok saat ini selalu = jumlah seluruh pergerakan', async () => {
    const id = await createValentine(w)
    await asUser(w.adminTkl, `select public.adjust_stock($1, 'stock_in', 12.345, 'x', $2)`, [id, uuid()])
    await asUser(w.adminTkl, `select public.adjust_stock($1, 'stock_out', 2.345, 'x', $2)`, [id, uuid()])
    const [{ s }] = await sql(`select sum(quantity) s from public.stock_movements where product_id = $1`, [id])
    expect(s).toBe(await stockOf(id))
  })
})

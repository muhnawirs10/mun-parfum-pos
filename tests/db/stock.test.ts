import { asUser, createValentine, createWorld, errorOf, sell, uuid, type World } from './helpers'

let w: World
let valentine: string
beforeEach(async () => {
  w = await createWorld()
  valentine = await createValentine(w)
})

const movements = (user: string, outlet: string, args: Record<string, unknown> = {}) =>
  asUser(
    user,
    `select public.get_stock_movements($1, $2, $3, $4, $5::public.stock_movement_type[], $6, $7) r`,
    [outlet, args.product ?? null, args.from ?? null, args.to ?? null, args.types ?? null, args.limit ?? 50, args.offset ?? 0],
  ).then((x) => x[0].r)

describe('Riwayat pergerakan stok', () => {
  it('mencatat stok awal, masuk, keluar, opname, penjualan, dan void beserta pengguna & nomor transaksi', async () => {
    await asUser(w.adminTkl, `select public.adjust_stock($1, 'stock_in', 100, 'Restock supplier', $2)`, [valentine, uuid()])
    await asUser(w.adminTkl, `select public.adjust_stock($1, 'stock_out', 7, 'Botol pecah', $2)`, [valentine, uuid()])
    const s = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { method: 'qris' })
    await asUser(w.owner, `select public.void_transaction($1, 'salah input')`, [s.id])
    await asUser(w.adminTkl, `select public.adjust_stock($1, 'adjustment', 399.5, 'Opname', $2)`, [valentine, uuid()])

    const r = await movements(w.adminTkl, w.tkl)
    expect(r.total).toBe(6)
    expect(r.items.map((i: any) => i.movement_type)).toEqual(['adjustment', 'sale_void', 'sale', 'stock_out', 'stock_in', 'initial'])
    expect(r.items[0]).toMatchObject({ quantity: -0.5, stock_before: 400, stock_after: 399.5, reason: 'Opname', user_name: 'Admin TKL', product_name: 'VALENTINE / SCANDALOUS', unit: 'ML' })
    expect(r.items[2]).toMatchObject({ quantity: -10, user_name: 'Kasir TKL', transaction_number: s.number })
    // rantai stok konsisten: stock_after item lama = stock_before item berikutnya
    const asc = [...r.items].reverse()
    for (let i = 1; i < asc.length; i++) expect(asc[i].stock_before).toBe(asc[i - 1].stock_after)
    expect(r.summary).toEqual(expect.arrayContaining([{ movement_type: 'stock_in', count: 1, quantity: 100 }]))
  })

  it('filter produk, jenis, tanggal WITA, dan paging', async () => {
    const [{ r: other }] = await asUser(w.owner, `select public.create_product($1, 'DIOR SAUVAGE', 'ML', 2000, 1000, 50) r`, [w.tkl])
    for (let i = 0; i < 3; i++) await asUser(w.adminTkl, `select public.adjust_stock($1, 'stock_in', 1, 'x', $2)`, [valentine, uuid()])
    expect((await movements(w.adminTkl, w.tkl, { product: other.id })).total).toBe(1)
    expect((await movements(w.adminTkl, w.tkl, { types: '{stock_in}' })).total).toBe(3)
    const page = await movements(w.adminTkl, w.tkl, { limit: 2, offset: 2 })
    expect(page.total).toBe(5)
    expect(page.items).toHaveLength(2)
    expect((await movements(w.adminTkl, w.tkl, { from: '2000-01-01', to: '2000-01-02' })).total).toBe(0)
    const [{ d }] = await asUser(w.owner, `select (now() at time zone 'Asia/Makassar')::date::text d`)
    expect((await movements(w.adminTkl, w.tkl, { from: d, to: d })).total).toBe(5)
    expect(await errorOf(movements(w.adminTkl, w.tkl, { from: '2026-02-02', to: '2026-02-01' }))).toMatch(/tidak valid/)
  })

  it('kasir dan outlet lain tidak dapat membaca riwayat', async () => {
    expect(await errorOf(movements(w.kasirTkl, w.tkl))).toMatch(/Akses ditolak/)
    expect(await errorOf(movements(w.kasirMks, w.tkl))).toMatch(/Akses ditolak/)
    expect(await asUser(w.kasirTkl, `select 1 from public.stock_movements`)).toHaveLength(0)
  })
})

describe('Ringkasan persediaan', () => {
  it('menghitung produk aktif, menipis, habis, dan nilai persediaan', async () => {
    await asUser(w.owner, `select public.create_product($1, 'SELENA', 'ML', 2000, 1000, 40, 50)`, [w.tkl])
    await asUser(w.owner, `select public.create_product($1, 'BOTOL', 'PCS', 5000, 2500, 0, 5)`, [w.tkl])
    const [{ r }] = await asUser(w.owner, `select public.get_stock_summary($1) r`, [w.tkl])
    expect(r).toEqual({
      active_count: 3,
      low_count: 1,
      empty_count: 1,
      value_at_sell_price: 307 * 2000 + 40 * 2000,
      value_at_cost: 307 * 1014 + 40 * 1000,
    })
  })

  it('nilai HPP disembunyikan tanpa cost.view; kasir ditolak', async () => {
    await asUser(w.owner, `update public.outlet_users set revoked_permissions = '{cost.view}' where user_id = $1`, [w.adminTkl])
    const [{ r }] = await asUser(w.adminTkl, `select public.get_stock_summary($1) r`, [w.tkl])
    expect(r.value_at_cost).toBeNull()
    expect(r.value_at_sell_price).toBe(614000)
    expect(await errorOf(asUser(w.kasirTkl, `select public.get_stock_summary($1)`, [w.tkl]))).toMatch(/Akses ditolak/)
  })

  it('stok minus tidak menambah nilai persediaan', async () => {
    await asUser(w.owner, `insert into public.app_settings (outlet_id, key, value) values ($1, 'allow_negative_stock', 'true')`, [w.tkl])
    await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '310' }], { method: 'qris' })
    const [{ r }] = await asUser(w.owner, `select public.get_stock_summary($1) r`, [w.tkl])
    expect(r).toMatchObject({ empty_count: 1, value_at_cost: 0, value_at_sell_price: 0 })
  })
})

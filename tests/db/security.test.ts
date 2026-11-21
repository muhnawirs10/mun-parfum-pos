import { asUser, createValentine, createWorld, errorOf, sell, sql, stockOf, uuid, type World } from './helpers'

let w: World
let valentine: string

beforeEach(async () => {
  w = await createWorld()
  valentine = await createValentine(w)
})

describe('Peran pengguna & izin', () => {
  it('profil dibuat otomatis saat user Auth dibuat', async () => {
    const [p] = await sql(`select full_name, is_owner from public.profiles where id = $1`, [w.kasirTkl])
    expect(p).toEqual({ full_name: 'Kasir TKL', is_owner: false })
  })

  it('my_access mencerminkan peran per outlet', async () => {
    const owner = await asUser(w.owner, `select outlet_id, role from public.my_access()`)
    expect(owner.map((r) => r.outlet_id).sort()).toEqual(expect.arrayContaining([w.tkl, w.mks]))
    expect(owner.every((r) => r.role === 'owner')).toBe(true)
    const kasir = await asUser(w.kasirTkl, `select outlet_id, role, permissions from public.my_access()`)
    expect(kasir).toEqual([{ outlet_id: w.tkl, role: 'kasir', permissions: ['pos.sell'] }])
    expect(await asUser(w.outsider, `select * from public.my_access()`)).toEqual([])
  })

  it('kasir tidak dapat mengelola produk, stok, atau membatalkan transaksi', async () => {
    expect(await errorOf(asUser(w.kasirTkl, `select public.create_product($1, 'X', 'ML', 1000, 0)`, [w.tkl]))).toMatch(/Akses ditolak/)
    expect(await errorOf(asUser(w.kasirTkl, `select public.adjust_stock($1, 'stock_in', 10, 'x', $2)`, [valentine, uuid()]))).toMatch(
      /Akses ditolak/,
    )
    expect(await errorOf(asUser(w.kasirTkl, `select public.set_product_active($1, false)`, [valentine]))).toMatch(/Akses ditolak/)
  })

  it('admin dapat mengelola produk & stok tetapi tidak melihat laba tanpa izin', async () => {
    await asUser(w.adminTkl, `select public.adjust_stock($1, 'stock_in', 10, 'restock', $2)`, [valentine, uuid()])
    expect(await stockOf(valentine)).toBe('317.000')
    const [{ r }] = await asUser(w.adminTkl, `select public.get_sales_report(current_date - 1, current_date + 1, $1) r`, [w.tkl])
    expect(r.can_view_profit).toBe(false)
    expect(r.gross_profit).toBeNull()
    expect(r.net_profit).toBeNull()
  })

  it('izin tambahan dan pencabutan izin per pengguna bekerja', async () => {
    await asUser(w.owner, `update public.outlet_users set permissions = '{profit.view}' where user_id = $1`, [w.adminTkl])
    const [{ r }] = await asUser(w.adminTkl, `select public.get_sales_report((now() at time zone 'Asia/Makassar')::date, (now() at time zone 'Asia/Makassar')::date, $1) r`, [w.tkl])
    expect(r.can_view_profit).toBe(true)
    await asUser(w.owner, `update public.outlet_users set revoked_permissions = '{stock.manage}' where user_id = $1`, [w.adminTkl])
    expect(await errorOf(asUser(w.adminTkl, `select public.adjust_stock($1, 'stock_in', 1, 'x', $2)`, [valentine, uuid()]))).toMatch(
      /Akses ditolak/,
    )
    expect(await errorOf(asUser(w.owner, `update public.outlet_users set permissions = '{superuser}' where user_id = $1`, [w.adminTkl]))).toMatch(
      /Izin tidak dikenal/,
    )
  })

  it('admin tidak dapat menaikkan peran/izin sendiri dan tidak dapat menjadi owner', async () => {
    const rows = await asUser(w.adminTkl, `update public.outlet_users set permissions = '{profit.view}' where user_id = $1 returning id`, [
      w.adminTkl,
    ])
    expect(rows).toHaveLength(0) // diblokir RLS (hanya owner)
    expect(await errorOf(asUser(w.adminTkl, `update public.profiles set is_owner = true where id = $1`, [w.adminTkl]))).toMatch(
      /permission denied/,
    )
    await asUser(w.adminTkl, `update public.profiles set full_name = 'Admin Baru' where id = $1`, [w.adminTkl])
    const [p] = await sql(`select full_name, is_owner from public.profiles where id = $1`, [w.adminTkl])
    expect(p).toEqual({ full_name: 'Admin Baru', is_owner: false })
  })

  it('pengguna nonaktif kehilangan akses', async () => {
    await sql(`update public.profiles set is_active = false where id = $1`, [w.kasirTkl])
    expect(await asUser(w.kasirTkl, `select id from public.products`)).toHaveLength(0)
    expect(await errorOf(sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '1' }], { method: 'qris' }))).toMatch(/tidak aktif/)
  })
})

describe('Pembatasan akses outlet (RLS)', () => {
  it('kasir hanya melihat data outlet yang ditugaskan', async () => {
    const mksProduct = await createValentine(w, w.mks, '50')
    const tklRows = await asUser(w.kasirTkl, `select id from public.products`)
    expect(tklRows.map((r) => r.id)).toEqual([valentine])
    const mksRows = await asUser(w.kasirMks, `select id from public.products`)
    expect(mksRows.map((r) => r.id)).toEqual([mksProduct])
    expect((await asUser(w.kasirTkl, `select id from public.outlets`)).map((r) => r.id)).toEqual([w.tkl])
  })

  it('kasir tidak dapat menjual di outlet lain atau menjual produk outlet lain', async () => {
    expect(await errorOf(sell(w.kasirMks, w.tkl, [{ product_id: valentine, quantity: '1' }], { method: 'qris' }))).toMatch(/Akses ditolak/)
    expect(await errorOf(sell(w.kasirMks, w.mks, [{ product_id: valentine, quantity: '1' }], { method: 'qris' }))).toMatch(
      /tidak ditemukan di outlet ini/,
    )
    expect(await stockOf(valentine)).toBe('307.000')
  })

  it('kasir hanya melihat transaksinya sendiri; admin melihat semua di outletnya', async () => {
    const a = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '1' }], { method: 'qris' })
    const b = await sell(w.adminTkl, w.tkl, [{ product_id: valentine, quantity: '1' }], { method: 'qris' })
    expect((await asUser(w.kasirTkl, `select id from public.transactions`)).map((r) => r.id)).toEqual([a.id])
    expect((await asUser(w.adminTkl, `select id from public.transactions order by created_at`)).map((r) => r.id).sort()).toEqual(
      [a.id, b.id].sort(),
    )
    expect(await asUser(w.kasirMks, `select id from public.transactions`)).toHaveLength(0)
    expect(await asUser(w.kasirMks, `select id from public.transaction_items`)).toHaveLength(0)
  })

  it('orang luar dan anon tidak melihat apa pun', async () => {
    for (const t of ['products', 'outlets', 'transactions', 'stock_movements', 'expenses', 'audit_logs']) {
      expect(await asUser(w.outsider, `select 1 from public.${t}`)).toHaveLength(0)
    }
    expect(await errorOf(asUser(null, `select 1 from public.products`))).toMatch(/permission denied/)
    expect(await errorOf(asUser(null, `select public.create_sale($1, '[]', 'cash', 0, $2)`, [w.tkl, uuid()]))).toMatch(/permission denied/)
  })

  it('owner melihat semua outlet dan dapat membandingkan omzet', async () => {
    const mksProduct = await createValentine(w, w.mks, '50')
    await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { method: 'qris' })
    await sell(w.kasirMks, w.mks, [{ product_id: mksProduct, quantity: '5' }], { method: 'qris' })
    const [{ r }] = await asUser(w.owner, `select public.get_sales_report((now() at time zone 'Asia/Makassar')::date, (now() at time zone 'Asia/Makassar')::date) r`)
    const byOutlet = Object.fromEntries(r.by_outlet.map((o: any) => [o.outlet_id, o]))
    expect(byOutlet[w.tkl].omzet).toBe(20000)
    expect(byOutlet[w.tkl].gross_profit).toBe(9860)
    expect(byOutlet[w.mks].omzet).toBe(10000)
  })
})

describe('Perlindungan HPP & laba', () => {
  it('kasir tidak dapat membaca HPP/laba dari tabel maupun view', async () => {
    expect(await errorOf(asUser(w.kasirTkl, `select cost_price from public.products`))).toMatch(/permission denied/)
    expect(await errorOf(asUser(w.kasirTkl, `select * from public.products`))).toMatch(/permission denied/)
    const r = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '1' }], { method: 'qris' })
    expect(await errorOf(asUser(w.kasirTkl, `select gross_profit from public.transactions`))).toMatch(/permission denied/)
    expect(await errorOf(asUser(w.kasirTkl, `select unit_cost from public.transaction_items`))).toMatch(/permission denied/)
    expect(await asUser(w.kasirTkl, `select * from public.product_costs`)).toHaveLength(0)
    expect(await asUser(w.kasirTkl, `select * from public.transaction_profits`)).toHaveLength(0)
    expect(r).not.toHaveProperty('gross_profit')
    expect(r).not.toHaveProperty('cost_total')
  })

  it('admin melihat HPP (cost.view) tetapi tidak laba; owner melihat keduanya', async () => {
    await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { method: 'qris' })
    expect(await asUser(w.adminTkl, `select cost_price from public.product_costs`)).toEqual([{ cost_price: '1014.00' }])
    expect(await asUser(w.adminTkl, `select * from public.transaction_profits`)).toHaveLength(0)
    expect(await asUser(w.owner, `select gross_profit from public.transaction_profits where outlet_id = $1`, [w.tkl])).toEqual([
      { gross_profit: '9860.00' },
    ])
  })
})

describe('Integritas data', () => {
  it('stok tidak dapat diubah langsung, bahkan oleh superuser, tanpa pergerakan stok', async () => {
    expect(await errorOf(asUser(w.owner, `update public.products set current_stock = 999 where id = $1`, [valentine]))).toMatch(
      /permission denied/,
    )
    expect(await errorOf(sql(`update public.products set current_stock = 999 where id = $1`, [valentine]))).toMatch(
      /tanpa catatan pergerakan/,
    )
    expect(await stockOf(valentine)).toBe('307.000')
  })

  it('tabel kritis tidak dapat ditulis langsung oleh klien', async () => {
    expect(await errorOf(asUser(w.owner, `insert into public.transactions (outlet_id, number, business_date, cashier_id, payment_method, idempotency_key) values ($1,'X',current_date,$2,'cash',$3)`, [w.tkl, w.owner, uuid()]))).toMatch(/permission denied/)
    expect(await errorOf(asUser(w.owner, `insert into public.stock_movements (outlet_id, product_id, movement_type, quantity, stock_before, stock_after) values ($1,$2,'stock_in',1,0,1)`, [w.tkl, valentine]))).toMatch(/permission denied/)
    expect(await errorOf(asUser(w.owner, `delete from public.products where id = $1`, [valentine]))).toMatch(/permission denied/)
  })

  it('riwayat stok, item transaksi, dan audit bersifat permanen', async () => {
    const r = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '1' }], { method: 'qris' })
    expect(await errorOf(sql(`delete from public.stock_movements where transaction_id = $1`, [r.id]))).toMatch(/tidak diizinkan/)
    expect(await errorOf(sql(`update public.transaction_items set total = 0 where transaction_id = $1`, [r.id]))).toMatch(/tidak diizinkan/)
    expect(await errorOf(sql(`update public.transactions set total = 0, subtotal = 0 where id = $1`, [r.id]))).toMatch(/fungsi resmi/)
    expect(await errorOf(sql(`delete from public.audit_logs`))).toMatch(/tidak diizinkan/)
  })

  it('setiap perubahan penting tercatat di audit log (hanya owner yang dapat membaca)', async () => {
    const r = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '1' }], { method: 'qris' })
    const logs = await asUser(w.owner, `select action, entity, user_id from public.audit_logs where outlet_id = $1 order by created_at`, [w.tkl])
    expect(logs).toEqual(
      expect.arrayContaining([
        { action: 'create', entity: 'products', user_id: w.owner },
        { action: 'create', entity: 'transactions', user_id: w.kasirTkl },
      ]),
    )
    expect(await asUser(w.adminTkl, `select 1 from public.audit_logs`)).toHaveLength(0)
    expect(r.number).toMatch(/^MP-/)
  })
})

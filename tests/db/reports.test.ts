import { asUser, createValentine, createWorld, errorOf, sell, sql, uuid, type World } from './helpers'

let w: World
let valentine: string
beforeEach(async () => {
  w = await createWorld()
  valentine = await createValentine(w)
})

const report = (user: string, outlet: string | null, include = true) =>
  asUser(user, `select public.get_sales_report(current_date - 1, current_date + 1, $1, $2) r`, [outlet, include]).then((x) => x[0].r)

describe('Laporan keuangan', () => {
  it('omzet, HPP, laba kotor, pengeluaran, laba bersih, metode bayar, terlaris; void tidak dihitung', async () => {
    const [{ r: aigner }] = await asUser(w.owner, `select public.create_product($1, 'AIGNER BLUE', 'ML', 3000, 1212, 231) r`, [w.tkl])
    await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { received: '50000' })
    await sell(w.kasirTkl, w.tkl, [{ product_id: aigner.id, quantity: '5' }], { method: 'qris' })
    const v = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '20' }], { method: 'transfer' })
    await asUser(w.owner, `select public.void_transaction($1, 'batal')`, [v.id])
    await asUser(w.owner, `insert into public.expenses (outlet_id, expense_date, category, amount, created_by) values ($1, current_date, 'listrik', 5000, $2)`, [
      w.tkl,
      w.owner,
    ])

    const r = await report(w.owner, w.tkl)
    expect(r.transaction_count).toBe(2)
    expect(r.void_count).toBe(1)
    expect(r.omzet).toBe(35000) // 20.000 + 15.000
    expect(r.cost_total).toBe(16200) // 10.140 + 6.060
    expect(r.gross_profit).toBe(18800)
    expect(r.expenses_total).toBe(5000)
    expect(r.net_profit).toBe(13800)
    expect(r.average_transaction).toBe(17500)
    expect(r.by_payment_method).toEqual([
      { method: 'cash', count: 1, amount: 20000 },
      { method: 'qris', count: 1, amount: 15000 },
    ])
    expect(r.top_products[0]).toMatchObject({ name: 'VALENTINE / SCANDALOUS', quantity: 10, omzet: 20000, gross_profit: 9860 })
    expect(r.top_profit_products[0]).toMatchObject({ name: 'VALENTINE / SCANDALOUS', gross_profit: 9860 })
    expect(r.qty_by_unit).toEqual([{ unit: 'ML', quantity: 15 }])

    const noExp = await report(w.owner, w.tkl, false)
    expect(noExp.net_profit).toBe(18800)
  })

  it('pengeluaran memengaruhi laba bersih, bukan omzet maupun stok', async () => {
    await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { method: 'qris' })
    const before = await report(w.owner, w.tkl)
    await asUser(w.owner, `insert into public.expenses (outlet_id, expense_date, category, amount, description, created_by) values ($1, current_date, 'sewa', 12000, 'Sewa kios', $2)`, [
      w.tkl,
      w.owner,
    ])
    const after = await report(w.owner, w.tkl)
    expect(after.omzet).toBe(before.omzet)
    expect(after.gross_profit).toBe(9860)
    expect(after.net_profit).toBe(9860 - 12000)
    const [{ current_stock }] = await sql(`select current_stock from public.products where id = $1`, [valentine])
    expect(current_stock).toBe('297.000')
  })

  it('pengeluaran: kasir tidak dapat mencatat; soft delete, tidak bisa hapus permanen', async () => {
    expect(
      await errorOf(
        asUser(w.kasirTkl, `insert into public.expenses (outlet_id, expense_date, category, amount, created_by) values ($1, current_date, 'air', 1000, $2)`, [
          w.tkl,
          w.kasirTkl,
        ]),
      ),
    ).toMatch(/row-level security/)
    const [{ id }] = await asUser(
      w.owner,
      `insert into public.expenses (outlet_id, expense_date, category, amount, created_by) values ($1, current_date, 'air', 1000, $2) returning id`,
      [w.tkl, w.owner],
    )
    expect(await errorOf(asUser(w.owner, `delete from public.expenses where id = $1`, [id]))).toMatch(/permission denied/)
    await asUser(w.owner, `update public.expenses set deleted_at = now(), deleted_by = $2 where id = $1`, [id, w.owner])
    expect((await report(w.owner, w.tkl)).expenses_total).toBe(0)
    expect(
      await errorOf(
        asUser(w.owner, `insert into public.expenses (outlet_id, expense_date, category, amount, created_by) values ($1, current_date, 'air', 0, $2)`, [
          w.tkl,
          w.owner,
        ]),
      ),
    ).toMatch(/check constraint/)
  })

  it('kasir tidak dapat membuka laporan; rentang tanggal divalidasi', async () => {
    expect(await errorOf(report(w.kasirTkl, w.tkl))).toMatch(/Akses ditolak/)
    expect(await errorOf(asUser(w.owner, `select public.get_sales_report(current_date, current_date - 1)`))).toMatch(/tidak valid/)
  })
})

describe('Closing harian (sesi kas)', () => {
  it('kas yang diharapkan = kas awal + penjualan tunai; selisih dihitung', async () => {
    const [{ s }] = await asUser(w.adminTkl, `select public.open_cash_session($1, 100000) s`, [w.tkl])
    expect(await errorOf(asUser(w.adminTkl, `select public.open_cash_session($1, 0)`, [w.tkl]))).toMatch(/masih ada/i)
    await sell(w.adminTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { received: '50000' })
    await sell(w.adminTkl, w.tkl, [{ product_id: valentine, quantity: '5' }], { method: 'qris' })
    const v = await sell(w.adminTkl, w.tkl, [{ product_id: valentine, quantity: '1' }], { received: '2000' })
    await asUser(w.adminTkl, `select public.void_transaction($1, 'batal')`, [v.id])

    const [{ r }] = await asUser(w.adminTkl, `select public.close_cash_session($1, 119000, 'kurang seribu') r`, [s])
    expect(r.cash_sales).toBe(20000)
    expect(r.expected_cash).toBe(120000)
    expect(r.cash_difference).toBe(-1000)
    expect(r.status).toBe('closed')
    expect(await errorOf(asUser(w.adminTkl, `select public.close_cash_session($1, 1)`, [s]))).toMatch(/sudah ditutup/)
  })

  it('kasir butuh izin closing.perform untuk menutup kas', async () => {
    const [{ s }] = await asUser(w.kasirTkl, `select public.open_cash_session($1, 0) s`, [w.tkl])
    expect(await errorOf(asUser(w.kasirTkl, `select public.close_cash_session($1, 0)`, [s]))).toMatch(/closing.perform/)
    await asUser(w.owner, `update public.outlet_users set permissions = '{closing.perform}' where user_id = $1`, [w.kasirTkl])
    await asUser(w.kasirTkl, `select public.close_cash_session($1, 0)`, [s])
  })
})

it('helper uuid tersedia', () => expect(uuid()).toMatch(/-/))

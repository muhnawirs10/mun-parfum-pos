import { asUser, createValentine, createWorld, errorOf, sell, type World } from './helpers'

let w: World
let valentine: string
let today: string
beforeEach(async () => {
  w = await createWorld()
  valentine = await createValentine(w)
  ;[{ today }] = await asUser(w.owner, `select (now() at time zone 'Asia/Makassar')::date::text today`)
})

const addExpense = (user: string, category: string, amount: string, date = today, description: string | null = null) =>
  asUser(
    user,
    `insert into public.expenses (outlet_id, expense_date, category, amount, description, created_by) values ($1, $2, $3, $4, $5, $6) returning id`,
    [w.tkl, date, category, amount, description, user],
  ).then((r) => r[0].id as string)

const expenses = (user: string, args: { from?: string; to?: string; category?: string | null } = {}) =>
  asUser(user, `select public.get_expenses($1, $2::date, $3::date, $4::public.expense_category) r`, [
    w.tkl,
    args.from ?? today,
    args.to ?? today,
    args.category ?? null,
  ]).then((x) => x[0].r)

describe('Pengeluaran', () => {
  it('8 kategori didukung; total & per kategori; nama pencatat; soft delete tidak dihitung', async () => {
    for (const c of ['sewa', 'listrik', 'air', 'gaji', 'transportasi', 'perlengkapan', 'operasional', 'lainnya']) {
      await addExpense(w.owner, c, '1000')
    }
    const big = await addExpense(w.owner, 'listrik', '150000', today, 'Token PLN')
    const r = await expenses(w.owner)
    expect(r).toMatchObject({ count: 9, total_amount: 158000, can_manage: true })
    expect(r.by_category[0]).toEqual({ category: 'listrik', count: 2, amount: 151000 })
    expect(r.items.find((i: any) => i.id === big)).toMatchObject({ description: 'Token PLN', created_by_name: 'Nawir' })
    expect((await expenses(w.owner, { category: 'air' })).count).toBe(1)

    await asUser(w.owner, `update public.expenses set deleted_at = now(), deleted_by = $2 where id = $1`, [big, w.owner])
    expect((await expenses(w.owner)).total_amount).toBe(8000)
  })

  it('pengeluaran tidak mengubah omzet maupun stok', async () => {
    await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { method: 'qris' })
    await addExpense(w.owner, 'gaji', '50000')
    const [{ r }] = await asUser(w.owner, `select public.get_sales_report($1::date, $1::date, $2) r`, [today, w.tkl])
    expect(r).toMatchObject({ omzet: 20000, gross_profit: 9860, expenses_total: 50000, net_profit: -40140 })
    const [{ current_stock }] = await asUser(w.owner, `select current_stock from public.products where id = $1`, [valentine])
    expect(current_stock).toBe('297.000')
  })

  it('izin: admin tanpa izin & kasir ditolak; izin expenses.view hanya baca', async () => {
    expect(await errorOf(expenses(w.kasirTkl))).toMatch(/Akses ditolak/)
    expect(await errorOf(expenses(w.adminTkl))).toMatch(/Akses ditolak/)
    await asUser(w.owner, `update public.outlet_users set permissions = '{expenses.view}' where user_id = $1`, [w.adminTkl])
    expect((await expenses(w.adminTkl)).can_manage).toBe(false)
    expect(await errorOf(addExpense(w.adminTkl, 'air', '1000'))).toMatch(/row-level security/)
    await asUser(w.owner, `update public.outlet_users set permissions = '{expenses.manage}' where user_id = $1`, [w.adminTkl])
    const id = await addExpense(w.adminTkl, 'air', '1000')
    await asUser(w.adminTkl, `update public.expenses set amount = 2500, description = 'koreksi' where id = $1`, [id])
    const r = await expenses(w.adminTkl)
    expect(r).toMatchObject({ can_manage: true, total_amount: 2500 })
    const logs = await asUser(w.owner, `select action from public.audit_logs where entity = 'expenses' and entity_id = $1 order by created_at`, [id])
    expect(logs.map((l) => l.action)).toEqual(['insert', 'update'])
  })

  it('tidak dapat mencatat atas nama orang lain atau nominal tidak valid', async () => {
    expect(
      await errorOf(
        asUser(w.owner, `insert into public.expenses (outlet_id, expense_date, category, amount, created_by) values ($1, $2, 'air', 1000, $3)`, [w.tkl, today, w.kasirTkl]),
      ),
    ).toMatch(/row-level security/)
    expect(await errorOf(addExpense(w.owner, 'air', '-5'))).toMatch(/check constraint/)
    expect(await errorOf(addExpense(w.owner, 'bensin', '5'))).toMatch(/invalid input value for enum/)
  })
})

describe('Sesi kas & closing', () => {
  it('sesi aktif menghitung kas diharapkan secara langsung; closing mencatat selisih', async () => {
    expect((await asUser(w.adminTkl, `select public.get_my_cash_session($1) r`, [w.tkl]))[0].r).toBeNull()
    const [{ s }] = await asUser(w.adminTkl, `select public.open_cash_session($1, 100000) s`, [w.tkl])
    await sell(w.adminTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { received: '50000' })
    await sell(w.adminTkl, w.tkl, [{ product_id: valentine, quantity: '5' }], { method: 'qris' })
    const [{ r }] = await asUser(w.adminTkl, `select public.get_my_cash_session($1) r`, [w.tkl])
    expect(r).toMatchObject({
      id: s,
      status: 'open',
      opening_cash: 100000,
      transaction_count: 2,
      sales_total: 30000,
      cash_sales: 20000,
      expected_cash: 120000,
      can_close: true,
      opened_by_name: 'Admin TKL',
    })
    expect(r.by_payment_method).toEqual([
      { method: 'cash', amount: 20000 },
      { method: 'qris', amount: 10000 },
    ])
    await asUser(w.adminTkl, `select public.close_cash_session($1, 121000)`, [s])
    const [{ list }] = await asUser(w.owner, `select public.get_cash_sessions($1, $2::date, $2::date) list`, [w.tkl, today])
    expect(list[0]).toMatchObject({ status: 'closed', expected_cash: 120000, counted_cash: 121000, cash_difference: 1000, closed_by_name: 'Admin TKL' })
  })

  it('kasir hanya melihat sesinya sendiri; outlet lain ditolak', async () => {
    await asUser(w.kasirTkl, `select public.open_cash_session($1, 0)`, [w.tkl])
    await asUser(w.adminTkl, `select public.open_cash_session($1, 0)`, [w.tkl])
    const [{ mine }] = await asUser(w.kasirTkl, `select public.get_cash_sessions($1, $2::date, $2::date) mine`, [w.tkl, today])
    expect(mine).toHaveLength(1)
    expect((await asUser(w.kasirTkl, `select public.get_my_cash_session($1) r`, [w.tkl]))[0].r.can_close).toBe(false)
    const [{ all }] = await asUser(w.owner, `select public.get_cash_sessions($1, $2::date, $2::date) all`, [w.tkl, today])
    expect(all).toHaveLength(2)
    expect(await errorOf(asUser(w.kasirMks, `select public.get_cash_sessions($1, $2::date, $2::date)`, [w.tkl, today]))).toMatch(/Akses ditolak/)
  })
})

import { asUser, createValentine, createWorld, errorOf, sell, type World } from './helpers'

let w: World
let valentine: string
let today: string
beforeEach(async () => {
  w = await createWorld()
  valentine = await createValentine(w)
  ;[{ today }] = await asUser(w.owner, `select (now() at time zone 'Asia/Makassar')::date::text today`)
})

const list = (user: string, args: Record<string, unknown> = {}) =>
  asUser(
    user,
    `select public.get_transactions($1, $2::date, $3::date, $4::public.transaction_status, $5::public.payment_method, $6, $7, $8) r`,
    [args.outlet ?? w.tkl, args.from ?? today, args.to ?? today, args.status ?? null, args.method ?? null, args.search ?? null, args.limit ?? 50, args.offset ?? 0],
  ).then((x) => x[0].r)

const detail = (user: string, id: string) => asUser(user, `select public.get_transaction_detail($1) r`, [id]).then((x) => x[0].r)

describe('Riwayat transaksi', () => {
  it('admin melihat semua transaksi outlet; kasir hanya miliknya', async () => {
    const a = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { received: '20000' })
    await sell(w.adminTkl, w.tkl, [{ product_id: valentine, quantity: '5' }], { method: 'qris' })
    const all = await list(w.adminTkl)
    expect(all).toMatchObject({ scope: 'outlet', total: 2, completed_count: 2, completed_amount: 30000 })
    expect(all.items[0]).toMatchObject({ cashier_name: 'Admin TKL', payment_method: 'qris', items: 'VALENTINE / SCANDALOUS' })
    const own = await list(w.kasirTkl)
    expect(own).toMatchObject({ scope: 'own', total: 1 })
    expect(own.items[0].id).toBe(a.id)
    expect(await errorOf(list(w.kasirMks))).toMatch(/Akses ditolak/)
  })

  it('filter status, metode, pencarian nomor/produk/pelanggan; total tidak menghitung void', async () => {
    const [{ r: dior }] = await asUser(w.owner, `select public.create_product($1, 'DIOR SAUVAGE', 'ML', 2000, 1000, 100) r`, [w.tkl])
    const a = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { received: '20000' })
    await sell(w.kasirTkl, w.tkl, [{ product_id: dior.id, quantity: '5' }], { method: 'qris' })
    await asUser(w.owner, `select public.void_transaction($1, 'batal')`, [a.id])
    expect((await list(w.owner)).completed_amount).toBe(10000)
    expect((await list(w.owner, { status: 'void' })).total).toBe(1)
    expect((await list(w.owner, { method: 'qris' })).total).toBe(1)
    expect((await list(w.owner, { search: 'dior' })).total).toBe(1)
    expect((await list(w.owner, { search: a.number.slice(-4) })).items[0].id).toBe(a.id)
    expect((await list(w.owner, { from: '2000-01-01', to: '2000-01-02' })).total).toBe(0)
    expect(await errorOf(list(w.owner, { from: today, to: '2000-01-01' }))).toMatch(/tidak valid/)
  })
})

describe('Detail transaksi / struk', () => {
  it('berisi item, pembayaran, outlet, kasir, dan footer struk', async () => {
    await asUser(w.owner, `update public.outlets set address = 'Jl. Poros Takalar', phone = '0812-3456-7890' where id = $1`, [w.tkl])
    const r = await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10', discount_amount: '1000' }], { received: '50000', discount: '500' })
    const d = await detail(w.kasirTkl, r.id)
    expect(d).toMatchObject({
      number: r.number,
      status: 'completed',
      subtotal: 19000,
      item_discount_total: 1000,
      discount_amount: 500,
      total: 18500,
      amount_paid: 50000,
      change_amount: 31500,
      cashier_name: 'Kasir TKL',
      cost_total: null,
      gross_profit: null,
      can_void: false,
      receipt_footer: 'Terima kasih atas kunjungan Anda',
      outlet: { name: 'MUN Parfum Takalar', address: 'Jl. Poros Takalar', phone: '0812-3456-7890' },
    })
    expect(d.items).toEqual([
      expect.objectContaining({ product_name: 'VALENTINE / SCANDALOUS', quantity: 10, unit_price: 2000, subtotal: 20000, discount_amount: 1000, total: 19000, gross_profit: null }),
    ])
    expect(d.payments).toEqual([{ method: 'cash', amount: 18500, amount_received: 50000, change_amount: 31500, reference: null }])

    const o = await detail(w.owner, r.id)
    expect(o).toMatchObject({ cost_total: 10140, gross_profit: 8360, can_void: true })
    await asUser(w.owner, `insert into public.app_settings (outlet_id, key, value) values ($1, 'receipt_footer', '"Wangi setiap hari!"')`, [w.tkl])
    expect((await detail(w.kasirTkl, r.id)).receipt_footer).toBe('Wangi setiap hari!')
  })

  it('transaksi milik orang lain/outlet lain tidak dapat dibuka; status void tampil', async () => {
    const r = await sell(w.adminTkl, w.tkl, [{ product_id: valentine, quantity: '1' }], { method: 'qris' })
    expect(await errorOf(detail(w.kasirTkl, r.id))).toMatch(/tidak ditemukan/)
    expect(await errorOf(detail(w.kasirMks, r.id))).toMatch(/tidak ditemukan/)
    await asUser(w.adminTkl, `select public.void_transaction($1, 'pelanggan batal')`, [r.id])
    expect(await detail(w.adminTkl, r.id)).toMatchObject({ status: 'void', void_reason: 'pelanggan batal', voided_by_name: 'Admin TKL', can_void: false })
  })
})

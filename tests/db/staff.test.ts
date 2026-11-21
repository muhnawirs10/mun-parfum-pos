import { asUser, createUser, createValentine, createWorld, errorOf, sell, sql, type World } from './helpers'

let w: World
beforeEach(async () => {
  w = await createWorld()
  // admin TKL diberi izin kelola kasir
  await asUser(w.owner, `update public.outlet_users set permissions = '{users.manage}' where user_id = $1`, [w.adminTkl])
})

const assign = (caller: string, user: string, outlet: string, role: string, perms: string[] = [], active = true) =>
  asUser(caller, `select public.assign_outlet_user($1, $2, $3::public.app_role, $4::text[], '{}', $5) r`, [user, outlet, role, perms, active])

describe('Manajemen karyawan', () => {
  it('owner menugaskan admin/kasir di outlet mana pun dengan izin apa pun', async () => {
    const baru = await createUser('baru@test.local', 'Karyawan Baru', 'baru1')
    await assign(w.owner, baru, w.mks, 'admin', ['profit.view'])
    const [{ r }] = await asUser(baru, `select public.has_permission($1, 'profit.view') r`, [w.mks])
    expect(r).toBe(true)
    expect(await errorOf(assign(w.owner, baru, w.mks, 'owner'))).toMatch(/Akses ditolak/)
  })

  it('admin (users.manage) hanya mengelola kasir di outletnya dengan izin yang aman', async () => {
    const baru = await createUser('k2@test.local', 'Kasir Dua')
    await assign(w.adminTkl, baru, w.tkl, 'kasir', ['closing.perform'])
    expect(await errorOf(assign(w.adminTkl, baru, w.tkl, 'kasir', ['profit.view']))).toMatch(/tidak boleh menetapkan/)
    expect(await errorOf(assign(w.adminTkl, baru, w.tkl, 'admin'))).toMatch(/tidak boleh menetapkan/)
    expect(await errorOf(assign(w.adminTkl, baru, w.mks, 'kasir'))).toMatch(/tidak boleh menetapkan/)
    // tidak bisa menaikkan diri sendiri / mengubah admin lain / owner
    expect(await errorOf(assign(w.adminTkl, w.adminTkl, w.tkl, 'kasir', ['closing.perform']))).toMatch(/akun sendiri/)
    const admin2 = await createUser('a2@test.local', 'Admin Dua')
    await assign(w.owner, admin2, w.tkl, 'admin')
    expect(await errorOf(assign(w.adminTkl, admin2, w.tkl, 'kasir'))).toMatch(/hanya pemilik/)
    expect(await errorOf(assign(w.adminTkl, w.owner, w.tkl, 'kasir'))).toMatch(/Pemilik memiliki akses/)
    // kasir biasa tidak bisa apa-apa
    expect(await errorOf(assign(w.kasirTkl, baru, w.tkl, 'kasir'))).toMatch(/tidak boleh menetapkan/)
  })

  it('can_manage_user: owner semua kecuali owner/diri; admin hanya kasir di outletnya', async () => {
    const check = (caller: string, target: string) => asUser(caller, `select public.can_manage_user($1) r`, [target]).then((x) => x[0].r)
    expect(await check(w.owner, w.adminTkl)).toBe(true)
    expect(await check(w.owner, w.owner)).toBe(false)
    expect(await check(w.adminTkl, w.kasirTkl)).toBe(true)
    expect(await check(w.adminTkl, w.kasirMks)).toBe(false)
    expect(await check(w.adminTkl, w.owner)).toBe(false)
    expect(await check(w.adminTkl, w.adminTkl)).toBe(false)
    expect(await check(w.kasirTkl, w.kasirTkl)).toBe(false)
  })

  it('list_staff: owner melihat semua; admin hanya orang di outletnya; kasir ditolak', async () => {
    const all = (await asUser(w.owner, `select public.list_staff() r`))[0].r
    const names = all.map((u: any) => u.full_name)
    expect(names).toEqual(expect.arrayContaining(['Nawir', 'Admin TKL', 'Kasir TKL', 'Kasir MKS', 'Orang Luar']))
    const kasir = all.find((u: any) => u.id === w.kasirTkl)
    expect(kasir.assignments[0]).toMatchObject({ role: 'kasir', permissions: [], is_active: true })
    expect(kasir.can_manage).toBe(true)

    const mine = (await asUser(w.adminTkl, `select public.list_staff() r`))[0].r
    expect(mine.map((u: any) => u.full_name).sort()).toEqual(['Admin TKL', 'Kasir TKL'])
    expect(mine.find((u: any) => u.is_self).can_manage).toBe(false)
    expect(await errorOf(asUser(w.kasirTkl, `select public.list_staff()`))).toMatch(/Akses ditolak/)
  })

  it('nonaktifkan akun: hanya owner; akun nonaktif kehilangan akses', async () => {
    const v = await createValentine(w)
    expect(await errorOf(asUser(w.adminTkl, `select public.set_staff_active($1, false)`, [w.kasirTkl]))).toMatch(/hanya pemilik/)
    await asUser(w.owner, `select public.set_staff_active($1, false)`, [w.kasirTkl])
    expect(await errorOf(sell(w.kasirTkl, w.tkl, [{ product_id: v, quantity: '1' }], { method: 'qris' }))).toMatch(/tidak aktif/)
    await asUser(w.owner, `select public.set_staff_active($1, true)`, [w.kasirTkl])
    await sell(w.kasirTkl, w.tkl, [{ product_id: v, quantity: '1' }], { method: 'qris' })
    expect(await errorOf(asUser(w.owner, `select public.set_staff_active($1, false)`, [w.owner]))).toMatch(/Tidak dapat/)
  })

  it('penugasan per outlet bisa dinonaktifkan tanpa menghapus akun', async () => {
    await assign(w.adminTkl, w.kasirTkl, w.tkl, 'kasir', [], false)
    expect(await asUser(w.kasirTkl, `select * from public.my_access()`)).toEqual([])
    const [{ is_active }] = await sql(`select is_active from public.profiles where id = $1`, [w.kasirTkl])
    expect(is_active).toBe(true)
  })

  it('ubah nama: diri sendiri atau yang dikelola; status tidak bisa diubah non-owner', async () => {
    await asUser(w.adminTkl, `select public.update_staff_name($1, 'Kasir Takalar')`, [w.kasirTkl])
    expect((await sql(`select full_name from public.profiles where id = $1`, [w.kasirTkl]))[0].full_name).toBe('Kasir Takalar')
    expect(await errorOf(asUser(w.adminTkl, `select public.update_staff_name($1, 'X')`, [w.kasirMks]))).toMatch(/Akses ditolak/)
    await asUser(w.kasirTkl, `select public.update_staff_name($1, 'Saya')`, [w.kasirTkl])
    expect(await errorOf(asUser(w.adminTkl, `update public.profiles set is_active = false where id = $1`, [w.kasirTkl]))).toMatch(/permission denied/)
  })

  it('perubahan penugasan tercatat di audit dan terlihat lewat get_audit_logs', async () => {
    const baru = await createUser('k3@test.local', 'Kasir Tiga')
    await assign(w.adminTkl, baru, w.tkl, 'kasir')
    const [{ today }] = await sql(`select (now() at time zone 'Asia/Makassar')::date::text today`)
    const [{ r }] = await asUser(w.owner, `select public.get_audit_logs($1::date, $1::date, $2, null, 'outlet_users') r`, [today, w.tkl])
    expect(r.items.some((i: any) => i.action === 'insert' && i.user_name === 'Admin TKL' && i.outlet_code)).toBe(true)
    expect(await errorOf(asUser(w.adminTkl, `select public.get_audit_logs($1::date, $1::date, $2)`, [today, w.tkl]))).toMatch(/audit.view/)
  })
})

describe('Outlet', () => {
  it('owner membuat & mengubah outlet; kode tervalidasi; kode terkunci setelah ada transaksi', async () => {
    const [{ id }] = await asUser(w.owner, `insert into public.outlets (code, name, address, phone) values ('GWA', 'MUN Parfum Gowa', 'Sungguminasa', '0811-222-333') returning id`)
    expect(await errorOf(asUser(w.owner, `insert into public.outlets (code, name) values ('gowa-1', 'X')`))).toMatch(/check constraint/)
    expect(await errorOf(asUser(w.adminTkl, `insert into public.outlets (code, name) values ('ADM', 'X')`))).toMatch(/row-level security/)
    await asUser(w.owner, `update public.outlets set code = 'GOW' where id = $1`, [id])
    const v = await createValentine(w)
    await sell(w.kasirTkl, w.tkl, [{ product_id: v, quantity: '1' }], { method: 'qris' })
    expect(await errorOf(asUser(w.owner, `update public.outlets set code = 'TK2' where id = $1`, [w.tkl]))).toMatch(/tidak dapat diubah/)
    await asUser(w.owner, `update public.outlets set name = 'MUN Parfum Takalar Pusat' where id = $1`, [w.tkl])
  })

  it('outlet nonaktif: staf kehilangan akses', async () => {
    await asUser(w.owner, `update public.outlets set is_active = false where id = $1`, [w.tkl])
    expect(await asUser(w.kasirTkl, `select * from public.my_access()`)).toEqual([])
  })
})

describe('Pengaturan', () => {
  it('stok minus hanya bisa diizinkan owner; footer struk oleh settings.manage', async () => {
    expect(await errorOf(asUser(w.adminTkl, `select public.set_setting($1, 'allow_negative_stock', 'true')`, [w.tkl]))).toMatch(/hanya pemilik/)
    await asUser(w.owner, `select public.set_setting($1, 'allow_negative_stock', 'true')`, [w.tkl])
    await asUser(w.owner, `select public.set_setting($1, 'allow_negative_stock', 'false')`, [w.tkl]) // upsert
    expect(await errorOf(asUser(w.adminTkl, `select public.set_setting($1, 'receipt_footer', '"Hai"')`, [w.tkl]))).toMatch(/settings.manage/)
    await asUser(w.owner, `update public.outlet_users set permissions = '{settings.manage}' where user_id = $1`, [w.adminTkl])
    await asUser(w.adminTkl, `select public.set_setting($1, 'receipt_footer', '"Wangi setiap hari"')`, [w.tkl])
    const [{ r }] = await asUser(w.kasirTkl, `select public.get_settings($1) r`, [w.tkl])
    expect(r).toEqual({ allow_negative_stock: false, receipt_footer: 'Wangi setiap hari', can_manage: false, can_manage_negative_stock: false })
    expect(await errorOf(asUser(w.owner, `select public.set_setting($1, 'hack', '1')`, [w.tkl]))).toMatch(/tidak dikenal/)
    expect(await errorOf(asUser(w.owner, `select public.set_setting($1, 'allow_negative_stock', '"ya"')`, [w.tkl]))).toMatch(/true\/false/)
    expect(await errorOf(asUser(w.owner, `select public.set_setting($1, 'receipt_footer', $2)`, [w.tkl, JSON.stringify('x'.repeat(201))]))).toMatch(/200 karakter/)
  })
})

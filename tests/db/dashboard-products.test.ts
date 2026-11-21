import { asUser, createValentine, createWorld, errorOf, sell, sql, uuid, type World } from './helpers'

let w: World
let valentine: string
beforeEach(async () => {
  w = await createWorld()
  valentine = await createValentine(w)
})

const dash = (user: string, outlet: string) =>
  asUser(user, `select public.get_dashboard($1) r`, [outlet]).then((x) => x[0].r)

describe('get_dashboard', () => {
  it('owner melihat omzet, laba, pengeluaran, stok menipis, dan transaksi terakhir outlet', async () => {
    await asUser(w.owner, `select public.update_product($1, 'VALENTINE / SCANDALOUS', 'ML', 2000, 1014, 300)`, [valentine])
    await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { received: '20000' })
    const v = await sell(w.adminTkl, w.tkl, [{ product_id: valentine, quantity: '5' }], { method: 'qris' })
    await asUser(w.owner, `select public.void_transaction($1, 'batal')`, [v.id])
    await asUser(w.owner, `insert into public.expenses (outlet_id, expense_date, category, amount, created_by)
                           values ($1, (now() at time zone 'Asia/Makassar')::date, 'listrik', 7500, $2)`, [w.tkl, w.owner])

    const d = await dash(w.owner, w.tkl)
    expect(d.scope).toBe('outlet')
    expect(d.transaction_count).toBe(1) // void tidak dihitung
    expect(d.omzet).toBe(20000)
    expect(d.gross_profit).toBe(9860)
    expect(d.expenses_total).toBe(7500)
    expect(d.expenses_count).toBe(1)
    expect(d.product_count).toBe(1)
    expect(d.low_stock).toEqual([
      expect.objectContaining({ id: valentine, name: 'VALENTINE / SCANDALOUS', current_stock: 297, min_stock: 300, unit: 'ML' }),
    ])
    expect(d.recent_transactions).toHaveLength(2)
    expect(d.recent_transactions[0]).toMatchObject({ status: 'void', items: 'VALENTINE / SCANDALOUS' })
  })

  it('kasir hanya melihat transaksinya sendiri, tanpa laba/pengeluaran/stok menipis', async () => {
    await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { method: 'qris' })
    await sell(w.adminTkl, w.tkl, [{ product_id: valentine, quantity: '5' }], { method: 'qris' })
    const d = await dash(w.kasirTkl, w.tkl)
    expect(d.scope).toBe('own')
    expect(d.transaction_count).toBe(1)
    expect(d.omzet).toBe(20000)
    expect(d.gross_profit).toBeNull()
    expect(d.expenses_total).toBeNull()
    expect(d.low_stock).toBeNull()
    expect(d.recent_transactions).toHaveLength(1)
  })

  it('admin melihat omzet outlet tetapi bukan laba', async () => {
    await sell(w.kasirTkl, w.tkl, [{ product_id: valentine, quantity: '10' }], { method: 'qris' })
    const d = await dash(w.adminTkl, w.tkl)
    expect(d.omzet).toBe(20000)
    expect(d.gross_profit).toBeNull()
    expect(d.low_stock).toEqual([])
  })

  it('outlet lain ditolak', async () => {
    expect(await errorOf(dash(w.kasirMks, w.tkl))).toMatch(/Akses ditolak/)
    expect(await errorOf(dash(w.outsider, w.tkl))).toMatch(/Akses ditolak/)
  })
})

describe('Kategori', () => {
  it('admin dapat menambah & mengubah kategori; kasir tidak; nama unik per outlet', async () => {
    const [{ id }] = await asUser(w.adminTkl, `insert into public.categories (outlet_id, name) values ($1, 'PARFUM') returning id`, [w.tkl])
    expect(await errorOf(asUser(w.adminTkl, `insert into public.categories (outlet_id, name) values ($1, 'parfum')`, [w.tkl]))).toMatch(
      /duplicate key/,
    )
    await asUser(w.adminTkl, `insert into public.categories (outlet_id, name) values ($1, 'PARFUM')`, [w.mks]).catch(() => {})
    expect(await sql(`select 1 from public.categories where outlet_id = $1`, [w.mks])).toHaveLength(0)
    expect(await errorOf(asUser(w.kasirTkl, `insert into public.categories (outlet_id, name) values ($1, 'X')`, [w.tkl]))).toMatch(
      /row-level security/,
    )
    await asUser(w.adminTkl, `update public.categories set is_active = false where id = $1`, [id])
    expect(await asUser(w.kasirTkl, `select name, is_active from public.categories`)).toEqual([{ name: 'PARFUM', is_active: false }])
  })

  it('produk tidak dapat memakai kategori dari outlet lain', async () => {
    const [{ id }] = await asUser(w.owner, `insert into public.categories (outlet_id, name) values ($1, 'MKS only') returning id`, [w.mks])
    expect(await errorOf(asUser(w.owner, `select public.create_product($1, 'X', 'ML', 1, 0, 0, 0, $2)`, [w.tkl, id]))).toMatch(
      /foreign key/,
    )
  })
})

describe('Foto produk (storage policy)', () => {
  const upload = (user: string, path: string) =>
    asUser(user, `insert into storage.objects (bucket_id, name) values ('product-images', $1) returning id`, [path])

  it('hanya pengelola produk di outlet tsb yang dapat mengunggah & menghapus', async () => {
    await upload(w.adminTkl, `${w.tkl}/${uuid()}.webp`)
    expect(await errorOf(upload(w.kasirTkl, `${w.tkl}/${uuid()}.webp`))).toMatch(/row-level security/)
    expect(await errorOf(upload(w.adminTkl, `${w.mks}/${uuid()}.webp`))).toMatch(/row-level security/)
    expect(await errorOf(upload(w.adminTkl, `bukan-uuid/${uuid()}.webp`))).toMatch(/row-level security/)
    expect(await errorOf(upload(w.adminTkl, `${uuid()}.webp`))).toMatch(/row-level security/)
    const deleted = await asUser(w.kasirTkl, `delete from storage.objects where bucket_id = 'product-images' returning id`)
    expect(deleted).toHaveLength(0)
    const deleted2 = await asUser(w.adminTkl, `delete from storage.objects where bucket_id = 'product-images' and name like $1 returning id`, [
      `${w.tkl}/%`,
    ])
    expect(deleted2).toHaveLength(1)
  })

  it('bucket dibuat dengan batas ukuran 2 MB dan tipe gambar', async () => {
    const [b] = await sql(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'product-images'`)
    expect(b).toEqual({ public: true, file_size_limit: '2097152', allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] })
  })
})

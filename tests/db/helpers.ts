import pg from 'pg'
import { randomUUID } from 'node:crypto'

const base = new URL(process.env.DATABASE_URL ?? 'postgres://postgres@localhost:54329/postgres')
base.pathname = '/mun_pos_test'
export const pool = new pg.Pool({ connectionString: base.toString(), max: 10 })

// numeric dikembalikan sebagai string (tanpa float) — sama dengan kebutuhan aplikasi
pg.types.setTypeParser(1700, (v) => v)

/** Query sebagai superuser (setara service role / SQL editor). */
export async function sql<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
  return (await pool.query<T>(text, params)).rows
}

/**
 * Jalankan query sebagai pengguna terautentikasi (role `authenticated` +
 * klaim JWT sub), persis seperti PostgREST di Supabase. Setiap pemanggilan
 * = satu transaksi database.
 */
export async function asUser<T extends pg.QueryResultRow = any>(
  userId: string | null,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query(`set local role ${userId ? 'authenticated' : 'anon'}`)
    if (userId) await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
    const r = await c.query<T>(text, params)
    await c.query('commit')
    return r.rows
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

export async function createUser(email: string, fullName: string, username?: string) {
  const [u] = await sql<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [email, JSON.stringify({ full_name: fullName, username })],
  )
  return u.id
}

export const uuid = () => randomUUID()

export interface World {
  owner: string
  adminTkl: string
  kasirTkl: string
  kasirMks: string
  outsider: string
  tkl: string
  mks: string
}

let counter = 0
/** Membuat dunia uji terisolasi: 2 outlet + pengguna dengan peran berbeda. */
export async function createWorld(): Promise<World> {
  const n = ++counter + '_' + Math.random().toString(36).slice(2, 7)
  const code = (p: string) => (p + n.replace(/[^a-z0-9]/gi, '')).toUpperCase().slice(0, 6)
  const owner = await createUser(`owner${n}@test.local`, 'Nawir', `owner${n}`.slice(0, 32))
  const adminTkl = await createUser(`admin${n}@test.local`, 'Admin TKL')
  const kasirTkl = await createUser(`kasir${n}@test.local`, 'Kasir TKL')
  const kasirMks = await createUser(`kasirm${n}@test.local`, 'Kasir MKS')
  const outsider = await createUser(`out${n}@test.local`, 'Orang Luar')
  const [{ bootstrap_owner: tkl }] = await sql(`select private.bootstrap_owner($1, $2, 'MUN Parfum Takalar') as bootstrap_owner`, [
    `owner${n}@test.local`,
    code('T'),
  ])
  const [{ id: mks }] = await asUser(owner, `insert into public.outlets (code, name) values ($1, 'MUN Parfum Makassar') returning id`, [code('M')])
  await asUser(
    owner,
    `insert into public.outlet_users (outlet_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'kasir'), ($4, $5, 'kasir')`,
    [tkl, adminTkl, kasirTkl, mks, kasirMks],
  )
  return { owner, adminTkl, kasirTkl, kasirMks, outsider, tkl, mks }
}

/** Buat produk VALENTINE / SCANDALOUS sesuai spesifikasi. */
export async function createValentine(w: World, outlet = w.tkl, stock = '307') {
  const [{ create_product }] = await asUser(
    w.owner,
    `select public.create_product($1, 'VALENTINE / SCANDALOUS', 'ML', 2000, 1014, $2) as create_product`,
    [outlet, stock],
  )
  return create_product.id as string
}

export async function sell(
  userId: string,
  outlet: string,
  items: { product_id: string; quantity: string; discount_amount?: string }[],
  opts: { method?: string; received?: string | null; discount?: string; key?: string } = {},
) {
  const [{ r }] = await asUser(
    userId,
    `select public.create_sale($1, $2::jsonb, $3::public.payment_method, $4, $5, $6) as r`,
    [outlet, JSON.stringify(items), opts.method ?? 'cash', opts.received ?? null, opts.key ?? uuid(), opts.discount ?? '0'],
  )
  return r
}

export async function stockOf(productId: string) {
  const [{ current_stock }] = await sql(`select current_stock from public.products where id = $1`, [productId])
  return current_stock as string
}

/** Ambil pesan error dari promise yang ditolak. */
export async function errorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return (e as Error).message
  }
  throw new Error('Diharapkan gagal, tetapi berhasil')
}

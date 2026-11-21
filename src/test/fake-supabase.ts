import type { SupabaseClient } from '@supabase/supabase-js'
import type { OutletAccess } from '@/features/auth/permissions'
import { PERMISSIONS } from '@/features/auth/permissions'

export interface FakeUser {
  id: string
  email: string
  password: string
  full_name: string
  username?: string
  is_owner?: boolean
  access: OutletAccess[]
}

const TKL = { outlet_id: 'o-tkl', outlet_code: 'TKL', outlet_name: 'MUN Parfum Takalar' }
const MKS = { outlet_id: 'o-mks', outlet_code: 'MKS', outlet_name: 'MUN Parfum Makassar' }

export const USERS: Record<'owner' | 'admin' | 'kasir' | 'orphan', FakeUser> = {
  owner: {
    id: 'u-owner',
    email: 'owner@munparfum.id',
    password: 'rahasia123',
    full_name: 'Nawir',
    username: 'nawir08',
    is_owner: true,
    access: [
      { ...TKL, role: 'owner', permissions: [...PERMISSIONS] },
      { ...MKS, role: 'owner', permissions: [...PERMISSIONS] },
    ],
  },
  admin: {
    id: 'u-admin',
    email: 'admin@staff.munparfum.local',
    password: 'rahasia123',
    full_name: 'Admin TKL',
    username: 'admin',
    access: [
      {
        ...TKL,
        role: 'admin',
        permissions: ['pos.sell', 'transactions.view_all', 'transactions.void', 'products.manage', 'stock.manage', 'cost.view', 'reports.view', 'closing.perform'],
      },
    ],
  },
  kasir: {
    id: 'u-kasir',
    email: 'kasir1@staff.munparfum.local',
    password: 'rahasia123',
    full_name: 'Kasir Satu',
    username: 'kasir1',
    access: [{ ...TKL, role: 'kasir', permissions: ['pos.sell'] }],
  },
  orphan: { id: 'u-orphan', email: 'baru@munparfum.id', password: 'rahasia123', full_name: 'Baru', access: [] },
}

type Row = Record<string, unknown>

export interface FakeDb {
  products: Row[]
  categories: Row[]
  dashboard: Row | null
  uploads: string[]
  movements: Row[]
  /** Paksa RPC tertentu gagal (simulasi error server / jaringan). */
  failRpc: Record<string, { message: string; code?: string }>
}

export function seedDb(): FakeDb {
  const now = '2026-11-21T13:00:00Z'
  const p = (i: number, name: string, price: number, cost: number, stock: number, extra: Row = {}): Row => ({
    id: `p-${i}`,
    outlet_id: 'o-tkl',
    category_id: 'c-parfum',
    sku: `TKL-000${i}`,
    name,
    description: null,
    image_url: null,
    unit: 'ML',
    sell_price: price,
    cost_price: cost,
    current_stock: stock,
    min_stock: 50,
    is_active: true,
    created_at: now,
    updated_at: now,
    ...extra,
  })
  return {
    products: [
      p(1, 'VALENTINE / SCANDALOUS', 2000, 1014, 307),
      p(2, 'AIGNER BLUE / BLUE EMO', 3000, 1212, 231),
      p(3, 'SELENA GOMES', 2000, 1000, 48.5),
      p(4, 'BOTOL SPRAY 30ML', 5000, 2500, 0, { unit: 'PCS', category_id: null, min_stock: 5 }),
      p(5, 'PRODUK LAMA', 1000, 500, 10, { is_active: false }),
      p(6, 'PRODUK MAKASSAR', 2000, 1000, 100, { outlet_id: 'o-mks' }),
    ],
    categories: [
      { id: 'c-parfum', outlet_id: 'o-tkl', name: 'PARFUM', sort_order: 0, is_active: true },
      { id: 'c-lain', outlet_id: 'o-tkl', name: 'Lainnya', sort_order: 1, is_active: true },
    ],
    dashboard: null,
    uploads: [],
    movements: [
      { id: 'm-1', created_at: '2026-11-20T02:00:00Z', movement_type: 'initial', quantity: 307, stock_before: 0, stock_after: 307, reason: 'Stok awal', product_id: 'p-1', product_name: 'VALENTINE / SCANDALOUS', sku: 'TKL-0001', unit: 'ML', user_name: 'Nawir', transaction_id: null, transaction_number: null },
      { id: 'm-2', created_at: '2026-11-21T15:11:00Z', movement_type: 'sale', quantity: -10, stock_before: 317, stock_after: 307, reason: 'Penjualan', product_id: 'p-1', product_name: 'VALENTINE / SCANDALOUS', sku: 'TKL-0001', unit: 'ML', user_name: 'Kasir Satu', transaction_id: 't-1', transaction_number: 'MP-TKL-20261121-0001' },
      { id: 'm-3', created_at: '2026-11-21T03:00:00Z', movement_type: 'stock_out', quantity: -1.5, stock_before: 50, stock_after: 48.5, reason: 'Botol pecah / tumpah', product_id: 'p-3', product_name: 'SELENA GOMES', sku: 'TKL-0003', unit: 'ML', user_name: 'Admin TKL', transaction_id: null, transaction_number: null },
    ],
    failRpc: {},
  }
}

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: [string, unknown][] = []
  private mode: 'select' | 'insert' | 'update' = 'select'
  private payload: Row | null = null
  private wantSingle = false
  private rows: () => Row[]
  private columns: string[] | null
  private onInsert: (r: Row) => Row
  private table: string
  private log: { table: string; op: string; payload: unknown }[]
  constructor(
    rows: () => Row[],
    columns: string[] | null,
    onInsert: (r: Row) => Row,
    table: string,
    log: { table: string; op: string; payload: unknown }[],
  ) {
    this.rows = rows
    this.columns = columns
    this.onInsert = onInsert
    this.table = table
    this.log = log
  }
  select(cols?: string) {
    if (this.mode === 'select' && cols) this.columns = cols.split(',').map((c) => c.trim())
    return this
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, val])
    return this
  }
  order() {
    return this
  }
  single() {
    this.wantSingle = true
    return this
  }
  insert(row: Row) {
    this.mode = 'insert'
    this.payload = row
    return this
  }
  update(patch: Row) {
    this.mode = 'update'
    this.payload = patch
    return this
  }
  private run(): { data: unknown; error: unknown } {
    const match = (r: Row) => this.filters.every(([c, v]) => r[c] === v)
    if (this.mode === 'insert') {
      this.log.push({ table: this.table, op: 'insert', payload: this.payload })
      const created = this.onInsert(this.payload!)
      return { data: this.wantSingle ? created : [created], error: null }
    }
    if (this.mode === 'update') {
      this.log.push({ table: this.table, op: 'update', payload: this.payload })
      this.rows().filter(match).forEach((r) => Object.assign(r, this.payload))
      return { data: null, error: null }
    }
    const pick = (r: Row) => (this.columns ? Object.fromEntries(this.columns.map((c) => [c, r[c]])) : { ...r })
    const out = this.rows().filter(match).map(pick)
    if (this.wantSingle) return out[0] ? { data: out[0], error: null } : { data: null, error: { message: 'not found' } }
    return { data: out, error: null }
  }
  then<A, B>(ok?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(ok, fail)
  }
}

/** Klien Supabase palsu: auth + backend kecil di memori untuk tes UI. */
export function createFakeSupabase(initialUser: FakeUser | null = null, db: FakeDb = seedDb()) {
  let current: FakeUser | null = initialUser
  const listeners = new Set<(event: string, session: unknown) => void>()
  const sessionOf = (u: FakeUser | null) => (u ? { access_token: 't', user: { id: u.id, email: u.email } } : null)
  const calls = {
    signIn: [] as string[],
    signOut: 0,
    rpc: [] as { fn: string; args: Record<string, unknown> }[],
    writes: [] as { table: string; op: string; payload: unknown }[],
  }
  const perms = (outlet: unknown) => current?.access.find((a) => a.outlet_id === outlet)?.permissions ?? []
  let skuCounter = 100

  const client = {
    auth: {
      getSession: async () => ({ data: { session: sessionOf(current) }, error: null }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        listeners.add(cb)
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }
      },
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        calls.signIn.push(email)
        const u = Object.values(USERS).find((x) => x.email === email && x.password === password)
        if (!u) return { data: { session: null }, error: { message: 'Invalid login credentials' } }
        current = u
        return { data: { session: sessionOf(u) }, error: null }
      },
      signOut: async () => {
        calls.signOut++
        current = null
        return { error: null }
      },
    },
    from: (table: string) => {
      const noop = (r: Row) => r
      switch (table) {
        case 'profiles':
          return new Query(
            () =>
              current
                ? [{ id: current.id, full_name: current.full_name, username: current.username ?? null, is_owner: !!current.is_owner, is_active: true }]
                : [],
            null, noop, table, calls.writes,
          )
        case 'products':
          // seperti column privilege: cost_price tidak pernah dikembalikan dari tabel
          return new Query(
            () => db.products.filter((p) => perms(p.outlet_id).length > 0).map((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'cost_price'))),
            null, noop, table, calls.writes,
          )
        case 'product_costs':
          return new Query(
            () =>
              db.products
                .filter((p) => perms(p.outlet_id).includes('cost.view'))
                .map((p) => ({ product_id: p.id, outlet_id: p.outlet_id, cost_price: p.cost_price })),
            null, noop, table, calls.writes,
          )
        case 'categories':
          return new Query(
            () => db.categories.filter((c) => perms(c.outlet_id).length > 0),
            null,
            (r) => {
              const row = { id: `c-${db.categories.length + 1}`, sort_order: 0, is_active: true, ...r }
              db.categories.push(row)
              return row
            },
            table,
            calls.writes,
          )
        default:
          throw new Error('tabel tidak didukung: ' + table)
      }
    },
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      calls.rpc.push({ fn, args })
      if (db.failRpc[fn]) return { data: null, error: db.failRpc[fn] }
      switch (fn) {
        case 'get_stock_summary': {
          const act = db.products.filter((p) => p.outlet_id === args.p_outlet_id && p.is_active)
          const st = (p: Row) => Number(p.current_stock)
          return {
            data: {
              active_count: act.length,
              low_count: act.filter((p) => st(p) > 0 && st(p) <= Number(p.min_stock)).length,
              empty_count: act.filter((p) => st(p) <= 0).length,
              value_at_sell_price: act.reduce((n, p) => n + Math.max(st(p), 0) * Number(p.sell_price), 0),
              value_at_cost: perms(args.p_outlet_id).includes('cost.view')
                ? act.reduce((n, p) => n + Math.max(st(p), 0) * Number(p.cost_price), 0)
                : null,
            },
            error: null,
          }
        }
        case 'get_stock_movements': {
          const list = db.movements
            .filter((m) => !args.p_product_id || m.product_id === args.p_product_id)
            .filter((m) => !args.p_types || (args.p_types as string[]).includes(m.movement_type as string))
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
          const off = Number(args.p_offset)
          return { data: { total: list.length, summary: [], items: list.slice(off, off + Number(args.p_limit)) }, error: null }
        }
        case 'adjust_stock': {
          const existing = db.movements.find((m) => m.idempotency_key === args.p_idempotency_key)
          if (existing) return { data: { ...existing, replayed: true }, error: null }
          const p = db.products.find((x) => x.id === args.p_product_id)!
          const before = Number(p.current_stock)
          const q = Number(args.p_quantity)
          const delta = args.p_type === 'adjustment' ? q - before : args.p_type === 'stock_in' ? q : -q
          if (before + delta < 0) return { data: null, error: { code: 'P0001', message: `Stok ${p.name} tidak cukup (tersedia ${before}, dibutuhkan ${q})` } }
          p.current_stock = before + delta
          const mv = {
            id: `m-${db.movements.length + 1}`, created_at: '2026-11-21T16:00:00Z', movement_type: args.p_type, quantity: delta,
            stock_before: before, stock_after: before + delta, reason: args.p_reason || null, product_id: p.id, product_name: p.name,
            sku: p.sku, unit: p.unit, user_name: current?.full_name ?? null, transaction_id: null, transaction_number: null,
            idempotency_key: args.p_idempotency_key,
          }
          db.movements.push(mv)
          return { data: { ...mv, replayed: false }, error: null }
        }
        case 'my_access':
          return { data: current?.access ?? [], error: null }
        case 'get_dashboard':
          return { data: db.dashboard, error: db.dashboard ? null : { message: 'Gagal memuat' } }
        case 'create_product': {
          if (!perms(args.p_outlet_id).includes('products.manage')) return { data: null, error: { code: '42501', message: 'Akses ditolak: izin products.manage diperlukan' } }
          const sku = (args.p_sku as string | null) ?? `TKL-0${++skuCounter}`
          if (db.products.some((p) => p.sku === sku)) return { data: null, error: { code: '23505', message: `SKU ${sku} sudah dipakai` } }
          const id = `p-new-${db.products.length + 1}`
          db.products.push({
            id, outlet_id: args.p_outlet_id, category_id: args.p_category_id, sku, name: args.p_name, description: args.p_description,
            image_url: args.p_image_url, unit: args.p_unit, sell_price: Number(args.p_sell_price), cost_price: Number(args.p_cost_price),
            current_stock: Number(args.p_initial_stock), min_stock: Number(args.p_min_stock), is_active: true,
            created_at: '2026-11-21T13:00:00Z', updated_at: '2026-11-21T13:00:00Z',
          })
          return { data: { id, sku }, error: null }
        }
        case 'update_product': {
          const p = db.products.find((x) => x.id === args.p_product_id)!
          Object.assign(p, {
            name: args.p_name, unit: args.p_unit, sell_price: Number(args.p_sell_price), min_stock: Number(args.p_min_stock),
            category_id: args.p_category_id, description: args.p_description, image_url: args.p_image_url,
            sku: args.p_sku ?? p.sku, is_active: args.p_is_active,
            ...(args.p_cost_price !== null ? { cost_price: Number(args.p_cost_price) } : {}),
          })
          return { data: { id: p.id, sku: p.sku }, error: null }
        }
        case 'set_product_active': {
          const p = db.products.find((x) => x.id === args.p_product_id)!
          p.is_active = args.p_is_active
          return { data: null, error: null }
        }
        default:
          throw new Error('rpc tidak didukung: ' + fn)
      }
    },
    storage: {
      from: () => ({
        upload: async (path: string) => {
          db.uploads.push(path)
          return { data: { path }, error: null }
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
      }),
    },
  }
  return { client: client as unknown as SupabaseClient, calls, db }
}

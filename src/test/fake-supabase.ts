import type { SupabaseClient } from '@supabase/supabase-js'
import type { OutletAccess } from '@/features/auth/permissions'
import { PERMISSIONS } from '@/features/auth/permissions'
import { calcSale } from '@/lib/sale-calc'

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
  /** RPC dijalankan di server, tetapi responsnya "hilang" (jaringan putus). */
  dropResponseOnce: Record<string, boolean>
  transactions: Row[]
  settings: Row[]
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
    dropResponseOnce: {},
    transactions: [],
    settings: [],
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

  const saleResult = (t: Row) => ({
    id: t.id,
    number: t.number,
    business_date: t.business_date,
    status: t.status,
    total: t.total,
    subtotal: t.subtotal,
    item_count: t.item_count,
    payment_method: t.payment_method,
    amount_paid: t.amount_paid,
    change_amount: t.change_amount,
    created_at: t.created_at,
  })

  async function runRpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> {
      switch (fn) {
        case 'create_sale': {
          const existing = db.transactions.find((t) => t.idempotency_key === args.p_idempotency_key)
          if (existing) return { data: { ...saleResult(existing), replayed: true }, error: null }
          if (!perms(args.p_outlet_id).includes('pos.sell')) return { data: null, error: { code: '42501', message: 'Akses ditolak: izin pos.sell diperlukan' } }
          const items = args.p_items as { product_id: string; quantity: string; discount_amount: string }[]
          const prods = items.map((i) => db.products.find((p) => p.id === i.product_id)!)
          const need = new Map<string, number>()
          items.forEach((i) => need.set(i.product_id, (need.get(i.product_id) ?? 0) + Number(i.quantity)))
          for (const p of prods) {
            if (Number(p.current_stock) < need.get(p.id as string)!) {
              return { data: null, error: { code: 'P0001', hint: 'INSUFFICIENT_STOCK', message: `Stok ${p.name} tidak cukup (tersedia ${p.current_stock}, dibutuhkan ${need.get(p.id as string)})` } }
            }
          }
          const r = calcSale(
            items.map((i, k) => ({ price: String(prods[k].sell_price), cost: String(prods[k].cost_price), qty: i.quantity, discount: i.discount_amount })),
            String(args.p_discount_amount ?? '0'),
          )
          const total = r.total.toNumber()
          const cash = args.p_payment_method === 'cash'
          const received = cash ? Number(args.p_amount_received) : total
          if (cash && received < total) return { data: null, error: { code: '22023', message: 'Uang diterima kurang dari total belanja' } }
          prods.forEach((p, k) => (p.current_stock = Number(p.current_stock) - Number(items[k].quantity)))
          const n = db.transactions.length + 1
          const t: Row = {
            id: `t-${n}`, number: `MP-TKL-20261121-${String(n).padStart(4, '0')}`, business_date: '2026-11-21', created_at: '2026-11-21T15:30:00Z',
            status: 'completed', customer_name: args.p_customer_name ?? null, note: args.p_note ?? null,
            subtotal: r.subtotal.toNumber(), item_discount_total: r.itemDiscountTotal.toNumber(), discount_amount: r.transactionDiscount.toNumber(),
            total, item_count: items.length, payment_method: args.p_payment_method, amount_paid: received, change_amount: received - total,
            cost_total: r.costTotal.toNumber(), gross_profit: r.grossProfit.toNumber(), idempotency_key: args.p_idempotency_key,
            cashier_id: current?.id, cashier_name: current?.full_name, voided_at: null, void_reason: null, voided_by_name: null,
            reference: args.p_payment_reference ?? null,
            items: items.map((i, k) => ({
              id: `ti-${n}-${k}`, product_id: i.product_id, product_name: prods[k].name, sku: prods[k].sku, unit: prods[k].unit,
              quantity: Number(i.quantity), unit_price: Number(prods[k].sell_price), subtotal: r.lines[k].subtotal.toNumber(),
              discount_amount: r.lines[k].discount.toNumber(), total: r.lines[k].total.toNumber(), gross_profit: r.lines[k].grossProfit.toNumber(),
            })),
          }
          db.transactions.push(t)
          return { data: { ...saleResult(t), replayed: false }, error: null }
        }
        case 'get_transactions': {
          const all = perms(args.p_outlet_id).includes('transactions.view_all')
          const search = String(args.p_search ?? '').toLowerCase()
          const list = db.transactions
            .filter((t) => all || t.cashier_id === current?.id)
            .filter((t) => !args.p_status || t.status === args.p_status)
            .filter((t) => !args.p_method || t.payment_method === args.p_method)
            .filter((t) => !search || String(t.number).toLowerCase().includes(search) || (t.items as Row[]).some((i) => String(i.product_name).toLowerCase().includes(search)))
            .slice()
            .reverse()
          const done = list.filter((t) => t.status === 'completed')
          return {
            data: {
              scope: all ? 'outlet' : 'own',
              total: list.length,
              completed_count: done.length,
              completed_amount: done.reduce((n, t) => n + Number(t.total), 0),
              items: list.map((t) => ({ ...saleResult(t), customer_name: t.customer_name, cashier_name: t.cashier_name, items: (t.items as Row[]).map((i) => i.product_name).join(', ') })),
            },
            error: null,
          }
        }
        case 'get_transaction_detail': {
          const t = db.transactions.find((x) => x.id === args.p_transaction_id)
          if (!t) return { data: null, error: { code: 'P0002', message: 'Transaksi tidak ditemukan' } }
          const p = perms('o-tkl')
          const profit = p.includes('profit.view')
          return {
            data: {
              ...t,
              cost_total: profit ? t.cost_total : null,
              gross_profit: profit ? t.gross_profit : null,
              items: (t.items as Row[]).map((i) => ({ ...i, gross_profit: profit ? i.gross_profit : null })),
              can_void: t.status === 'completed' && p.includes('transactions.void'),
              outlet: { name: 'MUN Parfum Takalar', code: 'TKL', address: 'Jl. Poros Takalar', phone: '0812-0000-0000' },
              receipt_footer: 'Terima kasih atas kunjungan Anda',
              payments: [{ method: t.payment_method, amount: t.total, amount_received: t.amount_paid, change_amount: t.change_amount, reference: t.reference }],
            },
            error: null,
          }
        }
        case 'void_transaction': {
          const t = db.transactions.find((x) => x.id === args.p_transaction_id)!
          if (!perms('o-tkl').includes('transactions.void')) return { data: null, error: { code: '42501', message: 'Akses ditolak: izin transactions.void diperlukan' } }
          for (const i of t.items as Row[]) {
            const p = db.products.find((x) => x.id === i.product_id)!
            p.current_stock = Number(p.current_stock) + Number(i.quantity)
          }
          Object.assign(t, { status: 'void', voided_at: '2026-11-21T16:00:00Z', void_reason: args.p_reason, voided_by_name: current?.full_name })
          return { data: saleResult(t), error: null }
        }
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
  }

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
        case 'app_settings':
          return new Query(() => db.settings, null, noop, table, calls.writes)
        default:
          throw new Error('tabel tidak didukung: ' + table)
      }
    },
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      calls.rpc.push({ fn, args })
      if (db.failRpc[fn]) return { data: null, error: db.failRpc[fn] }
      const result = await runRpc(fn, args)
      if (db.dropResponseOnce[fn]) {
        delete db.dropResponseOnce[fn]
        return { data: null, error: { message: 'TypeError: Failed to fetch' } }
      }
      return result
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

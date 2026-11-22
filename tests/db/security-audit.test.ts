import { sql } from './helpers'

/**
 * Audit keamanan berbasis katalog PostgreSQL (mirip Supabase Security
 * Advisor). Gagal bila migration baru melanggar aturan keamanan dasar.
 */
describe('Audit keamanan skema', () => {
  it('RLS aktif di SEMUA tabel schema public', async () => {
    const rows = await sql(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                            where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)
    expect(rows).toEqual([])
  })

  it('role anon tidak punya hak apa pun pada tabel, view, atau sequence public', async () => {
    const rows = await sql(`select table_name, privilege_type from information_schema.role_table_grants
                            where grantee = 'anon' and table_schema = 'public'`)
    expect(rows).toEqual([])
  })

  it('tidak ada fungsi public/private yang dapat dieksekusi anon atau PUBLIC', async () => {
    const rows = await sql(`
      select n.nspname || '.' || p.proname as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
        and (has_function_privilege('anon', p.oid, 'EXECUTE')
             or coalesce(p.proacl::text, '') like '%{=X%' or coalesce(p.proacl::text, '') like '%,=X%')`)
    expect(rows).toEqual([])
  })

  it('semua fungsi SECURITY DEFINER memakai search_path tetap', async () => {
    const rows = await sql(`
      select n.nspname || '.' || p.proname as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`)
    expect(rows).toEqual([])
  })

  it('schema private tidak dapat diakses klien', async () => {
    const [r] = await sql(`select has_schema_privilege('authenticated', 'private', 'USAGE') a, has_schema_privilege('anon', 'private', 'USAGE') b`)
    expect(r).toEqual({ a: false, b: false })
  })

  it('kolom HPP & laba tidak dapat dibaca langsung oleh authenticated', async () => {
    const cols = [
      ['products', 'cost_price'],
      ['transactions', 'cost_total'],
      ['transactions', 'gross_profit'],
      ['transaction_items', 'unit_cost'],
      ['transaction_items', 'cost_total'],
      ['transaction_items', 'gross_profit'],
    ]
    for (const [t, c] of cols) {
      const [{ ok }] = await sql(`select has_column_privilege('authenticated', $1, $2, 'SELECT') ok`, [`public.${t}`, c])
      expect(ok, `${t}.${c}`).toBe(false)
    }
  })

  it('tabel kritis tidak dapat ditulis langsung oleh authenticated', async () => {
    for (const t of ['products', 'transactions', 'transaction_items', 'payments', 'stock_movements', 'cash_sessions', 'audit_logs', 'outlet_counters']) {
      const [r] = await sql(
        `select has_table_privilege('authenticated', $1, 'INSERT') i, has_table_privilege('authenticated', $1, 'UPDATE') u, has_table_privilege('authenticated', $1, 'DELETE') d`,
        [`public.${t}`],
      )
      expect(r, t).toEqual({ i: false, u: false, d: false })
    }
    const deletable = await sql(`select table_name from information_schema.role_table_grants
                                 where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('DELETE', 'TRUNCATE')`)
    expect(deletable).toEqual([])
  })

  it('view security definer hanya 3 view sensitif yang disengaja, semuanya security_barrier', async () => {
    const rows = await sql(`
      select c.relname, coalesce(c.reloptions, '{}') as opts
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v'
      order by c.relname`)
    expect(rows.map((r) => r.relname)).toEqual(['product_costs', 'transaction_item_profits', 'transaction_profits'])
    for (const r of rows) {
      expect(r.opts).toContain('security_barrier=true')
      expect(r.opts.some((o: string) => o.startsWith('security_invoker'))).toBe(false) // sengaja definer, difilter has_permission()
    }
    for (const v of ['product_costs', 'transaction_profits', 'transaction_item_profits']) {
      const [{ def }] = await sql(`select pg_get_viewdef($1::regclass) def`, [`public.${v}`])
      expect(def, v).toMatch(/has_permission/)
    }
  })

  it('setiap foreign key ber-index (kinerja RLS & join)', async () => {
    const rows = await sql(`
      select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and n.nspname = 'public'
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])`)
    // daftar yang tersisa harus disetujui secara sadar (tabel kecil / jarang di-join)
    const allowed = new Set([
      'categories.outlet_id', 'products.created_by', 'outlet_users.outlet_id', 'cash_sessions.outlet_id', 'cash_sessions.opened_by',
      'cash_sessions.closed_by', 'transactions.voided_by', 'transaction_items.outlet_id', 'payments.outlet_id', 'stock_movements.created_by',
      'expenses.created_by', 'expenses.deleted_by', 'audit_logs.user_id', 'app_settings.outlet_id', 'app_settings.updated_by', 'outlet_counters.outlet_id',
    ])
    const missing = rows.map((r) => `${r.tbl.replace('public.', '')}.${r.col}`).filter((k) => !allowed.has(k))
    expect(missing).toEqual([])
  })
})

describe('Pengerasan (0900)', () => {
  it('URL foto produk & logo outlet hanya http(s)', async () => {
    const { createWorld, asUser, errorOf } = await import('./helpers')
    const w = await createWorld()
    expect(
      await errorOf(asUser(w.owner, `select public.create_product($1, 'X', 'ML', 1, 0, 0, 0, null, null, 'javascript:alert(1)')`, [w.tkl])),
    ).toMatch(/products_image_url_http/)
    expect(await errorOf(asUser(w.owner, `update public.outlets set logo_url = 'data:text/html,hi' where id = $1`, [w.tkl]))).toMatch(
      /outlets_logo_url_http/,
    )
    await asUser(w.owner, `select public.create_product($1, 'Y', 'ML', 1, 0, 0, 0, null, null, 'https://x.supabase.co/storage/v1/object/public/a.png')`, [w.tkl])
  })
})

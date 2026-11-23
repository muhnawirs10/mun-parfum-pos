/**
 * Server tiruan Supabase untuk pengujian E2E — HANYA untuk tes.
 *
 * Meniru bagian antarmuka HTTP Supabase yang dipakai aplikasi (Auth, PostgREST,
 * Edge Function admin-users) dan meneruskan setiap permintaan ke PostgreSQL
 * sungguhan yang berisi migration asli. Query data dijalankan dengan
 * `SET LOCAL ROLE authenticated` + klaim JWT `sub`, sama seperti PostgREST,
 * sehingga RLS, column privilege, dan RPC yang diuji adalah yang asli.
 *
 * Bukan pengganti Supabase: tidak ada validasi tanda tangan JWT, rate limit,
 * atau fitur lain di luar yang dipakai aplikasi.
 */
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { handle as handleAdminUsers } from '../../../supabase/functions/admin-users/handler'

pg.types.setTypeParser(1700, (v) => Number(v)) // numeric → JSON number (seperti PostgREST)
pg.types.setTypeParser(20, (v) => Number(v)) // bigint

const IDENT = /^[a-z_][a-z0-9_]*$/

interface ShimState {
  passwords: Map<string, string> // email → password
  banned: Set<string> // user id
}

export interface Shim {
  url: string
  state: ShimState
  close(): Promise<void>
}

function b64(o: unknown) {
  return Buffer.from(JSON.stringify(o)).toString('base64url')
}
function makeToken(sub: string) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  return { token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', aud: 'authenticated', exp })}.shim`, exp }
}
function subOf(req: http.IncomingMessage): string | null {
  const auth = req.headers.authorization ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString())
    return payload.role === 'authenticated' && typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}

const PG_STATUS: Record<string, number> = { '42501': 403, P0002: 404, '23505': 409, '28000': 401, '42883': 404, '42P01': 404 }

/** Ambil isi file dari body unggahan storage-js (multipart/form-data atau mentah). */
function extractFile(buf: Buffer, contentType: string): Buffer {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType)
  if (!m) return buf
  const boundary = Buffer.from('--' + (m[1] ?? m[2]))
  let start = 0
  while ((start = buf.indexOf(boundary, start)) !== -1) {
    const headEnd = buf.indexOf('\r\n\r\n', start)
    if (headEnd === -1) break
    const head = buf.subarray(start, headEnd).toString()
    const next = buf.indexOf(boundary, headEnd)
    if (/filename=|Content-Type: image\//i.test(head)) return buf.subarray(headEnd + 4, next - 2)
    start = next
  }
  return buf
}

export async function startShim(databaseUrl: string, port: number): Promise<Shim> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 })
  const state: ShimState = { passwords: new Map(), banned: new Set() }
  const files = new Map<string, Buffer>()
  const signed = new Map<string, string>()
  const fnCache = new Map<string, { args: { name: string; type: string }[]; setof: boolean }>()

  async function asUser<T>(sub: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await c.query(`set local role ${sub ? 'authenticated' : 'anon'}`)
      if (sub) await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub])
      const r = await fn(c)
      await c.query('commit')
      return r
    } catch (e) {
      await c.query('rollback').catch(() => {})
      throw e
    } finally {
      c.release()
    }
  }

  async function fnInfo(name: string) {
    if (!fnCache.has(name)) {
      const { rows } = await pool.query(
        `select p.proretset,
                coalesce(p.proargnames, '{}') as names,
                array(select format_type(t, null) from unnest(p.proargtypes) t) as types
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = $1`,
        [name],
      )
      if (!rows[0]) return null
      const types: string[] = rows[0].types
      fnCache.set(name, { setof: rows[0].proretset, args: types.map((type, i) => ({ name: rows[0].names[i], type })) })
    }
    return fnCache.get(name)!
  }

  async function rpc(sub: string | null, name: string, body: Record<string, unknown>) {
    if (!IDENT.test(name)) throw Object.assign(new Error('fungsi tidak valid'), { code: '42883' })
    const info = await fnInfo(name)
    if (!info) throw Object.assign(new Error(`function public.${name} does not exist`), { code: '42883' })
    const params: unknown[] = []
    const parts: string[] = []
    for (const [k, v] of Object.entries(body ?? {})) {
      const arg = info.args.find((a) => a.name === k)
      if (!arg) throw Object.assign(new Error(`argumen ${k} tidak dikenal`), { code: '42883' })
      params.push(v !== null && arg.type === 'jsonb' ? JSON.stringify(v) : v)
      parts.push(`${k} => $${params.length}::${arg.type}`)
    }
    const call = `public.${name}(${parts.join(', ')})`
    return asUser(sub, async (c) => {
      if (info.setof) return (await c.query(`select * from ${call}`, params)).rows
      const { rows } = await c.query(`select ${call} as r`, params)
      return rows[0]?.r ?? null
    })
  }

  function parseFilters(url: URL) {
    const where: string[] = []
    const params: unknown[] = []
    for (const [k, v] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue
      if (!IDENT.test(k)) throw Object.assign(new Error('kolom tidak valid'), { code: '42703' })
      const m = /^(eq|is)\.(.*)$/.exec(v)
      if (!m) throw Object.assign(new Error(`filter ${v} tidak didukung shim`), { code: '42601' })
      if (m[1] === 'is' && m[2] === 'null') where.push(`${k} is null`)
      else {
        params.push(m[2])
        where.push(`${k} = $${params.length}`)
      }
    }
    return { where, params }
  }
  function columns(sel: string | null) {
    if (!sel || sel === '*') return '*'
    const cols = sel.split(',').map((s) => s.trim())
    if (!cols.every((c) => IDENT.test(c))) throw Object.assign(new Error('select tidak didukung shim'), { code: '42601' })
    return cols.join(', ')
  }
  function orderBy(url: URL) {
    const o = url.searchParams.getAll('order').flatMap((x) => x.split(','))
    if (!o.length) return ''
    return (
      ' order by ' +
      o
        .map((x) => {
          const [col, dir] = x.split('.')
          if (!IDENT.test(col)) throw Object.assign(new Error('order tidak valid'), { code: '42601' })
          return `${col} ${dir === 'desc' ? 'desc' : 'asc'}`
        })
        .join(', ')
    )
  }

  async function table(method: string, sub: string | null, name: string, url: URL, body: unknown, wantsObject: boolean) {
    if (!IDENT.test(name)) throw Object.assign(new Error('tabel tidak valid'), { code: '42P01' })
    const sel = url.searchParams.get('select')
    return asUser(sub, async (c) => {
      if (method === 'GET') {
        const f = parseFilters(url)
        const { rows } = await c.query(`select ${columns(sel)} from public.${name}${f.where.length ? ' where ' + f.where.join(' and ') : ''}${orderBy(url)}`, f.params)
        return rows
      }
      if (method === 'POST') {
        const rowsIn = Array.isArray(body) ? body : [body]
        const out: unknown[] = []
        for (const r of rowsIn as Record<string, unknown>[]) {
          const keys = Object.keys(r)
          if (!keys.every((k) => IDENT.test(k))) throw Object.assign(new Error('kolom tidak valid'), { code: '42703' })
          const { rows } = await c.query(
            `insert into public.${name} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})${sel ? ` returning ${columns(sel)}` : ''}`,
            keys.map((k) => r[k]),
          )
          out.push(...rows)
        }
        return out
      }
      if (method === 'PATCH') {
        const f = parseFilters(url)
        const patch = body as Record<string, unknown>
        const keys = Object.keys(patch)
        if (!keys.every((k) => IDENT.test(k))) throw Object.assign(new Error('kolom tidak valid'), { code: '42703' })
        const params = [...f.params, ...keys.map((k) => patch[k])]
        const sets = keys.map((k, i) => `${k} = $${f.params.length + i + 1}`)
        const { rows } = await c.query(
          `update public.${name} set ${sets.join(', ')}${f.where.length ? ' where ' + f.where.join(' and ') : ''}${sel ? ` returning ${columns(sel)}` : ''}`,
          params,
        )
        return rows
      }
      throw Object.assign(new Error('metode tidak didukung'), { code: '42601' })
    }).then((rows) => (wantsObject ? rows : rows))
  }

  async function userById(id: string) {
    const { rows } = await pool.query(`select id, email, raw_user_meta_data from auth.users where id = $1`, [id])
    const u = rows[0]
    return u && { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', user_metadata: u.raw_user_meta_data, app_metadata: {} }
  }

  function send(res: http.ServerResponse, status: number, body?: unknown) {
    res.writeHead(status, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Range',
      'Content-Type': 'application/json',
    })
    res.end(body === undefined ? '' : JSON.stringify(body))
  }
  function pgError(res: http.ServerResponse, e: { code?: string; message: string; hint?: string; detail?: string }) {
    send(res, PG_STATUS[e.code ?? ''] ?? 400, { code: e.code ?? 'PGRST000', message: e.message, details: e.detail ?? null, hint: e.hint ?? null })
  }

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
      })
      return res.end()
    }
    const url = new URL(req.url ?? '/', 'http://shim')
    const chunks: Buffer[] = []
    for await (const ch of req) chunks.push(ch as Buffer)
    const rawBuf = Buffer.concat(chunks)
    const sub = subOf(req)
    const path = url.pathname

    // ── Storage bucket 'attendance' (foto absensi) — RLS storage.objects asli ──
    const att = /^\/storage\/v1\/object\/(sign\/)?attendance\/(.+)$/.exec(path)
    if (att) {
      try {
        const name = decodeURIComponent(att[2])
        if (!att[1] && req.method === 'POST') {
          await asUser(sub, (c) => c.query(`insert into storage.objects (bucket_id, name) values ('attendance', $1)`, [name]))
          files.set(name, extractFile(rawBuf, String(req.headers['content-type'] ?? '')))
          return send(res, 200, { Key: `attendance/${name}`, Id: randomUUID() })
        }
        if (att[1] && req.method === 'POST') {
          const { rows } = await asUser(sub, (c) => c.query(`select 1 from storage.objects where bucket_id = 'attendance' and name = $1`, [name]))
          if (!rows.length) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' })
          const t = randomUUID()
          signed.set(t, name)
          return send(res, 200, { signedURL: `/object/sign/attendance/${att[2]}?token=${t}` })
        }
        if (att[1] && req.method === 'GET') {
          const file = signed.get(url.searchParams.get('token') ?? '') === name ? files.get(name) : undefined
          if (!file) return send(res, 400, { message: 'invalid signature' })
          res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*' })
          return res.end(file)
        }
      } catch (e) {
        const err = e as { code?: string; message: string }
        return send(res, err.code === '42501' ? 403 : 400, { statusCode: '403', error: 'Unauthorized', message: err.message })
      }
    }

    const raw = rawBuf.toString()
    let body: unknown = undefined
    try {
      body = raw ? JSON.parse(raw) : undefined
    } catch {
      return send(res, 400, { message: 'JSON tidak valid' })
    }

    try {
      // ── Auth ────────────────────────────────────────────────────────
      if (path === '/auth/v1/token') {
        const grant = url.searchParams.get('grant_type')
        let userId: string | null = null
        if (grant === 'password') {
          const { email, password } = body as { email: string; password: string }
          const { rows } = await pool.query(`select id from auth.users where lower(email) = lower($1)`, [email])
          if (rows[0] && state.passwords.get(String(email).toLowerCase()) === password && !state.banned.has(rows[0].id)) userId = rows[0].id
        } else if (grant === 'refresh_token') {
          const rt = (body as { refresh_token: string }).refresh_token
          userId = rt?.startsWith('r-') ? rt.slice(2) : null
        }
        if (!userId) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
        const { token, exp } = makeToken(userId)
        return send(res, 200, { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: `r-${userId}`, user: await userById(userId) })
      }
      if (path === '/auth/v1/user') {
        if (!sub) return send(res, 401, { code: 401, msg: 'Invalid token' })
        if (req.method === 'PUT') {
          const { password } = body as { password?: string }
          const u = await userById(sub)
          if (password) state.passwords.set(u.email.toLowerCase(), password)
          return send(res, 200, u)
        }
        return send(res, 200, await userById(sub))
      }
      if (path === '/auth/v1/logout') return send(res, 204)

      // ── PostgREST: RPC ─────────────────────────────────────────────
      const rpcMatch = /^\/rest\/v1\/rpc\/([a-z_0-9]+)$/.exec(path)
      if (rpcMatch && req.method === 'POST') {
        const result = await rpc(sub, rpcMatch[1], (body ?? {}) as Record<string, unknown>)
        return send(res, 200, result)
      }

      // ── PostgREST: tabel ───────────────────────────────────────────
      const tableMatch = /^\/rest\/v1\/([a-z_0-9]+)$/.exec(path)
      if (tableMatch) {
        const wantsObject = String(req.headers.accept ?? '').includes('vnd.pgrst.object')
        const rows = (await table(req.method ?? 'GET', sub, tableMatch[1], url, body, wantsObject)) as unknown[]
        if (wantsObject) {
          if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' })
          return send(res, 200, rows[0])
        }
        const returnRep = String(req.headers.prefer ?? '').includes('return=representation')
        if (req.method === 'GET' || returnRep) return send(res, req.method === 'POST' ? 201 : 200, rows)
        return send(res, req.method === 'POST' ? 201 : 204)
      }

      // ── Edge Function admin-users (handler asli) ───────────────────
      if (path === '/functions/v1/admin-users' && req.method === 'POST') {
        const result = await handleAdminUsers(body, {
          getCaller: async () => (sub ? { id: sub } : null),
          callerRpc: async (fn, args) => {
            try {
              return { data: await rpc(sub, fn, args), error: null }
            } catch (e) {
              const err = e as { code?: string; message: string }
              return { data: null, error: { code: err.code, message: err.message } }
            }
          },
          admin: {
            createUser: async (a) => {
              const exists = await pool.query(`select 1 from auth.users where lower(email) = lower($1)`, [a.email])
              if (exists.rowCount) return { data: null, error: { message: 'A user with this email address has already been registered' } }
              const { rows } = await pool.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [a.email, JSON.stringify(a.user_metadata)])
              state.passwords.set(a.email.toLowerCase(), a.password)
              return { data: { user: { id: rows[0].id } }, error: null }
            },
            deleteUser: async (id) => {
              await pool.query(`delete from auth.users where id = $1`, [id])
              return { error: null }
            },
            updateUserById: async (id, attrs) => {
              const { rows } = await pool.query(`select email from auth.users where id = $1`, [id])
              if (typeof attrs.password === 'string') state.passwords.set(rows[0].email.toLowerCase(), attrs.password)
              if (attrs.ban_duration === 'none') state.banned.delete(id)
              else if (attrs.ban_duration) state.banned.add(id)
              return { error: null }
            },
          },
          staffDomain: 'staff.munparfum.local',
        })
        return send(res, result.status, result.body)
      }

      // ── Storage (unggah foto tidak diuji di E2E) ───────────────────
      if (path.startsWith('/storage/v1/object/')) return send(res, 200, { Key: path, Id: randomUUID() })

      return send(res, 404, { message: `shim: ${req.method} ${path} tidak didukung` })
    } catch (e) {
      return pgError(res, e as { code?: string; message: string })
    }
  })

  await new Promise<void>((resolve) => server.listen(port, resolve))
  return {
    url: `http://localhost:${port}`,
    state,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()))
      await pool.end()
    },
  }
}

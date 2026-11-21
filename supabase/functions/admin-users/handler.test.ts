// @vitest-environment node
import { handle, type Deps } from './handler'

const OUTLET = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'

function deps(over: Partial<{ caller: boolean; can: unknown; canErr: boolean; assignErr: boolean; createErr: string | null }> = {}) {
  const calls: string[] = []
  const d: Deps = {
    getCaller: async () => (over.caller === false ? null : { id: 'caller' }),
    callerRpc: async (fn, args) => {
      calls.push(`rpc:${fn}:${JSON.stringify(args)}`)
      if (fn.startsWith('can_')) return over.canErr ? { data: null, error: { message: 'boom', code: '42501' } } : { data: over.can ?? true, error: null }
      if (fn === 'assign_outlet_user' && over.assignErr) return { data: null, error: { message: 'Akses ditolak: x', code: '42501' } }
      return { data: null, error: null }
    },
    admin: {
      createUser: async (a) => {
        calls.push(`create:${a.email}:${JSON.stringify(a.user_metadata)}:${a.email_confirm}`)
        return over.createErr ? { data: null, error: { message: over.createErr } } : { data: { user: { id: USER } }, error: null }
      },
      deleteUser: async (id) => (calls.push(`delete:${id}`), { error: null }),
      updateUserById: async (id, attrs) => (calls.push(`update:${id}:${JSON.stringify(attrs)}`), { error: null }),
    },
    staffDomain: 'staff.munparfum.local',
  }
  return { d, calls }
}

const create = { action: 'create_staff', username: 'Kasir1', full_name: 'Kasir Satu', password: 'rahasia123', outlet_id: OUTLET, role: 'kasir', permissions: ['closing.perform'] }

describe('admin-users: create_staff', () => {
  it('berhasil: otorisasi → buat akun → tugaskan outlet (berurutan)', async () => {
    const { d, calls } = deps()
    const r = await handle(create, d)
    expect(r).toEqual({ status: 200, body: { ok: true, user_id: USER, username: 'kasir1' } })
    expect(calls[0]).toMatch(/^rpc:can_manage_staff:.*"p_role":"kasir"/)
    expect(calls[1]).toBe('create:kasir1@staff.munparfum.local:{"full_name":"Kasir Satu","username":"kasir1"}:true')
    expect(calls[2]).toMatch(/^rpc:assign_outlet_user:.*"p_user_id":"2222/)
  })

  it('tanpa login → 401; tidak berwenang → 403 tanpa membuat akun', async () => {
    expect((await handle(create, deps({ caller: false }).d)).status).toBe(401)
    const { d, calls } = deps({ can: false })
    expect((await handle(create, d)).status).toBe(403)
    expect(calls.some((c) => c.startsWith('create:'))).toBe(false)
  })

  it('penugasan ditolak → akun Auth yang baru dibuat dihapus kembali', async () => {
    const { d, calls } = deps({ assignErr: true })
    const r = await handle(create, d)
    expect(r.status).toBe(403)
    expect(calls).toContain(`delete:${USER}`)
  })

  it('username sudah dipakai → 409', async () => {
    const r = await handle(create, deps({ createErr: 'A user with this email address has already been registered' }).d)
    expect(r).toEqual({ status: 409, body: { ok: false, error: 'Username kasir1 sudah dipakai' } })
  })

  it('validasi input', async () => {
    const bad = async (patch: Record<string, unknown>) => (await handle({ ...create, ...patch }, deps().d)).body.error
    expect(await bad({ username: 'a' })).toMatch(/Username/)
    expect(await bad({ username: 'kasir 1' })).toMatch(/Username/)
    expect(await bad({ password: 'pendek' })).toBe('Kata sandi minimal 8 karakter')
    expect(await bad({ role: 'owner' })).toMatch(/Peran/)
    expect(await bad({ outlet_id: 'bad id!' })).toMatch(/Outlet/)
    expect(await bad({ outlet_id: '' })).toMatch(/Outlet/)
    expect(await bad({ permissions: ['superuser'] })).toMatch(/Izin/)
    expect(await bad({ full_name: '' })).toMatch(/Nama/)
    expect((await handle({ action: 'hapus_semua' }, deps().d)).body.error).toBe('Aksi tidak dikenal')
    expect((await handle(null, deps().d)).status).toBe(400)
  })
})

describe('admin-users: reset_password & set_active', () => {
  it('reset sandi hanya bila can_manage_user', async () => {
    const { d, calls } = deps()
    expect((await handle({ action: 'reset_password', user_id: USER, password: 'sandiBaru123' }, d)).status).toBe(200)
    expect(calls[1]).toBe(`update:${USER}:{"password":"sandiBaru123"}`)
    const denied = deps({ can: false })
    expect((await handle({ action: 'reset_password', user_id: USER, password: 'sandiBaru123' }, denied.d)).status).toBe(403)
    expect(denied.calls.some((c) => c.startsWith('update:'))).toBe(false)
  })

  it('nonaktifkan: status data lalu blokir login; error izin dari DB → 403', async () => {
    const { d, calls } = deps()
    expect((await handle({ action: 'set_active', user_id: USER, active: false }, d)).status).toBe(200)
    expect(calls).toEqual([`rpc:set_staff_active:{"p_user_id":"${USER}","p_active":false}`, `update:${USER}:{"ban_duration":"876000h"}`])
    const on = deps()
    await handle({ action: 'set_active', user_id: USER, active: true }, on.d)
    expect(on.calls[1]).toBe(`update:${USER}:{"ban_duration":"none"}`)
    const denied = deps({ canErr: true })
    // set_staff_active memakai pemeriksaan DB; simulasikan penolakan
    denied.d.callerRpc = async () => ({ data: null, error: { message: 'Akses ditolak: hanya pemilik', code: '42501' } })
    expect(await handle({ action: 'set_active', user_id: USER, active: false }, denied.d)).toEqual({ status: 403, body: { ok: false, error: 'Akses ditolak: hanya pemilik' } })
  })
})

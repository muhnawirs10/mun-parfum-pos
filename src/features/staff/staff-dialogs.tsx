import { useEffect, useMemo, useState } from 'react'
import { KeyRound, Loader2, RefreshCw, Save, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/features/auth/auth-context'
import { DELEGABLE, effectivePermissions, ROLE_DEFAULTS, splitPermissions, type Permission } from '@/features/auth/permissions'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { toUserMessage } from '@/lib/errors'
import { generatePassword, useAssignOutletUser, useCreateStaff, useManageableOutlets, useResetPassword, type StaffMember } from './api'
import { PermissionChecklist } from './permission-checklist'

function useEditable() {
  const { profile } = useAuth()
  return (p: Permission) => !!profile?.is_owner || DELEGABLE.includes(p)
}

export function CreateStaffDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { profile, activeOutlet } = useAuth()
  const online = useOnlineStatus()
  const outlets = useManageableOutlets()
  const editable = useEditable()
  const create = useCreateStaff()
  const owner = !!profile?.is_owner
  const [v, setV] = useState({ full_name: '', username: '', password: '', outlet_id: '', role: 'kasir' as 'admin' | 'kasir' })
  const [perms, setPerms] = useState<Permission[]>(ROLE_DEFAULTS.kasir)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (open) {
      // default: outlet yang sedang dibuka (bila boleh dikelola), bukan outlet pertama
      const defaultOutlet = outlets.find((o) => o.outlet_id === activeOutlet?.outlet_id) ?? outlets[0]
      setV({ full_name: '', username: '', password: generatePassword(), outlet_id: defaultOutlet?.outlet_id ?? '', role: 'kasir' })
      setPerms(ROLE_DEFAULTS.kasir)
      setError(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (create.isPending) return
    const username = v.username.trim().toLowerCase()
    if (!v.full_name.trim()) return setError('Nama wajib diisi')
    if (!/^[a-z0-9._]{3,32}$/.test(username)) return setError('Username 3–32 karakter: huruf kecil, angka, titik, garis bawah')
    if (v.password.length < 8) return setError('Kata sandi minimal 8 karakter')
    if (!v.outlet_id) return setError('Pilih outlet')
    if (!online) return setError('Tidak ada koneksi internet.')
    setError(undefined)
    const { permissions } = splitPermissions(v.role, perms)
    try {
      await create.mutateAsync({ ...v, username, full_name: v.full_name.trim(), permissions })
      toast.success(`Akun ${username} dibuat. Berikan kata sandi kepada karyawan.`)
      onOpenChange(false)
    } catch (err) {
      setError(toUserMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent title="Tambah Karyawan" description="Karyawan masuk menggunakan username & kata sandi">
        <form onSubmit={submit} noValidate className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="staff-name" label="Nama lengkap">
              <Input id="staff-name" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} />
            </Field>
            <Field id="staff-username" label="Username">
              <Input id="staff-username" autoCapitalize="none" value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} placeholder="kasir1" />
            </Field>
          </div>
          <Field id="staff-password" label="Kata sandi awal" hint="Catat dan berikan kepada karyawan; dapat direset kapan saja">
            <div className="flex gap-2">
              <Input id="staff-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} className="font-mono" />
              <Button variant="outline" size="icon" onClick={() => setV({ ...v, password: generatePassword() })} aria-label="Buat kata sandi acak">
                <RefreshCw />
              </Button>
            </div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="staff-outlet" label="Outlet">
              <NativeSelect id="staff-outlet" value={v.outlet_id} onChange={(e) => setV({ ...v, outlet_id: e.target.value })}>
                {outlets.map((o) => (
                  <option key={o.outlet_id} value={o.outlet_id}>
                    {o.outlet_code} — {o.outlet_name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="staff-role" label="Peran">
              <NativeSelect
                id="staff-role"
                value={v.role}
                onChange={(e) => {
                  const role = e.target.value as 'admin' | 'kasir'
                  setV({ ...v, role })
                  setPerms(ROLE_DEFAULTS[role])
                }}
              >
                <option value="kasir">Kasir</option>
                {owner && <option value="admin">Admin</option>}
              </NativeSelect>
            </Field>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Hak akses</p>
            <PermissionChecklist role={v.role} value={perms} onChange={setPerms} editable={editable} />
          </div>
          {error && (
            <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 border-t bg-card px-5 py-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />} Buat akun
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function AccessDialog({ member, onClose }: { member: StaffMember | null; onClose: () => void }) {
  const { profile } = useAuth()
  const outlets = useManageableOutlets()
  const editable = useEditable()
  const assign = useAssignOutletUser()
  const owner = !!profile?.is_owner
  const [outletId, setOutletId] = useState('')
  const [role, setRole] = useState<'admin' | 'kasir'>('kasir')
  const [perms, setPerms] = useState<Permission[]>([])
  const [active, setActive] = useState(true)
  const [error, setError] = useState<string>()

  const current = useMemo(() => member?.assignments.find((a) => a.outlet_id === outletId) ?? null, [member, outletId])

  useEffect(() => {
    if (member) setOutletId(member.assignments.find((a) => outlets.some((o) => o.outlet_id === a.outlet_id))?.outlet_id ?? outlets[0]?.outlet_id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member])

  useEffect(() => {
    setError(undefined)
    if (current) {
      setRole(current.role)
      setPerms(effectivePermissions(current.role, current.permissions, current.revoked_permissions))
      setActive(current.is_active)
    } else {
      setRole('kasir')
      setPerms(ROLE_DEFAULTS.kasir)
      setActive(true)
    }
  }, [current, outletId])

  async function save() {
    if (!member) return
    const { permissions, revoked } = splitPermissions(role, perms)
    try {
      await assign.mutateAsync({ userId: member.id, outletId, role, permissions, revoked, active })
      toast.success(`Akses ${member.full_name} di outlet diperbarui`)
      onClose()
    } catch (e) {
      setError(toUserMessage(e))
    }
  }

  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && !assign.isPending && onClose()}>
      <DialogContent title={`Akses ${member?.full_name ?? ''}`} description={member?.username ? `@${member.username}` : undefined}>
        <div className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="access-outlet" label="Outlet">
              <NativeSelect id="access-outlet" value={outletId} onChange={(e) => setOutletId(e.target.value)}>
                {outlets.map((o) => (
                  <option key={o.outlet_id} value={o.outlet_id}>
                    {o.outlet_code} — {o.outlet_name}
                    {member?.assignments.some((a) => a.outlet_id === o.outlet_id) ? '' : ' (belum ditugaskan)'}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="access-role" label="Peran">
              <NativeSelect
                id="access-role"
                value={role}
                disabled={!owner}
                onChange={(e) => {
                  const r = e.target.value as 'admin' | 'kasir'
                  setRole(r)
                  setPerms(ROLE_DEFAULTS[r])
                }}
              >
                <option value="kasir">Kasir</option>
                <option value="admin">Admin</option>
              </NativeSelect>
            </Field>
          </div>
          <label className="flex items-center justify-between rounded-xl bg-muted p-4">
            <span>
              <span className="block font-medium">Aktif di outlet ini</span>
              <span className="block text-sm text-muted-foreground">Nonaktif = tidak bisa membuka outlet ini</span>
            </span>
            <Switch checked={active} onCheckedChange={setActive} aria-label="Aktif di outlet ini" />
          </label>
          <PermissionChecklist role={role} value={perms} onChange={setPerms} editable={editable} />
          {!owner && <p className="text-xs text-muted-foreground">Sebagai admin, Anda hanya dapat memberi izin closing kas dan melihat semua transaksi.</p>}
          {error && (
            <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={assign.isPending}>
              Batal
            </Button>
            <Button onClick={() => void save()} disabled={assign.isPending || !outletId}>
              {assign.isPending ? <Loader2 className="animate-spin" /> : <Save />} Simpan akses
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ResetPasswordDialog({ member, onClose }: { member: StaffMember | null; onClose: () => void }) {
  const reset = useResetPassword()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (member) {
      setPassword(generatePassword())
      setError(undefined)
    }
  }, [member])

  async function submit() {
    if (password.length < 8) return setError('Kata sandi minimal 8 karakter')
    try {
      await reset.mutateAsync({ userId: member!.id, password })
      toast.success(`Kata sandi ${member!.full_name} diganti`)
      onClose()
    } catch (e) {
      setError(toUserMessage(e))
    }
  }

  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && !reset.isPending && onClose()}>
      <DialogContent title="Reset Kata Sandi" description={member?.full_name} className="max-w-md">
        <div className="space-y-4 p-5">
          <Field id="new-password" label="Kata sandi baru" error={error}>
            <div className="flex gap-2">
              <Input id="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
              <Button variant="outline" size="icon" onClick={() => setPassword(generatePassword())} aria-label="Buat kata sandi acak">
                <RefreshCw />
              </Button>
            </div>
          </Field>
          <Button className="w-full" onClick={() => void submit()} disabled={reset.isPending}>
            {reset.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />} Simpan kata sandi
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

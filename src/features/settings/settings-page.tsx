import { useEffect, useState } from 'react'
import { KeyRound, Loader2, Receipt, Save, Settings, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/auth-context'
import { ROLE_LABEL } from '@/features/auth/permissions'
import { useUpdateStaffName } from '@/features/staff/api'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { toUserMessage } from '@/lib/errors'
import { useSetSetting, useSettings } from './api'

function AccountCard() {
  const { client, profile, activeOutlet, session, reload } = useAuth()
  const online = useOnlineStatus()
  const rename = useUpdateStaffName()
  const [name, setName] = useState(profile?.full_name ?? '')
  const [pw, setPw] = useState({ next: '', confirm: '' })
  const [pwBusy, setPwBusy] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; pw?: string }>({})
  useEffect(() => setName(profile?.full_name ?? ''), [profile?.full_name])

  async function saveName() {
    if (!name.trim() || name.trim().length > 100) return setErrors({ name: 'Nama 1–100 karakter' })
    setErrors({})
    try {
      await rename.mutateAsync({ userId: session!.user.id, fullName: name.trim() })
      await reload()
      toast.success('Nama diperbarui')
    } catch (e) {
      setErrors({ name: toUserMessage(e) })
    }
  }

  async function savePassword() {
    if (pw.next.length < 8) return setErrors({ pw: 'Kata sandi minimal 8 karakter' })
    if (pw.next !== pw.confirm) return setErrors({ pw: 'Konfirmasi kata sandi tidak sama' })
    if (!online) return setErrors({ pw: 'Tidak ada koneksi internet.' })
    setErrors({})
    setPwBusy(true)
    try {
      const { error } = await client!.auth.updateUser({ password: pw.next })
      if (error) throw error
      setPw({ next: '', confirm: '' })
      toast.success('Kata sandi diganti')
    } catch (e) {
      setErrors({ pw: toUserMessage(e) })
    } finally {
      setPwBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <UserRound className="h-5 w-5" /> Akun Saya
        </CardTitle>
        <span className="flex gap-2 text-sm text-muted-foreground">
          {profile?.username && `@${profile.username}`}
          {activeOutlet && <Badge variant="dark">{ROLE_LABEL[activeOutlet.role]}</Badge>}
        </span>
      </CardHeader>
      <CardContent className="space-y-5">
        <Field id="my-name" label="Nama" error={errors.name}>
          <div className="flex gap-2">
            <Input id="my-name" value={name} onChange={(e) => setName(e.target.value)} />
            <Button variant="outline" onClick={() => void saveName()} disabled={rename.isPending || name.trim() === profile?.full_name}>
              {rename.isPending ? <Loader2 className="animate-spin" /> : <Save />} Simpan
            </Button>
          </div>
        </Field>
        <div className="space-y-3">
          <p className="text-sm font-medium">Ganti kata sandi</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input type="password" autoComplete="new-password" aria-label="Kata sandi baru" placeholder="Kata sandi baru" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            <Input type="password" autoComplete="new-password" aria-label="Ulangi kata sandi baru" placeholder="Ulangi kata sandi baru" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </div>
          {errors.pw && <p className="text-sm text-destructive">{errors.pw}</p>}
          <Button variant="dark" onClick={() => void savePassword()} disabled={pwBusy}>
            {pwBusy ? <Loader2 className="animate-spin" /> : <KeyRound />} Ganti kata sandi
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function OutletSettingsCard() {
  const { activeOutlet } = useAuth()
  const online = useOnlineStatus()
  const settings = useSettings()
  const set = useSetSetting()
  const [footer, setFooter] = useState('')
  const [error, setError] = useState<string>()
  const s = settings.data
  useEffect(() => setFooter(s?.receipt_footer ?? ''), [s?.receipt_footer])

  async function apply(key: 'allow_negative_stock' | 'receipt_footer', value: boolean | string) {
    if (!online) return setError('Tidak ada koneksi internet.')
    setError(undefined)
    try {
      await set.mutateAsync({ key, value })
      toast.success('Pengaturan disimpan')
    } catch (e) {
      setError(toUserMessage(e))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Receipt className="h-5 w-5" /> Pengaturan Outlet {activeOutlet?.outlet_code}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {settings.isPending || !s ? (
          <Skeleton className="h-32" />
        ) : (
          <>
            <Field id="receipt-footer" label="Pesan di bawah struk" hint={`${footer.length}/200 karakter`}>
              <Textarea id="receipt-footer" value={footer} maxLength={200} rows={2} disabled={!s.can_manage} onChange={(e) => setFooter(e.target.value)} />
            </Field>
            {s.can_manage && (
              <Button variant="outline" onClick={() => void apply('receipt_footer', footer.trim())} disabled={set.isPending || footer === s.receipt_footer}>
                <Save /> Simpan pesan struk
              </Button>
            )}
            <label className="flex items-center justify-between gap-4 rounded-xl bg-muted p-4">
              <span>
                <span className="block font-medium">Izinkan stok minus</span>
                <span className="block text-sm text-muted-foreground">
                  Penjualan tetap boleh walau stok tidak cukup. Hanya pemilik yang dapat mengubah. Tidak disarankan.
                </span>
              </span>
              <Switch
                checked={s.allow_negative_stock}
                disabled={!s.can_manage_negative_stock || set.isPending}
                onCheckedChange={(c) => void apply('allow_negative_stock', c)}
                aria-label="Izinkan stok minus"
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function SettingsPage() {
  return (
    <>
      <PageHeader icon={Settings} title="Pengaturan" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <AccountCard />
        <OutletSettingsCard />
      </div>
      <p className="mt-6 text-center text-xs text-muted-foreground">MUN PARFUM POS v{__APP_VERSION__} · Zona waktu WITA (Asia/Makassar)</p>
    </>
  )
}

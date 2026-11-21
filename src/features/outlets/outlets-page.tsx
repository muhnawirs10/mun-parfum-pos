import { useEffect, useRef, useState } from 'react'
import { ArrowRightLeft, ImagePlus, Loader2, Pencil, Plus, Save, Store } from 'lucide-react'
import { useQueries } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/features/auth/auth-context'
import { uploadProductImage } from '@/features/products/api'
import { fetchSalesReport } from '@/features/reports/api'
import { fetchStockSummary } from '@/features/stock/api'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { toUserMessage } from '@/lib/errors'
import { businessDate, formatRupiah } from '@/lib/format'
import { outletSchema, useOutlets, useSaveOutlet, type Outlet, type OutletFormValues } from './api'

function OutletDialog({ open, outlet, onOpenChange }: { open: boolean; outlet: Outlet | null; onOpenChange: (o: boolean) => void }) {
  const { client } = useAuth()
  const online = useOnlineStatus()
  const save = useSaveOutlet()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [v, setV] = useState<OutletFormValues>({ code: '', name: '', address: '', phone: '', logo_url: '', is_active: true })
  const [errors, setErrors] = useState<Partial<Record<keyof OutletFormValues | 'form', string>>>({})

  useEffect(() => {
    if (!open) return
    setErrors({})
    setV(
      outlet
        ? { code: outlet.code, name: outlet.name, address: outlet.address ?? '', phone: outlet.phone ?? '', logo_url: outlet.logo_url ?? '', is_active: outlet.is_active }
        : { code: '', name: '', address: '', phone: '', logo_url: '', is_active: true },
    )
  }, [open, outlet])

  async function onLogo(file?: File) {
    if (!file || !outlet) return
    setUploading(true)
    try {
      setV((x) => ({ ...x, logo_url: '' }))
      const url = await uploadProductImage(client!, outlet.id, file)
      setV((x) => ({ ...x, logo_url: url }))
    } catch (e) {
      toast.error(toUserMessage(e))
    } finally {
      setUploading(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = outletSchema.safeParse(v)
    if (!parsed.success) {
      const next: typeof errors = {}
      for (const i of parsed.error.issues) next[i.path[0] as keyof OutletFormValues] ??= i.message
      return setErrors(next)
    }
    if (!online) return setErrors({ form: 'Tidak ada koneksi internet.' })
    try {
      await save.mutateAsync({ id: outlet?.id, values: parsed.data })
      toast.success(outlet ? 'Outlet diperbarui' : `Outlet ${parsed.data.code} dibuat`)
      onOpenChange(false)
    } catch (err) {
      setErrors({ form: toUserMessage(err) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent title={outlet ? 'Ubah Outlet' : 'Tambah Outlet'} className="max-w-lg">
        <form onSubmit={submit} noValidate className="space-y-4 p-5">
          {outlet && (
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border bg-muted">
                {v.logo_url ? <img src={v.logo_url} alt="Logo outlet" className="h-full w-full object-cover" /> : uploading ? <Loader2 className="animate-spin" /> : <Store className="h-6 w-6 text-muted-foreground" />}
              </div>
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading || !online}>
                <ImagePlus /> Logo
              </Button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Unggah logo outlet" onChange={(e) => void onLogo(e.target.files?.[0])} />
            </div>
          )}
          <div className="grid grid-cols-[120px_1fr] gap-3">
            <Field id="outlet-code" label="Kode" error={errors.code} hint="Dipakai di nomor transaksi">
              <Input id="outlet-code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} placeholder="TKL" maxLength={6} />
            </Field>
            <Field id="outlet-name" label="Nama outlet" error={errors.name}>
              <Input id="outlet-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="MUN Parfum Takalar" />
            </Field>
          </div>
          <Field id="outlet-address" label="Alamat" error={errors.address}>
            <Input id="outlet-address" value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} />
          </Field>
          <Field id="outlet-phone" label="Telepon" error={errors.phone}>
            <Input id="outlet-phone" inputMode="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} placeholder="0812-3456-7890" />
          </Field>
          {outlet && (
            <label className="flex items-center justify-between rounded-xl bg-muted p-4">
              <span>
                <span className="block font-medium">Outlet aktif</span>
                <span className="block text-sm text-muted-foreground">Outlet nonaktif tidak bisa dibuka karyawan</span>
              </span>
              <Switch checked={v.is_active} onCheckedChange={(c) => setV({ ...v, is_active: c })} aria-label="Outlet aktif" />
            </label>
          )}
          {errors.form && (
            <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
              {errors.form}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={save.isPending || uploading}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Simpan
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function OutletsPage() {
  const { client, profile, activeOutlet, setActiveOutlet, outlets: access } = useAuth()
  const owner = !!profile?.is_owner
  const outlets = useOutlets()
  const today = businessDate()
  const accessible = new Set(access.map((a) => a.outlet_id))
  const [dialog, setDialog] = useState<{ open: boolean; outlet: Outlet | null }>({ open: false, outlet: null })

  const sales = useQueries({
    queries: [{ queryKey: ['sales-report', null, { from: today, to: today }, false], queryFn: () => fetchSalesReport(client!, { from: today, to: today }, null, false) }],
  })[0]
  const stock = useQueries({
    queries: (outlets.data ?? [])
      .filter((o) => o.is_active && accessible.has(o.id))
      .map((o) => ({ queryKey: ['stock-summary', o.id], queryFn: () => fetchStockSummary(client!, o.id) })),
  })
  const activeList = (outlets.data ?? []).filter((o) => o.is_active && accessible.has(o.id))
  const stockOf = (id: string) => stock[activeList.findIndex((o) => o.id === id)]?.data

  return (
    <>
      <PageHeader
        icon={Store}
        title="Outlet"
        description="Kinerja hari ini dan data outlet"
        actions={
          owner && (
            <Button onClick={() => setDialog({ open: true, outlet: null })}>
              <Plus /> Tambah outlet
            </Button>
          )
        }
      />
      {outlets.isPending ? (
        <Skeleton className="h-40" />
      ) : outlets.isError ? (
        <Card>
          <EmptyState icon={Store} title="Gagal memuat outlet" description={toUserMessage(outlets.error)} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {outlets.data.map((o) => {
            const s = sales.data?.by_outlet.find((b) => b.outlet_id === o.id)
            const st = stockOf(o.id)
            return (
              <Card key={o.id} className="space-y-3 p-5" data-testid="outlet-card">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/20">
                    {o.logo_url ? <img src={o.logo_url} alt="" className="h-full w-full object-cover" /> : <Store className="h-6 w-6" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {o.name}
                      <Badge variant="dark">{o.code}</Badge>
                      {!o.is_active && <Badge variant="danger">Nonaktif</Badge>}
                      {activeOutlet?.outlet_id === o.id && <Badge variant="default">Sedang dibuka</Badge>}
                    </p>
                    <p className="text-sm text-muted-foreground">{[o.address, o.phone].filter(Boolean).join(' · ') || 'Alamat belum diisi'}</p>
                  </div>
                </div>
                {o.is_active && (
                  <div className="grid grid-cols-3 gap-2 text-center text-sm">
                    <div className="rounded-xl bg-muted p-2">
                      <p className="text-xs text-muted-foreground">Omzet hari ini</p>
                      <p className="font-bold">{s ? formatRupiah(s.omzet) : '—'}</p>
                    </div>
                    <div className="rounded-xl bg-muted p-2">
                      <p className="text-xs text-muted-foreground">{s?.gross_profit !== undefined && s?.gross_profit !== null ? 'Laba kotor' : 'Transaksi'}</p>
                      <p className="font-bold">{s ? (s.gross_profit !== null ? formatRupiah(s.gross_profit) : s.transaction_count) : '—'}</p>
                    </div>
                    <div className="rounded-xl bg-muted p-2">
                      <p className="text-xs text-muted-foreground">Stok menipis/habis</p>
                      <p className="font-bold">{st ? st.low_count + st.empty_count : '—'}</p>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {o.is_active && accessible.has(o.id) && activeOutlet?.outlet_id !== o.id && (
                    <Button size="sm" variant="outline" onClick={() => setActiveOutlet(o.id)}>
                      <ArrowRightLeft /> Buka outlet ini
                    </Button>
                  )}
                  {owner && (
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ open: true, outlet: o })} aria-label={`Ubah ${o.name}`}>
                      <Pencil /> Ubah
                    </Button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
      <OutletDialog open={dialog.open} outlet={dialog.outlet} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} />
    </>
  )
}

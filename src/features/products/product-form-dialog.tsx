import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/auth-context'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { toUserMessage } from '@/lib/errors'
import { formatNumber, formatQty, UNIT_LABEL } from '@/lib/format'
import type { Category, Product } from './api'
import { useSaveProduct, useUploadImage } from './queries'
import { productFormSchema, UNITS, type ProductFormValues } from './schema'

/** Nilai numerik dari DB → teks input gaya Indonesia. */
function moneyText(v: number | string | null | undefined) {
  return v === null || v === undefined ? '' : formatNumber(v, 2)
}
function qtyText(v: number | string | null | undefined) {
  return v === null || v === undefined ? '' : formatNumber(v).replace(/\./g, '')
}

function initialValues(p?: Product | null): ProductFormValues {
  return {
    name: p?.name ?? '',
    category_id: p?.category_id ?? '',
    unit: p?.unit ?? 'ML',
    sell_price: moneyText(p?.sell_price),
    cost_price: moneyText(p?.cost_price),
    initial_stock: '',
    min_stock: p ? qtyText(p.min_stock) : '',
    sku: p?.sku ?? '',
    description: p?.description ?? '',
    image_url: p?.image_url ?? '',
    is_active: p?.is_active ?? true,
  }
}

type Errors = Partial<Record<keyof ProductFormValues | 'form', string>>

export function ProductFormDialog({
  open,
  onOpenChange,
  product,
  categories,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: Product | null
  categories: Category[]
}) {
  const { can } = useAuth()
  const online = useOnlineStatus()
  const canEditCost = can('cost.view')
  const isCreate = !product
  const [values, setValues] = useState<ProductFormValues>(() => initialValues(product))
  const [errors, setErrors] = useState<Errors>({})
  const save = useSaveProduct()
  const upload = useUploadImage()
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setValues(initialValues(product))
      setErrors({})
    }
  }, [open, product])

  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }))

  async function onPickImage(file: File | undefined) {
    if (!file) return
    try {
      const url = await upload.mutateAsync(file)
      set('image_url', url)
    } catch (e) {
      toast.error(toUserMessage(e))
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (save.isPending) return
    const parsed = productFormSchema({ canEditCost, isCreate }).safeParse(values)
    if (!parsed.success) {
      const next: Errors = {}
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as keyof ProductFormValues
        next[k] ??= issue.message
      }
      setErrors(next)
      // fokus (dan gulir) ke field pertama yang salah
      const first = parsed.error.issues[0]?.path[0]
      if (typeof first === 'string') requestAnimationFrame(() => document.getElementById(first)?.focus())
      return
    }
    if (!online) {
      setErrors({ form: 'Tidak ada koneksi internet. Produk belum disimpan.' })
      return
    }
    setErrors({})
    try {
      const r = await save.mutateAsync({ id: product?.id, values: parsed.data })
      toast.success(isCreate ? `Produk ditambahkan (SKU ${r.sku})` : 'Perubahan produk disimpan')
      onOpenChange(false)
    } catch (err) {
      setErrors({ form: toUserMessage(err) })
    }
  }

  const activeCategories = categories.filter((c) => c.is_active || c.id === values.category_id)
  const unitLabel = UNIT_LABEL[values.unit]

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent title={isCreate ? 'Tambah Produk' : 'Edit Produk'} description={product ? `SKU ${product.sku}` : undefined}>
        <form onSubmit={onSubmit} noValidate className="space-y-5 p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted">
              {values.image_url ? (
                <img src={values.image_url} alt="Foto produk" className="h-full w-full object-cover" />
              ) : upload.isPending ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <ImagePlus className="h-7 w-7 text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">Foto opsional · JPG/PNG/WEBP · maks. 2 MB</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={upload.isPending || !online} onClick={() => fileRef.current?.click()}>
                  <ImagePlus /> {values.image_url ? 'Ganti foto' : 'Pilih foto'}
                </Button>
                {values.image_url && (
                  <Button size="sm" variant="destructive-ghost" onClick={() => set('image_url', '')}>
                    <Trash2 /> Hapus
                  </Button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                aria-label="Unggah foto produk"
                onChange={(e) => void onPickImage(e.target.files?.[0])}
              />
            </div>
          </div>

          <Field id="name" label="Nama produk" error={errors.name}>
            <Input id="name" value={values.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} placeholder="Contoh: VALENTINE / SCANDALOUS" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="category_id" label="Kategori" error={errors.category_id}>
              <NativeSelect id="category_id" value={values.category_id} onChange={(e) => set('category_id', e.target.value)}>
                <option value="">Tanpa kategori</option>
                {activeCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="unit" label="Satuan stok" error={errors.unit}>
              <NativeSelect id="unit" value={values.unit} onChange={(e) => set('unit', e.target.value as ProductFormValues['unit'])}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="sell_price" label={`Harga jual (Rp per ${unitLabel})`} error={errors.sell_price}>
              <Input id="sell_price" inputMode="decimal" value={values.sell_price} onChange={(e) => set('sell_price', e.target.value)} aria-invalid={!!errors.sell_price} placeholder="2.000" />
            </Field>
            {canEditCost && (
              <Field id="cost_price" label={`HPP (Rp per ${unitLabel})`} error={errors.cost_price}>
                <Input id="cost_price" inputMode="decimal" value={values.cost_price} onChange={(e) => set('cost_price', e.target.value)} aria-invalid={!!errors.cost_price} placeholder="1.014" />
              </Field>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {isCreate ? (
              <Field id="initial_stock" label={`Stok awal (${unitLabel})`} error={errors.initial_stock} hint="Dicatat sebagai pergerakan stok awal">
                <Input id="initial_stock" inputMode="decimal" value={values.initial_stock} onChange={(e) => set('initial_stock', e.target.value)} aria-invalid={!!errors.initial_stock} placeholder="307" />
              </Field>
            ) : (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Stok saat ini</p>
                <p className="flex h-11 items-center rounded-xl bg-muted px-3.5 font-semibold">{formatQty(product.current_stock, product.unit)}</p>
                <p className="text-xs text-muted-foreground">Ubah stok melalui menu Stok agar tercatat.</p>
              </div>
            )}
            <Field id="min_stock" label={`Stok minimum (${unitLabel})`} error={errors.min_stock} hint="Peringatan stok menipis">
              <Input id="min_stock" inputMode="decimal" value={values.min_stock} onChange={(e) => set('min_stock', e.target.value)} aria-invalid={!!errors.min_stock} placeholder="50" />
            </Field>
          </div>

          <Field id="sku" label="SKU" error={errors.sku} hint={isCreate ? 'Kosongkan untuk dibuat otomatis' : undefined}>
            <Input id="sku" value={values.sku} onChange={(e) => set('sku', e.target.value)} aria-invalid={!!errors.sku} placeholder="Otomatis" />
          </Field>

          <Field id="description" label="Deskripsi" error={errors.description}>
            <Textarea id="description" value={values.description} onChange={(e) => set('description', e.target.value)} rows={3} />
          </Field>

          {!isCreate && (
            <label className="flex items-center justify-between rounded-xl bg-muted p-4">
              <span>
                <span className="block font-medium">Produk aktif</span>
                <span className="block text-sm text-muted-foreground">Produk nonaktif tidak tampil di kasir</span>
              </span>
              <Switch checked={values.is_active} onCheckedChange={(c) => set('is_active', c)} aria-label="Produk aktif" />
            </label>
          )}

          {errors.form && (
            <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
              {errors.form}
            </p>
          )}

          <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 border-t bg-card px-5 py-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={save.isPending || upload.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              {save.isPending ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

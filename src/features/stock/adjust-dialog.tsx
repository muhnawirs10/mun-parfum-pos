import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ClipboardCheck, Loader2, Minus, Plus, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { Product } from '@/features/products/api'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { Decimal } from '@/lib/decimal'
import { toUserMessage } from '@/lib/errors'
import { formatQty, UNIT_LABEL } from '@/lib/format'
import { cn } from '@/lib/utils'
import { MOVEMENT_LABEL, type AdjustType } from './api'
import { useAdjustStock } from './queries'
import { adjustSchema, previewStock, REASON_PRESETS } from './schema'

const TYPES: { value: AdjustType; label: string; icon: typeof Plus }[] = [
  { value: 'stock_in', label: 'Masuk', icon: Plus },
  { value: 'stock_out', label: 'Keluar', icon: Minus },
  { value: 'adjustment', label: 'Opname', icon: ClipboardCheck },
]

type Errors = Partial<Record<'product_id' | 'quantity' | 'reason' | 'form', string>>

export function AdjustStockDialog({
  open,
  onOpenChange,
  products,
  initialType,
  initialProductId,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  products: Product[]
  initialType: AdjustType
  initialProductId?: string | null
}) {
  const online = useOnlineStatus()
  const adjust = useAdjustStock()
  const [type, setType] = useState<AdjustType>(initialType)
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  // Satu kunci per pengisian form: kirim ulang (klik ganda / retry) tidak menggandakan stok
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  useEffect(() => {
    if (open) {
      setType(initialType)
      setProductId(initialProductId ?? '')
      setQuantity('')
      setReason('')
      setErrors({})
      setIdempotencyKey(crypto.randomUUID())
    }
  }, [open, initialType, initialProductId])

  const product = useMemo(() => products.find((p) => p.id === productId) ?? null, [products, productId])
  const current = product ? Decimal.from(product.current_stock) : null
  const preview = current ? previewStock(type, current, quantity) : null
  const unit = product ? UNIT_LABEL[product.unit] : ''
  const goesNegative = preview?.after.isNegative()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (adjust.isPending) return
    const parsed = adjustSchema(product?.unit ?? null).safeParse({ type, product_id: productId, quantity, reason })
    if (!parsed.success) {
      const next: Errors = {}
      for (const i of parsed.error.issues) next[i.path[0] as keyof Errors] ??= i.message
      setErrors(next)
      return
    }
    if (!online) return setErrors({ form: 'Tidak ada koneksi internet. Stok belum diubah.' })
    setErrors({})
    try {
      const r = await adjust.mutateAsync({
        productId: parsed.data.product_id,
        type: parsed.data.type,
        quantity: parsed.data.quantity,
        reason: parsed.data.reason,
        idempotencyKey,
      })
      toast.success(`${MOVEMENT_LABEL[type]} tersimpan: ${product!.name} → ${formatQty(r.stock_after, product!.unit)}`)
      onOpenChange(false)
    } catch (err) {
      setErrors({ form: toUserMessage(err) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !adjust.isPending && onOpenChange(o)}>
      <DialogContent title="Penyesuaian Stok" description="Setiap perubahan tercatat di riwayat pergerakan stok" className="max-w-xl">
        <form onSubmit={onSubmit} noValidate className="space-y-5 p-5">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Jenis penyesuaian">
            {TYPES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={type === value}
                onClick={() => {
                  setType(value)
                  setErrors({})
                }}
                className={cn(
                  'flex h-12 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-colors',
                  type === value ? 'border-secondary bg-secondary text-secondary-foreground' : 'bg-card hover:bg-muted',
                )}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>

          <Field id="product_id" label="Produk" error={errors.product_id}>
            <NativeSelect id="product_id" value={productId} onChange={(e) => setProductId(e.target.value)} aria-invalid={!!errors.product_id}>
              <option value="">Pilih produk…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku}) — {formatQty(p.current_stock, p.unit)}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field
            id="quantity"
            label={type === 'adjustment' ? `Stok fisik hasil hitung${unit ? ` (${unit})` : ''}` : `Jumlah${unit ? ` (${unit})` : ''}`}
            error={errors.quantity}
            hint={type === 'adjustment' ? 'Stok sistem akan disetel ke angka ini' : undefined}
          >
            <Input id="quantity" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-invalid={!!errors.quantity} placeholder={type === 'adjustment' ? '300' : '100'} />
          </Field>

          {product && current && (
            <div className={cn('flex items-center justify-between rounded-xl p-4', goesNegative ? 'bg-destructive/10' : 'bg-muted')} aria-live="polite">
              <div>
                <p className="text-xs text-muted-foreground">Stok sekarang</p>
                <p className="text-lg font-bold">{formatQty(current.toString(), product.unit)}</p>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Stok sesudah</p>
                <p className={cn('text-lg font-bold', goesNegative && 'text-destructive')} data-testid="stock-after">
                  {preview ? formatQty(preview.after.toString(), product.unit) : '—'}
                </p>
              </div>
            </div>
          )}
          {goesNegative && <p className="text-sm text-destructive">Stok akan minus. Ditolak kecuali pemilik mengizinkan stok minus.</p>}

          <Field id="reason" label={type === 'stock_in' ? 'Keterangan (opsional)' : 'Alasan'} error={errors.reason}>
            <div className="mb-2 flex flex-wrap gap-2">
              {REASON_PRESETS[type].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={cn('h-9 rounded-full border px-3 text-xs font-medium', reason === r ? 'border-secondary bg-secondary text-secondary-foreground' : 'bg-card hover:bg-muted')}
                >
                  {r}
                </button>
              ))}
            </div>
            <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} aria-invalid={!!errors.reason} />
          </Field>

          {errors.form && (
            <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
              {errors.form}
            </p>
          )}

          <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 border-t bg-card px-5 py-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={adjust.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={adjust.isPending}>
              {adjust.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              {adjust.isPending ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

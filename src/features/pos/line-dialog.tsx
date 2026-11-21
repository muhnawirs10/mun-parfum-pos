import { useEffect, useState } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Decimal } from '@/lib/decimal'
import { DECIMAL_UNITS, formatQty, formatRupiah, UNIT_LABEL, type StockUnit } from '@/lib/format'
import { parseMoneyInput, parseQtyInput } from '@/lib/input'
import { calcLine } from '@/lib/sale-calc'
import { cn } from '@/lib/utils'

export interface LineTarget {
  mode: 'add' | 'edit'
  productId: string
  name: string
  unit: StockUnit
  price: string
  stock: string
  qty?: string
  discount?: string
}

const PRESETS: Record<'decimal' | 'integer', number[]> = {
  decimal: [1, 2, 3, 5, 10, 15, 20, 25, 30, 50, 100],
  integer: [1, 2, 3, 4, 5, 6, 10, 12],
}

export function LineDialog({
  target,
  onClose,
  onSubmit,
  onRemove,
  allowNegative,
}: {
  target: LineTarget | null
  onClose: () => void
  onSubmit: (qty: string, discount: string) => void
  onRemove?: () => void
  allowNegative: boolean
}) {
  const [qty, setQty] = useState('')
  const [discount, setDiscount] = useState('')
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (target) {
      setQty(target.qty ? target.qty.replace('.', ',') : '')
      setDiscount(target.discount && target.discount !== '0' ? target.discount : '')
      setError(undefined)
    }
  }, [target])

  if (!target) return null
  const isDecimal = DECIMAL_UNITS.includes(target.unit)
  const unit = UNIT_LABEL[target.unit]
  const q = parseQtyInput(qty)
  const d = discount.trim() === '' ? Decimal.zero : parseMoneyInput(discount)
  let preview: ReturnType<typeof calcLine> | null = null
  let previewError: string | undefined
  if (q && d) {
    try {
      preview = calcLine({ price: target.price, cost: 0, qty: q, discount: d })
    } catch (e) {
      previewError = (e as Error).message
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!q || !q.gt(0)) return setError(`Masukkan jumlah ${unit} yang valid`)
    if (!isDecimal && !q.isInteger()) return setError(`Satuan ${target!.unit} harus bilangan bulat`)
    if (!d) return setError('Diskon tidak valid (contoh: 1.000)')
    if (previewError) return setError(previewError)
    if (!allowNegative && q.gt(target!.stock)) return setError(`Stok tidak cukup. Tersedia ${formatQty(target!.stock, target!.unit)}`)
    onSubmit(q.toString(), d.toString())
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={target.name} description={`${formatRupiah(target.price)}/${unit} · Stok ${formatQty(target.stock, target.unit)}`} className="max-w-md">
        <form onSubmit={submit} noValidate className="space-y-4 p-5">
          <div className="grid grid-cols-4 gap-2">
            {PRESETS[isDecimal ? 'decimal' : 'integer'].slice(0, 8).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setQty(String(n))}
                className={cn(
                  'h-12 rounded-xl border text-sm font-semibold transition-colors',
                  q?.eq(n) ? 'border-secondary bg-secondary text-secondary-foreground' : 'bg-card hover:bg-muted',
                )}
              >
                {n} {unit}
              </button>
            ))}
          </div>
          <Field id="line-qty" label={`Jumlah (${unit})`} error={error}>
            <Input id="line-qty" inputMode="decimal" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} placeholder={isDecimal ? 'contoh: 10 atau 2,5' : '1'} className="h-14 text-xl font-bold" />
          </Field>
          <Field id="line-discount" label="Diskon item (Rp, opsional)">
            <Input id="line-discount" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
          </Field>
          <div className="flex items-center justify-between rounded-xl bg-muted p-4">
            <span className="text-sm text-muted-foreground">Subtotal item</span>
            <span className="text-xl font-bold tabular-nums" data-testid="line-preview">
              {preview ? formatRupiah(preview.total.toString()) : '—'}
            </span>
          </div>
          <div className="flex gap-2">
            {onRemove && (
              <Button variant="destructive-ghost" onClick={onRemove}>
                <Trash2 /> Hapus
              </Button>
            )}
            <Button type="submit" size="lg" className="flex-1">
              {target.mode === 'add' ? <Plus /> : <Save />}
              {target.mode === 'add' ? 'Tambah ke keranjang' : 'Simpan'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Banknote, CreditCard, Landmark, Loader2, MoreHorizontal, QrCode, Wallet, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { PAYMENT_LABEL, type PaymentMethod } from '@/features/dashboard/api'
import { Decimal } from '@/lib/decimal'
import { formatRupiah } from '@/lib/format'
import { parseMoneyInput } from '@/lib/input'
import { cn } from '@/lib/utils'
import { quickCashAmounts } from './cash'

const METHODS: { value: PaymentMethod; icon: typeof Banknote }[] = [
  { value: 'cash', icon: Banknote },
  { value: 'qris', icon: QrCode },
  { value: 'transfer', icon: Landmark },
  { value: 'ewallet', icon: Wallet },
  { value: 'other', icon: MoreHorizontal },
]

export interface PaymentInput {
  method: PaymentMethod
  amountReceived: string | null
  reference: string | null
}

export function PaymentDialog({
  open,
  total,
  online,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean
  total: Decimal
  online: boolean
  pending: boolean
  error: string | null
  onClose: () => void
  onConfirm: (p: PaymentInput) => void
}) {
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [received, setReceived] = useState('')
  const [reference, setReference] = useState('')
  const [localError, setLocalError] = useState<string>()

  useEffect(() => {
    if (open) {
      setMethod('cash')
      setReceived('')
      setReference('')
      setLocalError(undefined)
    }
  }, [open])

  const quick = useMemo(() => quickCashAmounts(total), [total])
  const receivedDec = received.trim() === '' ? null : parseMoneyInput(received)
  const change = method === 'cash' && receivedDec && receivedDec.gte(total) ? receivedDec.sub(total) : null

  function confirm() {
    if (pending) return
    if (method === 'cash') {
      if (!receivedDec) return setLocalError('Masukkan uang diterima (contoh: 50.000)')
      if (receivedDec.lt(total)) return setLocalError('Uang diterima kurang dari total belanja')
    }
    setLocalError(undefined)
    onConfirm({
      method,
      amountReceived: method === 'cash' ? receivedDec!.toString() : null,
      reference: method === 'cash' ? null : reference.trim() || null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent title="Pembayaran" className="max-w-lg">
        <div className="space-y-5 p-5">
          <div className="rounded-2xl bg-secondary p-5 text-center text-secondary-foreground">
            <p className="text-sm opacity-80">Total belanja</p>
            <p className="text-3xl font-bold tabular-nums text-primary" data-testid="pay-total">
              {formatRupiah(total.toString())}
            </p>
          </div>

          <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Metode pembayaran">
            {METHODS.map(({ value, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={method === value}
                onClick={() => setMethod(value)}
                disabled={pending}
                className={cn(
                  'flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-xs font-semibold transition-colors',
                  method === value ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted',
                )}
              >
                <Icon className="h-5 w-5" />
                {PAYMENT_LABEL[value]}
              </button>
            ))}
          </div>

          {method === 'cash' ? (
            <>
              <Field id="received" label="Uang diterima" error={localError}>
                <Input id="received" inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} placeholder="contoh: 50.000" className="h-14 text-xl font-bold" disabled={pending} />
              </Field>
              <div className="flex flex-wrap gap-2">
                {quick.map((v, i) => (
                  <Button key={v.toString()} size="sm" variant="outline" onClick={() => setReceived(v.toString())} disabled={pending}>
                    {i === 0 ? 'Uang pas' : formatRupiah(v.toString())}
                  </Button>
                ))}
              </div>
              <div className="flex items-center justify-between rounded-xl bg-muted p-4">
                <span className="font-medium">Kembalian</span>
                <span className="text-2xl font-bold tabular-nums" data-testid="change">
                  {change ? formatRupiah(change.toString()) : '—'}
                </span>
              </div>
            </>
          ) : (
            <Field id="reference" label="No. referensi (opsional)" error={localError}>
              <Input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="contoh: 4 digit terakhir / ID transaksi" disabled={pending} />
            </Field>
          )}

          {!online && (
            <p className="flex items-center gap-2 rounded-xl bg-secondary p-3 text-sm text-secondary-foreground" role="alert">
              <WifiOff className="h-4 w-4 text-primary" /> Offline — transaksi tidak dapat disimpan sampai koneksi pulih.
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}

          <Button size="xl" className="w-full" onClick={confirm} disabled={pending || !online}>
            {pending ? <Loader2 className="animate-spin" /> : <CreditCard />}
            {pending ? 'Menyimpan transaksi…' : error ? 'Coba lagi' : `Bayar ${formatRupiah(total.toString())}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

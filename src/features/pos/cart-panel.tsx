import { useState } from 'react'
import { Minus, Plus, ShoppingCart, Trash2, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Decimal } from '@/lib/decimal'
import { formatNumber, formatRupiah, UNIT_LABEL } from '@/lib/format'
import { parseMoneyInput } from '@/lib/input'
import { cartStore, cartTotals, type CartLine, type CartState } from './cart-store'

export function CartPanel({
  outletId,
  cart,
  online,
  onEditLine,
  onPay,
}: {
  outletId: string
  cart: CartState
  online: boolean
  onEditLine: (line: CartLine) => void
  onPay: () => void
}) {
  const { result, error } = cartTotals(cart)
  const count = cart.lines.length
  const [discountError, setDiscountError] = useState<string>()
  const applyDiscount = (v: string) => {
    const d = v.trim() === '' ? Decimal.zero : parseMoneyInput(v)
    if (!d) return setDiscountError('Diskon tidak valid (contoh: 2.000)')
    setDiscountError(undefined)
    if (!d.eq(cart.discount)) cartStore.setMeta(outletId, { discount: d.toString() })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <ShoppingCart className="h-5 w-5" /> Keranjang ({count} item)
        </h2>
        {count > 0 && (
          <Button size="sm" variant="destructive-ghost" onClick={() => cartStore.clear(outletId)}>
            <Trash2 /> Kosongkan
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {count === 0 ? (
          <p className="flex h-full min-h-40 items-center justify-center p-6 text-center text-muted-foreground">Keranjang kosong</p>
        ) : (
          <ul className="divide-y" aria-label="Isi keranjang">
            {cart.lines.map((l, i) => {
              const line = result?.lines[i]
              const step = 1
              return (
                <li key={l.key} className="p-3" data-testid="cart-line">
                  <button type="button" className="w-full text-left" onClick={() => onEditLine(l)} aria-label={`Ubah ${l.name}`}>
                    <p className="font-semibold leading-tight">{l.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatNumber(l.qty)} {UNIT_LABEL[l.unit]} × {formatRupiah(l.price)}
                    </p>
                    {l.discount !== '0' && <p className="text-sm text-destructive">Diskon −{formatRupiah(l.discount)}</p>}
                  </button>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => cartStore.step(outletId, l.key, -step)} aria-label={`Kurangi ${l.name}`}>
                        <Minus />
                      </Button>
                      <span className="min-w-16 text-center text-sm font-semibold tabular-nums">
                        {formatNumber(l.qty)} {UNIT_LABEL[l.unit]}
                      </span>
                      <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => cartStore.step(outletId, l.key, step)} aria-label={`Tambah ${l.name}`}>
                        <Plus />
                      </Button>
                    </div>
                    <span className="font-bold tabular-nums">{line ? formatRupiah(line.total.toString()) : '—'}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {count > 0 && (
        <div className="space-y-3 border-t p-4">
          <div className="grid grid-cols-2 gap-2">
            <Input
              aria-label="Diskon transaksi"
              inputMode="decimal"
              placeholder="Diskon (Rp)"
              defaultValue={cart.discount === '0' ? '' : cart.discount}
              key={`disc-${cart.discount}`}
              aria-invalid={!!discountError}
              onBlur={(e) => applyDiscount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyDiscount((e.target as HTMLInputElement).value)}
            />
            <Input
              aria-label="Nama pelanggan"
              placeholder="Pelanggan (opsional)"
              value={cart.customerName}
              onChange={(e) => cartStore.setMeta(outletId, { customerName: e.target.value })}
            />
          </div>
          {result && (
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{formatRupiah(result.subtotal.toString())}</span>
              </div>
              {!result.transactionDiscount.isZero() && (
                <div className="flex justify-between text-destructive">
                  <span>Diskon transaksi</span>
                  <span className="tabular-nums">−{formatRupiah(result.transactionDiscount.toString())}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span className="tabular-nums" data-testid="cart-total">
                  {formatRupiah(result.total.toString())}
                </span>
              </div>
            </div>
          )}
          {(discountError || error) && <p className="text-sm text-destructive">{discountError ?? error}</p>}
          {!online && (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <WifiOff className="h-4 w-4" /> Offline — pembayaran dinonaktifkan
            </p>
          )}
          <Button size="xl" className="w-full" onClick={onPay} disabled={!result || !!error || !online}>
            Bayar {result ? formatRupiah(result.total.toString()) : ''}
          </Button>
        </div>
      )}
    </div>
  )
}

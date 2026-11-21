import { useMemo, useState } from 'react'
import { ArrowDownAZ, ArrowUpZA, Package, RefreshCw, ScanLine, Search, ShoppingCart, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/features/auth/auth-context'
import type { Product } from '@/features/products/api'
import { useCategories, useProducts } from '@/features/products/queries'
import { stockLevel } from '@/features/products/stock-badge'
import { SaleSuccessDialog } from '@/features/transactions/receipt-dialog'
import { useAllowNegativeStock, useCreateSale } from '@/features/transactions/queries'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { Decimal } from '@/lib/decimal'
import { toUserMessage } from '@/lib/errors'
import { DECIMAL_UNITS, formatQty, formatRupiah, UNIT_LABEL } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CartPanel } from './cart-panel'
import { cartStore, cartTotals, useCart, type CartLine } from './cart-store'
import { LineDialog, type LineTarget } from './line-dialog'
import { PaymentDialog, type PaymentInput } from './payment-dialog'

function saleErrorMessage(err: unknown): string {
  const msg = toUserMessage(err)
  if (msg.startsWith('Tidak dapat terhubung')) {
    return 'Koneksi terputus sebelum server menjawab. Transaksi BELUM dipastikan tersimpan. Tekan "Coba lagi" — sistem mencegah transaksi ganda.'
  }
  return msg
}

export function PosPage() {
  const { activeOutlet } = useAuth()
  const outletId = activeOutlet!.outlet_id
  const online = useOnlineStatus()
  const products = useProducts()
  const categories = useCategories()
  const allowNegative = useAllowNegativeStock().data ?? false
  const cart = useCart(outletId)
  const sale = useCreateSale()

  const [q, setQ] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [desc, setDesc] = useState(false)
  const [lineTarget, setLineTarget] = useState<(LineTarget & { lineKey?: string }) | null>(null)
  const [payOpen, setPayOpen] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const [mobileCart, setMobileCart] = useState(false)
  const [successId, setSuccessId] = useState<string | null>(null)

  const catalog = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = (products.data ?? []).filter(
      (p) => p.is_active && (category === 'all' || p.category_id === category) && (!s || `${p.name} ${p.sku}`.toLowerCase().includes(s)),
    )
    return list.sort((a, b) => (desc ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)))
  }, [products.data, q, category, desc])

  const usedCategories = useMemo(() => {
    const ids = new Set((products.data ?? []).filter((p) => p.is_active).map((p) => p.category_id))
    return (categories.data ?? []).filter((c) => c.is_active && ids.has(c.id))
  }, [products.data, categories.data])

  const stockOf = (productId: string) => (products.data ?? []).find((p) => p.id === productId)?.current_stock ?? 0
  const inCart = (productId: string) =>
    Decimal.sum(cart.lines.filter((l) => l.productId === productId).map((l) => l.qty))

  function onProduct(p: Product) {
    const available = Decimal.from(p.current_stock).sub(inCart(p.id))
    if (!DECIMAL_UNITS.includes(p.unit)) {
      if (!allowNegative && available.lt(1)) {
        toast.error(`Stok ${p.name} habis`)
        return
      }
      cartStore.add(outletId, { productId: p.id, name: p.name, sku: p.sku, unit: p.unit, price: String(p.sell_price), qty: '1' })
      return
    }
    setLineTarget({ mode: 'add', productId: p.id, name: p.name, unit: p.unit, price: String(p.sell_price), stock: available.toString() })
  }

  function onEditLine(l: CartLine) {
    const otherQty = Decimal.sum(cart.lines.filter((x) => x.productId === l.productId && x.key !== l.key).map((x) => x.qty))
    setLineTarget({
      mode: 'edit',
      lineKey: l.key,
      productId: l.productId,
      name: l.name,
      unit: l.unit,
      price: l.price,
      stock: Decimal.from(stockOf(l.productId)).sub(otherQty).toString(),
      qty: l.qty,
      discount: l.discount,
    })
  }

  function onLineSubmit(qty: string, discount: string) {
    const t = lineTarget!
    if (t.mode === 'edit' && t.lineKey) cartStore.updateLine(outletId, t.lineKey, { qty, discount })
    else {
      const p = products.data!.find((x) => x.id === t.productId)!
      cartStore.add(outletId, { productId: p.id, name: p.name, sku: p.sku, unit: p.unit, price: String(p.sell_price), qty, discount })
    }
    setLineTarget(null)
  }

  async function onConfirmPayment(p: PaymentInput) {
    if (sale.isPending) return
    if (!online) return setPayError('Tidak ada koneksi internet. Transaksi belum disimpan.')
    setPayError(null)
    // snapshot keranjang saat ini (termasuk kunci idempotensi)
    const snapshot = cartStore.get(outletId)
    try {
      const r = await sale.mutateAsync({
        outletId,
        items: snapshot.lines.map((l) => ({ product_id: l.productId, quantity: l.qty, discount_amount: l.discount })),
        paymentMethod: p.method,
        amountReceived: p.amountReceived,
        discount: snapshot.discount,
        reference: p.reference,
        customerName: snapshot.customerName.trim() || null,
        note: snapshot.note.trim() || null,
        idempotencyKey: snapshot.checkoutKey,
      })
      // Hanya setelah server mengonfirmasi: kosongkan keranjang & tampilkan struk
      cartStore.clear(outletId)
      setPayOpen(false)
      setMobileCart(false)
      setSuccessId(r.id)
    } catch (err) {
      setPayError(saleErrorMessage(err))
    }
  }

  const totals = cartTotals(cart)
  const cartPanel = (
    <CartPanel
      outletId={outletId}
      cart={cart}
      online={online}
      onEditLine={onEditLine}
      onPay={() => {
        setPayError(null)
        setPayOpen(true)
      }}
    />
  )

  return (
    <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-5">
      <section className="min-w-0">
        <header className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20">
            <ShoppingCart className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">Kasir</h1>
        </header>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama produk atau kode…" aria-label="Cari produk kasir" className="h-12 pl-11 pr-11" />
          {q ? (
            <button type="button" onClick={() => setQ('')} className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg hover:bg-muted" aria-label="Hapus pencarian">
              <X className="h-4 w-4" />
            </button>
          ) : (
            <ScanLine className="pointer-events-none absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          )}
        </div>
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Kategori">
          <Button size="sm" variant="outline" className="shrink-0 rounded-full" onClick={() => setDesc((d) => !d)} aria-label="Urutkan nama">
            {desc ? <ArrowUpZA /> : <ArrowDownAZ />} {desc ? 'Z–A' : 'A–Z'}
          </Button>
          {[{ id: 'all', name: 'Semua' }, ...usedCategories].map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              aria-pressed={category === c.id}
              className={cn(
                'h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors',
                category === c.id ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-border',
              )}
            >
              {c.name}
            </button>
          ))}
        </div>

        {products.isPending ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-48" />
            ))}
          </div>
        ) : products.isError ? (
          <Card>
            <EmptyState
              icon={RefreshCw}
              title="Gagal memuat produk"
              description={toUserMessage(products.error)}
              action={<Button variant="outline" onClick={() => void products.refetch()}>Coba lagi</Button>}
            />
          </Card>
        ) : catalog.length === 0 ? (
          <Card>
            <EmptyState icon={Package} title="Produk tidak ditemukan" />
          </Card>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {catalog.map((p) => {
              const level = stockLevel(p.current_stock, p.min_stock)
              const qtyInCart = inCart(p.id)
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onProduct(p)}
                    aria-label={`Pilih ${p.name}`}
                    className={cn(
                      'relative flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-soft transition active:scale-[0.98]',
                      qtyInCart.gt(0) && 'border-primary ring-2 ring-primary/40',
                      level === 'empty' && !allowNegative && 'opacity-50',
                    )}
                  >
                    <div className="flex aspect-[4/3] w-full items-center justify-center bg-muted">
                      {p.image_url ? <img src={p.image_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Package className="h-10 w-10 text-muted-foreground/60" />}
                    </div>
                    {qtyInCart.gt(0) && (
                      <span className="absolute right-2 top-2 rounded-full bg-secondary px-2 py-0.5 text-xs font-bold text-primary">
                        {formatQty(qtyInCart.toString(), p.unit)}
                      </span>
                    )}
                    <div className="flex flex-1 flex-col gap-0.5 p-3">
                      <p className="line-clamp-2 text-sm font-semibold leading-tight">{p.name}</p>
                      <p className="text-base font-bold">
                        {formatRupiah(p.sell_price)}
                        <span className="text-xs font-medium text-muted-foreground">/{UNIT_LABEL[p.unit]}</span>
                      </p>
                      <p className={cn('text-xs', level === 'empty' ? 'font-semibold text-destructive' : level === 'low' ? 'font-semibold' : 'text-muted-foreground')}>
                        {level === 'empty' ? 'Habis' : `Stok: ${formatQty(p.current_stock, p.unit)}`}
                      </p>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {/* ruang agar bar keranjang (ponsel) tidak menutupi produk terakhir */}
        {cart.lines.length > 0 && <div className="h-20 lg:hidden" aria-hidden="true" />}
      </section>

      <aside className="hidden lg:block">
        <Card className="sticky top-4 h-[calc(100dvh-8rem)] overflow-hidden">{cartPanel}</Card>
      </aside>

      {cart.lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-24 z-30 px-4 lg:hidden">
          <Button size="xl" variant="dark" className="w-full justify-between shadow-lg" onClick={() => setMobileCart(true)}>
            <span className="flex items-center gap-2">
              <ShoppingCart /> {cart.lines.length} item
            </span>
            <span className="text-primary">{totals.result ? formatRupiah(totals.result.total.toString()) : '—'}</span>
          </Button>
        </div>
      )}
      <Dialog open={mobileCart} onOpenChange={setMobileCart}>
        <DialogContent title="Keranjang" className="max-w-lg">
          {cartPanel}
        </DialogContent>
      </Dialog>

      <LineDialog
        target={lineTarget}
        allowNegative={allowNegative}
        onClose={() => setLineTarget(null)}
        onSubmit={onLineSubmit}
        onRemove={
          lineTarget?.mode === 'edit' && lineTarget.lineKey
            ? () => {
                cartStore.remove(outletId, lineTarget.lineKey!)
                setLineTarget(null)
              }
            : undefined
        }
      />
      <PaymentDialog
        open={payOpen}
        total={totals.result?.total ?? Decimal.zero}
        online={online}
        pending={sale.isPending}
        error={payError}
        onClose={() => setPayOpen(false)}
        onConfirm={onConfirmPayment}
      />
      <SaleSuccessDialog transactionId={successId} onNewSale={() => setSuccessId(null)} />
    </div>
  )
}

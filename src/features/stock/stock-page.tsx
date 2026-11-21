import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, Boxes, ClipboardCheck, History, Minus, PackageX, Plus, Search, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/features/auth/auth-context'
import { useProducts } from '@/features/products/queries'
import { stockLevel, StockBadge } from '@/features/products/stock-badge'
import { formatQty, formatRupiah } from '@/lib/format'
import type { AdjustType, MovementFilter } from './api'
import { AdjustStockDialog } from './adjust-dialog'
import { MovementsPanel } from './movements-panel'
import { useStockSummary } from './queries'

type LevelFilter = 'all' | 'low' | 'empty'

export function StockPage() {
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const products = useProducts()
  const summary = useStockSummary()
  const active = useMemo(() => (products.data ?? []).filter((p) => p.is_active), [products.data])

  const tab = params.get('tab') === 'riwayat' || params.get('produk') ? 'riwayat' : 'daftar'
  const filter: MovementFilter = {
    productId: params.get('produk'),
    types: params.get('jenis') ? [params.get('jenis') as never] : null,
    from: params.get('dari'),
    to: params.get('sampai'),
  }
  const setFilter = (f: MovementFilter) => {
    const next = new URLSearchParams({ tab: 'riwayat' })
    if (f.productId) next.set('produk', f.productId)
    if (f.types?.[0]) next.set('jenis', f.types[0])
    if (f.from) next.set('dari', f.from)
    if (f.to) next.set('sampai', f.to)
    setParams(next, { replace: true })
  }

  const [q, setQ] = useState('')
  const [level, setLevel] = useState<LevelFilter>('all')
  const [dialog, setDialog] = useState<{ open: boolean; type: AdjustType; productId?: string | null }>({ open: false, type: 'stock_in' })
  const open = (type: AdjustType, productId?: string) => setDialog({ open: true, type, productId })

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return active.filter((p) => {
      if (s && !`${p.name} ${p.sku}`.toLowerCase().includes(s)) return false
      const l = stockLevel(p.current_stock, p.min_stock)
      if (level === 'low') return l !== 'ok'
      if (level === 'empty') return l === 'empty'
      return true
    })
  }, [active, q, level])

  const s = summary.data
  const cards = [
    { label: 'Produk aktif', value: s ? String(s.active_count) : '', icon: Boxes },
    { label: 'Stok menipis', value: s ? String(s.low_count) : '', icon: AlertTriangle },
    { label: 'Stok habis', value: s ? String(s.empty_count) : '', icon: PackageX },
    s?.value_at_cost !== null && s?.value_at_cost !== undefined
      ? { label: 'Nilai persediaan (HPP)', value: formatRupiah(s.value_at_cost), icon: Wallet }
      : { label: 'Nilai persediaan (harga jual)', value: s ? formatRupiah(s.value_at_sell_price) : '', icon: Wallet },
  ]

  return (
    <>
      <PageHeader
        icon={Boxes}
        title="Stok"
        actions={
          <>
            <Button variant="outline" onClick={() => open('adjustment')}>
              <ClipboardCheck /> Opname
            </Button>
            <Button variant="outline" onClick={() => open('stock_out')}>
              <Minus /> Keluar
            </Button>
            <Button onClick={() => open('stock_in')}>
              <Plus /> Stok Masuk
            </Button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(({ label, value, icon: Icon }) => (
          <Card key={label} className="p-4">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon className="h-4 w-4" /> {label}
            </p>
            {summary.isPending ? <Skeleton className="mt-2 h-7 w-20" /> : <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>}
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams(v === 'riwayat' ? { tab: 'riwayat' } : {}, { replace: true })}>
        <TabsList>
          <TabsTrigger value="daftar">
            <Boxes /> Daftar Stok
          </TabsTrigger>
          <TabsTrigger value="riwayat">
            <History /> Riwayat Pergerakan
          </TabsTrigger>
        </TabsList>

        <TabsContent value="daftar" className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama atau SKU…" aria-label="Cari stok" className="pl-11" />
            </div>
            <NativeSelect value={level} onChange={(e) => setLevel(e.target.value as LevelFilter)} aria-label="Filter level stok" className="sm:w-44">
              <option value="all">Semua</option>
              <option value="low">Menipis &amp; habis</option>
              <option value="empty">Habis</option>
            </NativeSelect>
          </div>
          {products.isPending ? (
            <Skeleton className="h-40" />
          ) : list.length === 0 ? (
            <Card>
              <EmptyState icon={Boxes} title="Tidak ada produk" />
            </Card>
          ) : (
            <Card className="divide-y overflow-hidden">
              {list.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-3 p-4" data-testid="stock-row">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-sm text-muted-foreground">
                      SKU {p.sku} · Minimum {formatQty(p.min_stock, p.unit)}
                    </p>
                  </div>
                  <StockBadge current={p.current_stock} min={p.min_stock} unit={p.unit} />
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => open('stock_in', p.id)} aria-label={`Stok masuk ${p.name}`}>
                      <Plus /> Masuk
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => open('stock_out', p.id)} aria-label={`Stok keluar ${p.name}`}>
                      <Minus /> Keluar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => open('adjustment', p.id)} aria-label={`Opname ${p.name}`}>
                      <ClipboardCheck />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setFilter({ productId: p.id })} aria-label={`Riwayat ${p.name}`}>
                      <History />
                    </Button>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </TabsContent>

        <TabsContent value="riwayat">
          <MovementsPanel products={products.data ?? []} filter={filter} onFilterChange={setFilter} />
        </TabsContent>
      </Tabs>

      {can('stock.manage') && (
        <AdjustStockDialog
          open={dialog.open}
          onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
          products={active}
          initialType={dialog.type}
          initialProductId={dialog.productId}
        />
      )}
    </>
  )
}

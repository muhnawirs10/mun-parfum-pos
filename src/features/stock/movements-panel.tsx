import { History, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { Product } from '@/features/products/api'
import { toUserMessage } from '@/lib/errors'
import { formatDateWita, formatNumber, formatQty, UNIT_LABEL } from '@/lib/format'
import { cn } from '@/lib/utils'
import { MOVEMENT_LABEL, type MovementFilter, type MovementType } from './api'
import { useMovements } from './queries'

const TYPE_OPTIONS = Object.entries(MOVEMENT_LABEL).filter(([k]) => !k.startsWith('transfer')) as [MovementType, string][]

export function MovementsPanel({
  products,
  filter,
  onFilterChange,
}: {
  products: Product[]
  filter: MovementFilter
  onFilterChange: (f: MovementFilter) => void
}) {
  const q = useMovements(filter)
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  const total = q.data?.pages[0]?.total ?? 0

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 items-end gap-3 lg:grid-cols-4">
        <NativeSelect
          className="col-span-2 lg:col-span-1"
          aria-label="Filter produk riwayat"
          value={filter.productId ?? ''}
          onChange={(e) => onFilterChange({ ...filter, productId: e.target.value || null })}
        >
          <option value="">Semua produk</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          className="col-span-2 lg:col-span-1"
          aria-label="Filter jenis pergerakan"
          value={filter.types?.[0] ?? ''}
          onChange={(e) => onFilterChange({ ...filter, types: e.target.value ? [e.target.value as MovementType] : null })}
        >
          <option value="">Semua jenis</option>
          {TYPE_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </NativeSelect>
        <label className="flex flex-col gap-1">
          <span className="px-1 text-xs text-muted-foreground">Dari</span>
          <Input type="date" aria-label="Dari tanggal" value={filter.from ?? ''} onChange={(e) => onFilterChange({ ...filter, from: e.target.value || null })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="px-1 text-xs text-muted-foreground">Sampai</span>
          <Input type="date" aria-label="Sampai tanggal" value={filter.to ?? ''} onChange={(e) => onFilterChange({ ...filter, to: e.target.value || null })} />
        </label>
      </div>

      {q.isPending ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : q.isError ? (
        <Card>
          <EmptyState
            icon={RefreshCw}
            title="Gagal memuat riwayat"
            description={toUserMessage(q.error)}
            action={<Button variant="outline" onClick={() => void q.refetch()}>Coba lagi</Button>}
          />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={History} title="Belum ada pergerakan stok" description="Coba ubah filter produk, jenis, atau tanggal." />
        </Card>
      ) : (
        <>
          <p className="px-1 text-sm text-muted-foreground">{total} pergerakan</p>
          <Card className="divide-y overflow-hidden">
            {items.map((m) => {
              const positive = m.quantity > 0
              return (
                <div key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4" data-testid="movement-row">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{m.product_name}</span>
                      <Badge variant={m.movement_type === 'sale' ? 'muted' : m.movement_type === 'stock_out' ? 'danger' : 'default'}>
                        {MOVEMENT_LABEL[m.movement_type]}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {formatDateWita(m.created_at, 'd MMM yyyy, HH:mm')} · {m.user_name ?? 'Sistem'}
                      {m.transaction_number && ` · ${m.transaction_number}`}
                    </p>
                    {m.reason && <p className="text-sm">{m.reason}</p>}
                  </div>
                  <div className="text-right">
                    <p className={cn('text-lg font-bold tabular-nums', positive ? 'text-success' : 'text-destructive')}>
                      {positive ? '+' : '−'}
                      {formatNumber(Math.abs(m.quantity))} {UNIT_LABEL[m.unit]}
                    </p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {formatNumber(m.stock_before)} → {formatQty(m.stock_after, m.unit)}
                    </p>
                  </div>
                </div>
              )
            })}
          </Card>
          {q.hasNextPage && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                {q.isFetchingNextPage && <Loader2 className="animate-spin" />} Muat lebih banyak
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

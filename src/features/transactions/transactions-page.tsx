import { useState } from 'react'
import { Loader2, Receipt as ReceiptIcon, RefreshCw, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { PAYMENT_LABEL, type PaymentMethod } from '@/features/dashboard/api'
import { toUserMessage } from '@/lib/errors'
import { businessDate, formatDateWita, formatRupiah } from '@/lib/format'
import type { TransactionFilter, TransactionStatus } from './api'
import { TransactionDetailDialog } from './detail-dialog'
import { useTransactions } from './queries'

export function TransactionsPage() {
  const today = businessDate()
  const [filter, setFilter] = useState<TransactionFilter>({ from: today, to: today, status: null, method: null, search: null })
  const [searchText, setSearchText] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const q = useTransactions(filter)
  const first = q.data?.pages[0]
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  const set = (patch: Partial<TransactionFilter>) => setFilter((f) => ({ ...f, ...patch }))

  return (
    <>
      <PageHeader icon={ReceiptIcon} title="Riwayat Transaksi" description={first?.scope === 'own' ? 'Menampilkan transaksi Anda' : undefined} />

      <div className="mb-4 grid grid-cols-2 items-end gap-3 lg:grid-cols-[1fr_160px_160px_150px_150px]">
        <form
          className="relative col-span-2 lg:col-span-1"
          onSubmit={(e) => {
            e.preventDefault()
            set({ search: searchText || null })
          }}
        >
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onBlur={() => set({ search: searchText || null })}
            placeholder="Cari nomor, produk, pelanggan…"
            aria-label="Cari transaksi"
            className="pl-11"
          />
        </form>
        <label className="flex flex-col gap-1">
          <span className="px-1 text-xs text-muted-foreground">Dari</span>
          <Input type="date" aria-label="Dari tanggal" value={filter.from} max={filter.to} onChange={(e) => e.target.value && set({ from: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="px-1 text-xs text-muted-foreground">Sampai</span>
          <Input type="date" aria-label="Sampai tanggal" value={filter.to} min={filter.from} onChange={(e) => e.target.value && set({ to: e.target.value })} />
        </label>
        <NativeSelect aria-label="Filter status" value={filter.status ?? ''} onChange={(e) => set({ status: (e.target.value || null) as TransactionStatus | null })}>
          <option value="">Semua status</option>
          <option value="completed">Selesai</option>
          <option value="void">Dibatalkan</option>
        </NativeSelect>
        <NativeSelect aria-label="Filter metode" value={filter.method ?? ''} onChange={(e) => set({ method: (e.target.value || null) as PaymentMethod | null })}>
          <option value="">Semua metode</option>
          {(Object.keys(PAYMENT_LABEL) as PaymentMethod[]).map((m) => (
            <option key={m} value={m}>
              {PAYMENT_LABEL[m]}
            </option>
          ))}
        </NativeSelect>
      </div>

      {first && (
        <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 px-1 text-sm">
          <span>
            <span className="text-muted-foreground">Transaksi: </span>
            <b>{first.total}</b>
          </span>
          <span>
            <span className="text-muted-foreground">Omzet (selesai): </span>
            <b data-testid="tx-omzet">{formatRupiah(first.completed_amount)}</b>
          </span>
        </div>
      )}

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
            title="Gagal memuat transaksi"
            description={toUserMessage(q.error)}
            action={<Button variant="outline" onClick={() => void q.refetch()}>Coba lagi</Button>}
          />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={ReceiptIcon} title="Tidak ada transaksi" description="Ubah tanggal atau filter." />
        </Card>
      ) : (
        <>
          <Card className="divide-y overflow-hidden">
            {items.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setOpenId(t.id)}
                className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/60"
                data-testid="tx-row"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{t.items ?? '-'}</p>
                  <p className="text-sm text-muted-foreground">
                    {t.number} · {formatDateWita(t.created_at, 'd MMM, HH:mm')} · {t.cashier_name ?? '-'}
                    {t.customer_name && ` · ${t.customer_name}`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={t.status === 'void' ? 'font-bold text-muted-foreground line-through' : 'font-bold'}>{formatRupiah(t.total)}</span>
                  {t.status === 'void' ? <Badge variant="danger">Batal</Badge> : <Badge variant="muted">{PAYMENT_LABEL[t.payment_method]}</Badge>}
                </div>
              </button>
            ))}
          </Card>
          {q.hasNextPage && (
            <div className="mt-3 flex justify-center">
              <Button variant="outline" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                {q.isFetchingNextPage && <Loader2 className="animate-spin" />} Muat lebih banyak
              </Button>
            </div>
          )}
        </>
      )}

      <TransactionDetailDialog id={openId} onClose={() => setOpenId(null)} />
    </>
  )
}

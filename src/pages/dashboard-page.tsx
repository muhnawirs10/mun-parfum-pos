import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, BarChart3, Boxes, ChevronRight, Moon, Package, Receipt, RefreshCw, Sun, TrendingUp, Wallet } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/features/auth/auth-context'
import { PAYMENT_LABEL, useDashboard } from '@/features/dashboard/api'
import { toUserMessage } from '@/lib/errors'
import { formatDateWita, formatQty, formatRupiah, formatTimeWita, greetingWita } from '@/lib/format'
import { NAV_ITEMS } from '@/lib/navigation'

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

const QUICK = ['/produk', '/laporan', '/pengeluaran', '/stok', '/kasir', '/transaksi']

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  loading,
  to,
}: {
  icon: typeof Receipt
  label: string
  value: string
  sub?: string
  loading: boolean
  to?: string
}) {
  const body = (
    <Card className="h-full p-5 transition-colors hover:border-primary">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </p>
      {loading ? <Skeleton className="mt-4 h-8 w-32" /> : <p className="mt-3 text-2xl font-bold tabular-nums">{value}</p>}
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  )
  return to ? <Link to={to}>{body}</Link> : body
}

export function DashboardPage() {
  const now = useNow()
  const { profile, activeOutlet, can } = useAuth()
  const dash = useDashboard()
  const d = dash.data
  const greeting = greetingWita(now)
  const quick = NAV_ITEMS.filter((i) => QUICK.includes(i.to) && (!i.permissions || can(...i.permissions))).slice(0, 4)

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/25">
            {greeting === 'Selamat Malam' ? <Moon className="h-7 w-7" /> : <Sun className="h-7 w-7" />}
          </span>
          <div>
            <p className="text-xl font-bold">
              {greeting}, {profile?.full_name ?? ''}!
            </p>
            <p className="text-sm text-muted-foreground">{activeOutlet?.outlet_name}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">{formatDateWita(now)}</p>
          <p className="text-lg font-bold tabular-nums">{formatTimeWita(now, true)} WITA</p>
        </div>
      </Card>

      {dash.isError && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-destructive/30 p-4">
          <p className="text-sm text-destructive">Gagal memuat ringkasan: {toUserMessage(dash.error)}</p>
          <Button variant="outline" size="sm" onClick={() => void dash.refetch()}>
            <RefreshCw /> Coba lagi
          </Button>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Receipt}
          label={d?.scope === 'own' ? 'Transaksi Saya Hari Ini' : 'Transaksi Hari Ini'}
          value={String(d?.transaction_count ?? 0)}
          loading={dash.isPending}
          to="/transaksi"
        />
        <StatCard
          icon={BarChart3}
          label={d?.scope === 'own' ? 'Penjualan Saya Hari Ini' : 'Penjualan Hari Ini'}
          value={formatRupiah(d?.omzet ?? 0)}
          sub="Omzet setelah diskon"
          loading={dash.isPending}
          to={can('reports.view') ? '/laporan' : undefined}
        />
        {d?.gross_profit !== null && d?.gross_profit !== undefined && (
          <StatCard icon={TrendingUp} label="Laba Kotor Hari Ini" value={formatRupiah(d.gross_profit)} sub="Omzet − HPP" loading={false} />
        )}
        {d?.expenses_total !== null && d?.expenses_total !== undefined && (
          <StatCard
            icon={Wallet}
            label="Pengeluaran Hari Ini"
            value={formatRupiah(d.expenses_total)}
            sub={`${d.expenses_count ?? 0} catatan`}
            loading={false}
            to="/pengeluaran"
          />
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>
              <Receipt className="h-5 w-5" /> Transaksi Terakhir
            </CardTitle>
            <Link to="/transaksi" className="flex items-center gap-1 text-sm font-semibold hover:underline">
              Lihat semua <ChevronRight className="h-4 w-4" />
            </Link>
          </CardHeader>
          <CardContent>
            {dash.isPending ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : !d || d.recent_transactions.length === 0 ? (
              <EmptyState icon={Receipt} title="Belum ada transaksi" className="py-8" />
            ) : (
              <ul className="space-y-2">
                {d.recent_transactions.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 rounded-xl border p-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{t.items ?? t.number}</p>
                      <p className="font-bold">{formatRupiah(t.total)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-xs tabular-nums text-muted-foreground">{formatTimeWita(t.created_at)}</span>
                      {t.status === 'void' ? <Badge variant="danger">Batal</Badge> : <Badge variant="muted">{PAYMENT_LABEL[t.payment_method]}</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Operasional</CardTitle>
              <Link to="/lainnya" className="flex items-center gap-1 text-sm font-semibold hover:underline">
                Semua fitur <ChevronRight className="h-4 w-4" />
              </Link>
            </CardHeader>
            <CardContent className="grid grid-cols-4 gap-2">
              {quick.map(({ to, label, icon: Icon }) => (
                <Link key={to} to={to} className="flex flex-col items-center gap-2 rounded-xl p-2 text-center text-xs font-medium hover:bg-muted sm:text-sm">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-primary bg-primary/10">
                    <Icon className="h-5 w-5" />
                  </span>
                  {label}
                </Link>
              ))}
            </CardContent>
          </Card>

          {d?.low_stock && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <AlertTriangle className="h-5 w-5" /> Stok Menipis
                </CardTitle>
                <Badge variant={d.low_stock.length ? 'default' : 'success'}>{d.low_stock.length}</Badge>
              </CardHeader>
              <CardContent>
                {d.low_stock.length === 0 ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Boxes className="h-4 w-4" /> Semua stok aman ({d.product_count} produk aktif)
                  </p>
                ) : (
                  <ul className="divide-y">
                    {d.low_stock.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate font-medium">{p.name}</span>
                        </span>
                        <span className={p.current_stock <= 0 ? 'font-semibold text-destructive' : 'font-semibold'}>
                          {formatQty(p.current_stock, p.unit)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

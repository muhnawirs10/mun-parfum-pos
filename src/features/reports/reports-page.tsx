import { useMemo, useState } from 'react'
import { BarChart3, CreditCard, Download, FileSpreadsheet, FileText, Loader2, Printer, ShoppingCart, Trophy, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { NativeSelect } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/features/auth/auth-context'
import { PAYMENT_LABEL } from '@/features/dashboard/api'
import { fetchExpenses } from '@/features/expenses/api'
import { toUserMessage } from '@/lib/errors'
import { businessDate, formatNumber, formatRupiah, UNIT_LABEL } from '@/lib/format'
import { periodFor, periodLabel, type PeriodKind } from '@/lib/periods'
import { cn } from '@/lib/utils'
import { fetchCashSessions, useSalesReport, type SalesReport } from './api'
import { CashSessionCard } from './cash-session-card'
import { buildExcel, buildPdf, downloadBlob, fileName, reportTables } from './export'
import { PeriodInputs, PeriodTabs, type PeriodState } from './period-picker'

const KINDS: PeriodKind[] = ['daily', '7d', '30d', 'monthly', 'range']

function Stat({ icon: Icon, label, value, tone }: { icon: typeof ShoppingCart; label: string; value: string; tone?: 'minus' }) {
  return (
    <Card className="flex flex-col items-center gap-1 p-5 text-center">
      <Icon className="h-5 w-5" />
      <p className={cn('text-2xl font-bold tabular-nums', tone === 'minus' && 'text-destructive')}>{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </Card>
  )
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn('rounded-xl p-4', highlight ? 'bg-primary/20' : 'bg-muted')}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
    </div>
  )
}

function ReportBody({ r, includeExpenses }: { r: SalesReport; includeExpenses: boolean }) {
  const cash = r.by_payment_method.find((m) => m.method === 'cash')?.amount ?? 0
  const maxMethod = Math.max(1, ...r.by_payment_method.map((m) => m.amount))
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat icon={ShoppingCart} label="Transaksi" value={String(r.transaction_count)} />
        <Stat icon={TrendingUp} label="Penjualan" value={formatRupiah(r.omzet)} />
        {r.can_view_profit && (
          <Stat
            icon={TrendingUp}
            label={includeExpenses ? 'Laba bersih' : 'Laba kotor'}
            value={formatRupiah(includeExpenses ? r.net_profit : r.gross_profit)}
            tone={(includeExpenses ? r.net_profit! : r.gross_profit!) < 0 ? 'minus' : undefined}
          />
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <CreditCard className="h-5 w-5" /> Ringkasan Keuangan
          </CardTitle>
          {r.void_count > 0 && <span className="text-sm text-muted-foreground">{r.void_count} transaksi batal tidak dihitung</span>}
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Tile label="Total omzet" value={formatRupiah(r.omzet)} />
          <Tile label="Kas masuk (tunai)" value={formatRupiah(cash)} highlight />
          <Tile label="Rata-rata transaksi" value={formatRupiah(r.average_transaction)} />
          {r.discount_total > 0 && <Tile label="Total diskon" value={formatRupiah(r.discount_total)} />}
          {r.qty_by_unit.map((u) => (
            <Tile key={u.unit} label={`Terjual (${UNIT_LABEL[u.unit]})`} value={formatNumber(u.quantity)} />
          ))}
          {r.can_view_profit && (
            <>
              <Tile label="Total HPP" value={formatRupiah(r.cost_total)} />
              <Tile label="Laba kotor" value={formatRupiah(r.gross_profit)} />
              {includeExpenses && <Tile label="Pengeluaran" value={formatRupiah(r.expenses_total)} />}
              {includeExpenses && <Tile label="Laba bersih" value={formatRupiah(r.net_profit)} highlight />}
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Metode Pembayaran</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {r.by_payment_method.length === 0 && <p className="text-sm text-muted-foreground">Belum ada penjualan</p>}
            {r.by_payment_method.map((m) => (
              <div key={m.method} data-testid="method-row">
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium">
                    {PAYMENT_LABEL[m.method]} <span className="text-muted-foreground">· {m.count} trx</span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatRupiah(m.amount)}</span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${(m.amount / maxMethod) * 100}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <Trophy className="h-5 w-5" /> Produk Terlaris
            </CardTitle>
          </CardHeader>
          <CardContent>
            {r.top_products.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada penjualan</p>
            ) : (
              <ol className="divide-y text-sm">
                {r.top_products.map((p, i) => (
                  <li key={p.product_id} className="flex items-center gap-3 py-2" data-testid="top-product">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-primary">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                    <span className="text-muted-foreground">
                      {formatNumber(p.quantity)} {UNIT_LABEL[p.unit]}
                    </span>
                    <span className="w-24 text-right font-semibold tabular-nums">{formatRupiah(p.omzet)}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {r.top_profit_products && r.top_profit_products.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <TrendingUp className="h-5 w-5" /> Produk dengan Laba Terbesar
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="divide-y text-sm">
              {r.top_profit_products.map((p, i) => (
                <li key={p.product_id} className="flex items-center gap-3 py-2" data-testid="top-profit">
                  <span className="w-6 text-muted-foreground">{i + 1}.</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  <span className="text-muted-foreground">omzet {formatRupiah(p.omzet)}</span>
                  <span className="w-24 text-right font-semibold tabular-nums text-success">{formatRupiah(p.gross_profit)}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {r.by_outlet.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Perbandingan Outlet</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {r.by_outlet.map((o) => (
                <li key={o.outlet_id} className="flex items-center justify-between gap-3 py-2" data-testid="outlet-row">
                  <span className="font-medium">
                    {o.code} · {o.name}
                  </span>
                  <span className="text-muted-foreground">{o.transaction_count} trx</span>
                  <span className="font-semibold tabular-nums">{formatRupiah(o.omzet)}</span>
                  {o.gross_profit !== null && <span className="w-28 text-right tabular-nums text-success">laba {formatRupiah(o.gross_profit)}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export function ReportsPage() {
  const { can, client, activeOutlet, outlets, profile } = useAuth()
  const today = businessDate()
  const canReports = can('reports.view')
  const canProfit = can('profit.view')
  const [state, setState] = useState<PeriodState>({ kind: 'daily', anchor: today, month: today.slice(0, 7), range: { from: today.slice(0, 8) + '01', to: today } })
  const [includeExpenses, setIncludeExpenses] = useState(true)
  const [scope, setScope] = useState<'outlet' | 'all'>('outlet')
  const [busy, setBusy] = useState<null | 'pdf' | 'xlsx' | 'closing'>(null)
  const period = useMemo(() => periodFor(state.kind, state), [state])
  const all = scope === 'all' && outlets.length > 1
  const report = useSalesReport(period, includeExpenses && canProfit, all, canReports)

  const meta = (title: string) => ({
    title,
    outletName: all ? `Semua outlet (${outlets.length})` : `${activeOutlet!.outlet_name} (${activeOutlet!.outlet_code})`,
    generatedBy: profile?.full_name ?? '-',
  })

  async function run(kind: 'pdf' | 'xlsx' | 'closing') {
    if (!report.data || busy) return
    setBusy(kind)
    try {
      if (kind === 'closing') {
        const [sessions, expenses] = await Promise.all([
          fetchCashSessions(client!, activeOutlet!.outlet_id, period),
          can('expenses.view', 'expenses.manage') ? fetchExpenses(client!, activeOutlet!.outlet_id, period, null) : Promise.resolve(null),
        ])
        const blob = await buildPdf(meta('Laporan Closing Harian'), period, reportTables(report.data, { sessions, expenses }))
        downloadBlob(blob, fileName(`closing_${activeOutlet!.outlet_code}`, period, 'pdf'))
      } else {
        const tables = reportTables(report.data)
        const m = meta('Laporan Penjualan')
        const blob = kind === 'pdf' ? await buildPdf(m, period, tables) : await buildExcel(m, period, tables)
        downloadBlob(blob, fileName(`laporan_${all ? 'semua' : activeOutlet!.outlet_code}`, period, kind))
      }
      toast.success('File laporan dibuat')
    } catch (e) {
      toast.error(`Gagal membuat file: ${toUserMessage(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const hasSales = (report.data?.transaction_count ?? 0) > 0

  return (
    <>
      <PageHeader
        icon={BarChart3}
        title="Laporan"
        actions={
          canReports && (
            <>
              <Button variant="outline" onClick={() => void run('xlsx')} disabled={!report.data || !!busy}>
                {busy === 'xlsx' ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Excel
              </Button>
              <Button variant="outline" onClick={() => void run('pdf')} disabled={!report.data || !!busy}>
                {busy === 'pdf' ? <Loader2 className="animate-spin" /> : <FileText />} PDF
              </Button>
            </>
          )
        }
      />

      {!canReports ? (
        <CashSessionCard className="max-w-xl" />
      ) : (
        <div className="space-y-5">
          <PeriodTabs value={state.kind} onChange={(kind) => setState((s) => ({ ...s, kind }))} kinds={KINDS} />
          <Card className="space-y-4 p-5">
            <div className={cn('grid gap-4', outlets.length > 1 && 'sm:grid-cols-[1fr_220px]')}>
              <PeriodInputs state={state} onChange={setState} max={today} />
              {outlets.length > 1 && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Outlet</span>
                  <NativeSelect aria-label="Cakupan outlet" value={scope} onChange={(e) => setScope(e.target.value as 'outlet' | 'all')}>
                    <option value="outlet">{activeOutlet?.outlet_name}</option>
                    <option value="all">Semua outlet</option>
                  </NativeSelect>
                </label>
              )}
            </div>
            <p className="text-sm text-muted-foreground">Periode: {periodLabel(period)} (WITA)</p>
            {canProfit && (
              <label className="flex items-center justify-between gap-4 rounded-xl bg-muted p-4">
                <span>
                  <span className="block font-medium">Masukkan pengeluaran</span>
                  <span className="block text-sm text-muted-foreground">Pengeluaran akan mengurangi laba bersih</span>
                </span>
                <Switch checked={includeExpenses} onCheckedChange={setIncludeExpenses} aria-label="Masukkan pengeluaran" />
              </label>
            )}
            {state.kind === 'daily' && !all && (
              <>
                <Button size="lg" className="w-full" onClick={() => void run('closing')} disabled={!hasSales || !!busy}>
                  {busy === 'closing' ? <Loader2 className="animate-spin" /> : <Printer />} Cetak Laporan Closing (PDF)
                </Button>
                {report.data && !hasSales && (
                  <p className="text-center text-sm text-destructive">* Belum ada transaksi penjualan pada tanggal terpilih</p>
                )}
              </>
            )}
          </Card>

          {report.isPending ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
          ) : report.isError ? (
            <Card>
              <EmptyState
                icon={Download}
                title="Gagal memuat laporan"
                description={toUserMessage(report.error)}
                action={<Button variant="outline" onClick={() => void report.refetch()}>Coba lagi</Button>}
              />
            </Card>
          ) : (
            <ReportBody r={report.data} includeExpenses={includeExpenses && canProfit} />
          )}

          {can('closing.perform') && <CashSessionCard />}
        </div>
      )}
    </>
  )
}

import { useMemo, useState } from 'react'
import { Pencil, Plus, RefreshCw, Trash2, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { NativeSelect } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { PeriodInputs, PeriodTabs, type PeriodState } from '@/features/reports/period-picker'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { toUserMessage } from '@/lib/errors'
import { businessDate, formatDateWita, formatRupiah } from '@/lib/format'
import { periodFor, periodLabel } from '@/lib/periods'
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL, useDeleteExpense, useExpenses, type Expense, type ExpenseCategory } from './api'
import { ExpenseDialog } from './expense-dialog'

export function ExpensesPage() {
  const today = businessDate()
  const online = useOnlineStatus()
  const [state, setState] = useState<PeriodState>({ kind: 'monthly', anchor: today, month: today.slice(0, 7), range: { from: today.slice(0, 8) + '01', to: today } })
  const [category, setCategory] = useState<ExpenseCategory | null>(null)
  const period = useMemo(() => periodFor(state.kind, state), [state])
  const q = useExpenses(period, category)
  const del = useDeleteExpense()
  const [dialog, setDialog] = useState<{ open: boolean; expense: Expense | null }>({ open: false, expense: null })
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const canManage = q.data?.can_manage ?? false

  function remove(e: Expense) {
    if (!online) return toast.error('Tidak ada koneksi internet.')
    del.mutate(e.id, {
      onSuccess: () => {
        toast.success('Pengeluaran dihapus')
        setConfirmId(null)
      },
      onError: (err) => toast.error(toUserMessage(err)),
    })
  }

  return (
    <>
      <PageHeader
        icon={Wallet}
        title="Pengeluaran"
        description="Biaya operasional — mengurangi laba bersih"
        actions={
          canManage && (
            <Button onClick={() => setDialog({ open: true, expense: null })}>
              <Plus /> Catat
            </Button>
          )
        }
      />
      <div className="mb-4 space-y-3">
        <PeriodTabs value={state.kind} onChange={(kind) => setState((s) => ({ ...s, kind }))} kinds={['daily', 'monthly', 'range']} />
        <Card className="grid gap-3 p-4 sm:grid-cols-[1fr_220px]">
          <PeriodInputs state={state} onChange={setState} max={today} />
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Kategori</span>
            <NativeSelect aria-label="Filter kategori pengeluaran" value={category ?? ''} onChange={(e) => setCategory((e.target.value || null) as ExpenseCategory | null)}>
              <option value="">Semua kategori</option>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {EXPENSE_CATEGORY_LABEL[c]}
                </option>
              ))}
            </NativeSelect>
          </label>
        </Card>
      </div>

      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <Card>
          <EmptyState icon={RefreshCw} title="Gagal memuat pengeluaran" description={toUserMessage(q.error)} action={<Button variant="outline" onClick={() => void q.refetch()}>Coba lagi</Button>} />
        </Card>
      ) : (
        <>
          <Card className="mb-4 p-5">
            <p className="text-sm text-muted-foreground">Total pengeluaran · {periodLabel(period)}</p>
            <p className="text-3xl font-bold tabular-nums" data-testid="expense-total">
              {formatRupiah(q.data.total_amount)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {q.data.by_category.map((c) => (
                <Badge key={c.category} variant="default">
                  {EXPENSE_CATEGORY_LABEL[c.category]} · {formatRupiah(c.amount)}
                </Badge>
              ))}
            </div>
          </Card>
          {q.data.items.length === 0 ? (
            <Card>
              <EmptyState icon={Wallet} title="Belum ada pengeluaran" description="Tidak ada catatan pada periode ini." />
            </Card>
          ) : (
            <Card className="divide-y overflow-hidden">
              {q.data.items.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center gap-3 p-4" data-testid="expense-row">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{EXPENSE_CATEGORY_LABEL[e.category]}</Badge>
                      <span className="text-sm text-muted-foreground">{formatDateWita(e.expense_date + 'T12:00:00+08:00', 'EEEE, d MMM yyyy')}</span>
                    </div>
                    {e.description && <p className="mt-1">{e.description}</p>}
                    <p className="text-xs text-muted-foreground">Dicatat oleh {e.created_by_name ?? '-'}</p>
                  </div>
                  <p className="text-lg font-bold tabular-nums">{formatRupiah(e.amount)}</p>
                  {canManage &&
                    (confirmId === e.id ? (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => setConfirmId(null)}>
                          Batal
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => remove(e)} disabled={del.isPending}>
                          Hapus
                        </Button>
                      </div>
                    ) : (
                      <div className="flex">
                        <Button size="icon" variant="ghost" aria-label="Ubah pengeluaran" onClick={() => setDialog({ open: true, expense: e })}>
                          <Pencil />
                        </Button>
                        <Button size="icon" variant="destructive-ghost" aria-label="Hapus pengeluaran" onClick={() => setConfirmId(e.id)}>
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                </div>
              ))}
            </Card>
          )}
        </>
      )}
      <ExpenseDialog open={dialog.open} expense={dialog.expense} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} />
    </>
  )
}

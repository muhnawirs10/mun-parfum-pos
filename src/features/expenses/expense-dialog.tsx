import { useEffect, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { toUserMessage } from '@/lib/errors'
import { businessDate, formatNumber } from '@/lib/format'
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL, useSaveExpense, type Expense } from './api'
import { expenseSchema, type ExpenseFormValues } from './schema'

type Errors = Partial<Record<keyof ExpenseFormValues | 'form', string>>

export function ExpenseDialog({ open, onOpenChange, expense }: { open: boolean; onOpenChange: (o: boolean) => void; expense: Expense | null }) {
  const online = useOnlineStatus()
  const save = useSaveExpense()
  const [v, setV] = useState<ExpenseFormValues>({ expense_date: businessDate(), category: 'operasional', amount: '', description: '' })
  const [errors, setErrors] = useState<Errors>({})

  useEffect(() => {
    if (!open) return
    setErrors({})
    setV(
      expense
        ? { expense_date: expense.expense_date, category: expense.category, amount: formatNumber(expense.amount, 2), description: expense.description ?? '' }
        : { expense_date: businessDate(), category: 'operasional', amount: '', description: '' },
    )
  }, [open, expense])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (save.isPending) return
    const parsed = expenseSchema.safeParse(v)
    if (!parsed.success) {
      const next: Errors = {}
      for (const i of parsed.error.issues) next[i.path[0] as keyof ExpenseFormValues] ??= i.message
      return setErrors(next)
    }
    if (!online) return setErrors({ form: 'Tidak ada koneksi internet. Pengeluaran belum disimpan.' })
    setErrors({})
    try {
      await save.mutateAsync({ id: expense?.id, values: parsed.data })
      toast.success(expense ? 'Pengeluaran diperbarui' : 'Pengeluaran dicatat')
      onOpenChange(false)
    } catch (err) {
      setErrors({ form: toUserMessage(err) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent title={expense ? 'Ubah Pengeluaran' : 'Catat Pengeluaran'} className="max-w-md">
        <form onSubmit={onSubmit} noValidate className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <Field id="expense_date" label="Tanggal" error={errors.expense_date}>
              <Input id="expense_date" type="date" max={businessDate()} value={v.expense_date} onChange={(e) => setV({ ...v, expense_date: e.target.value })} />
            </Field>
            <Field id="category" label="Kategori" error={errors.category}>
              <NativeSelect id="category" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value as ExpenseFormValues['category'] })}>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {EXPENSE_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field id="amount" label="Nominal (Rp)" error={errors.amount}>
            <Input id="amount" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} placeholder="150.000" className="h-12 text-lg font-bold" />
          </Field>
          <Field id="description" label="Keterangan" error={errors.description}>
            <Textarea id="description" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} rows={2} placeholder="contoh: token listrik November" />
          </Field>
          {errors.form && (
            <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
              {errors.form}
            </p>
          )}
          <p className="text-xs text-muted-foreground">Pengeluaran mengurangi laba bersih, tidak mengubah omzet maupun stok.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Simpan
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

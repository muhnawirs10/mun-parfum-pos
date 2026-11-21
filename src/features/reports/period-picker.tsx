import { Input } from '@/components/ui/input'
import { PERIOD_LABEL, type Period, type PeriodKind } from '@/lib/periods'
import { cn } from '@/lib/utils'

export interface PeriodState {
  kind: PeriodKind
  anchor: string
  month: string
  range: Period
}

export function PeriodTabs({ value, onChange, kinds }: { value: PeriodKind; onChange: (k: PeriodKind) => void; kinds: PeriodKind[] }) {
  return (
    <div className="flex w-full gap-1 overflow-x-auto rounded-2xl bg-muted p-1" role="tablist" aria-label="Periode">
      {kinds.map((k) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={value === k}
          onClick={() => onChange(k)}
          className={cn(
            'h-11 min-w-0 flex-1 rounded-xl px-1 text-xs font-medium transition-colors sm:px-3 sm:text-sm',
            value === k ? 'bg-card font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {PERIOD_LABEL[k]}
        </button>
      ))}
    </div>
  )
}

export function PeriodInputs({ state, onChange, max }: { state: PeriodState; onChange: (s: PeriodState) => void; max: string }) {
  if (state.kind === 'monthly') {
    return (
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Bulan</span>
        <Input type="month" aria-label="Bulan laporan" value={state.month} max={max.slice(0, 7)} onChange={(e) => e.target.value && onChange({ ...state, month: e.target.value })} />
      </label>
    )
  }
  if (state.kind === 'range') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Dari</span>
          <Input type="date" aria-label="Dari tanggal" value={state.range.from} max={max} onChange={(e) => e.target.value && onChange({ ...state, range: { ...state.range, from: e.target.value } })} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Sampai</span>
          <Input type="date" aria-label="Sampai tanggal" value={state.range.to} max={max} onChange={(e) => e.target.value && onChange({ ...state, range: { ...state.range, to: e.target.value } })} />
        </label>
      </div>
    )
  }
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{state.kind === 'daily' ? 'Tanggal laporan' : 'Sampai tanggal'}</span>
      <Input type="date" aria-label="Tanggal laporan" value={state.anchor} max={max} onChange={(e) => e.target.value && onChange({ ...state, anchor: e.target.value })} />
    </label>
  )
}

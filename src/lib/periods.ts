/**
 * Periode laporan dalam tanggal bisnis WITA. Semua tanggal berupa string
 * 'YYYY-MM-DD' dan dihitung dengan aritmetika kalender UTC murni sehingga
 * tidak terpengaruh zona waktu perangkat.
 */
export type PeriodKind = 'daily' | '7d' | '30d' | 'monthly' | 'range'

export const PERIOD_LABEL: Record<PeriodKind, string> = {
  daily: 'Harian',
  '7d': '7 Hari',
  '30d': '30 Hari',
  monthly: 'Bulanan',
  range: 'Rentang',
}

export interface Period {
  from: string
  to: string
}

function toUtc(d: string): Date {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day))
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date)
  d.setUTCDate(d.getUTCDate() + days)
  return fmt(d)
}

export function monthRange(month: string): Period {
  const [y, m] = month.split('-').map(Number)
  return { from: fmt(new Date(Date.UTC(y, m - 1, 1))), to: fmt(new Date(Date.UTC(y, m, 0))) }
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000)
}

/**
 * @param anchor tanggal acuan (harian/7 hari/30 hari: hari terakhir periode)
 * @param month 'YYYY-MM' untuk bulanan
 */
export function periodFor(kind: PeriodKind, opts: { anchor: string; month?: string; range?: Period }): Period {
  switch (kind) {
    case 'daily':
      return { from: opts.anchor, to: opts.anchor }
    case '7d':
      return { from: addDays(opts.anchor, -6), to: opts.anchor }
    case '30d':
      return { from: addDays(opts.anchor, -29), to: opts.anchor }
    case 'monthly':
      return monthRange(opts.month ?? opts.anchor.slice(0, 7))
    case 'range': {
      const r = opts.range ?? { from: opts.anchor, to: opts.anchor }
      return r.from <= r.to ? r : { from: r.to, to: r.from }
    }
  }
}

/** Label periode untuk judul laporan/PDF, mis. "21/11/2026" atau "15/11/2026 – 21/11/2026". */
export function periodLabel(p: Period): string {
  const f = (d: string) => d.split('-').reverse().join('/')
  return p.from === p.to ? f(p.from) : `${f(p.from)} – ${f(p.to)}`
}

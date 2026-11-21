import { addDays, daysBetween, monthRange, periodFor, periodLabel } from './periods'

describe('periode laporan (tanggal WITA)', () => {
  const anchor = '2026-11-21'
  it('harian, 7 hari, 30 hari', () => {
    expect(periodFor('daily', { anchor })).toEqual({ from: '2026-11-21', to: '2026-11-21' })
    expect(periodFor('7d', { anchor })).toEqual({ from: '2026-11-15', to: '2026-11-21' })
    expect(periodFor('30d', { anchor })).toEqual({ from: '2026-10-23', to: '2026-11-21' })
    expect(daysBetween('2026-10-23', '2026-11-21')).toBe(29)
  })
  it('bulanan termasuk Februari kabisat dan pergantian tahun', () => {
    expect(periodFor('monthly', { anchor })).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' })
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('rentang dibalik bila terbalik; label', () => {
    expect(periodFor('range', { anchor, range: { from: '2026-11-20', to: '2026-11-01' } })).toEqual({ from: '2026-11-01', to: '2026-11-20' })
    expect(periodLabel({ from: '2026-11-21', to: '2026-11-21' })).toBe('21/11/2026')
    expect(periodLabel({ from: '2026-11-15', to: '2026-11-21' })).toBe('15/11/2026 – 21/11/2026')
  })
})

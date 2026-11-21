import { businessDate, formatNumber, formatQty, formatRupiah, formatTimeWita } from './format'

describe('format', () => {
  it('Rupiah', () => {
    expect(formatRupiah('20000')).toBe('Rp20.000')
    expect(formatRupiah('1014')).toBe('Rp1.014')
    expect(formatRupiah('1234567.5')).toBe('Rp1.234.568')
    expect(formatRupiah('-2140')).toBe('-Rp2.140')
    expect(formatRupiah(null)).toBe('Rp0')
  })
  it('angka & satuan', () => {
    expect(formatNumber('148.5')).toBe('148,5')
    expect(formatNumber('1250.25')).toBe('1.250,25')
    expect(formatQty('297', 'ML')).toBe('297 ml')
  })
  it('zona waktu WITA (UTC+8)', () => {
    // 2026-11-21 16:30 UTC = 2026-11-22 00:30 WITA
    expect(businessDate(new Date('2026-11-21T16:30:00Z'))).toBe('2026-11-22')
    expect(businessDate(new Date('2026-11-21T15:59:59Z'))).toBe('2026-11-21')
    expect(formatTimeWita('2026-11-21T13:11:07Z', true)).toBe('21:11:07')
  })
})

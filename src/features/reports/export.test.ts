// @vitest-environment node
import { unzipSync, strFromU8 } from 'fflate'
import type { SalesReport } from './api'
import { buildPdf, excelRows, fileName, pdfSafe, reportTables, summaryTable, topProductsTable } from './export'

export const REPORT: SalesReport = {
  from: '2026-11-21',
  to: '2026-11-21',
  outlet_ids: ['o-tkl'],
  can_view_profit: true,
  transaction_count: 2,
  omzet: 35000,
  subtotal_before_discount: 35000,
  discount_total: 0,
  average_transaction: 17500,
  item_count: 2,
  cost_total: 16200,
  gross_profit: 18800,
  expenses_total: 5000,
  net_profit: 13800,
  void_count: 1,
  qty_by_unit: [{ unit: 'ML', quantity: 15 }],
  by_payment_method: [
    { method: 'cash', count: 1, amount: 20000 },
    { method: 'qris', count: 1, amount: 15000 },
  ],
  top_products: [
    { product_id: 'p1', name: 'VALENTINE / SCANDALOUS', unit: 'ML', quantity: 10, omzet: 20000, gross_profit: 9860 },
    { product_id: 'p2', name: 'AIGNER BLUE / BLUE EMO', unit: 'ML', quantity: 5, omzet: 15000, gross_profit: 8940 },
  ],
  top_profit_products: [{ product_id: 'p1', name: 'VALENTINE / SCANDALOUS', unit: 'ML', quantity: 10, omzet: 20000, gross_profit: 9860 }],
  by_outlet: [{ outlet_id: 'o-tkl', code: 'TKL', name: 'MUN Parfum Takalar', transaction_count: 2, omzet: 35000, gross_profit: 18800 }],
}

const META = { title: 'Laporan Penjualan', outletName: 'MUN Parfum Takalar', generatedBy: 'Nawir', generatedAt: new Date('2026-11-21T14:00:00Z') }

describe('isi laporan', () => {
  it('ringkasan memuat omzet, HPP, laba kotor, pengeluaran, laba bersih', () => {
    const rows = Object.fromEntries(summaryTable(REPORT).rows as [string, string][])
    expect(rows['Omzet (setelah diskon)']).toBe('Rp35.000')
    expect(rows['Total HPP']).toBe('Rp16.200')
    expect(rows['Laba kotor (omzet − HPP)']).toBe('Rp18.800')
    expect(rows['Pengeluaran operasional']).toBe('Rp5.000')
    expect(rows['Laba bersih (laba kotor − pengeluaran)']).toBe('Rp13.800')
    expect(rows['Rata-rata nilai transaksi']).toBe('Rp17.500')
    expect(rows['Terjual (ml)']).toBe('15')
    expect(rows['Transaksi dibatalkan (tidak dihitung)']).toBe('1')
  })

  it('tanpa izin laba: HPP, laba, dan kolom laba tidak muncul', () => {
    const r: SalesReport = { ...REPORT, can_view_profit: false, cost_total: null, gross_profit: null, expenses_total: null, net_profit: null, top_profit_products: null }
    const text = JSON.stringify(reportTables(r))
    expect(text).not.toMatch(/HPP|Laba/)
    expect(topProductsTable(r).head).toEqual(['Produk', 'Terjual', 'Omzet'])
  })

  it('pdfSafe mengganti karakter di luar WinAnsi', () => {
    expect(pdfSafe('omzet − HPP')).toBe('omzet - HPP')
    expect(pdfSafe('21/11/2026 – 22/11/2026')).toBe('21/11/2026 – 22/11/2026')
    expect(pdfSafe('Rp20.000 ✓')).toBe('Rp20.000 ?')
  })

  it('nama file', () => {
    expect(fileName('laporan', { from: '2026-11-21', to: '2026-11-21' }, 'pdf')).toBe('laporan_2026-11-21.pdf')
    expect(fileName('laporan', { from: '2026-11-01', to: '2026-11-30' }, 'xlsx')).toBe('laporan_2026-11-01_sd_2026-11-30.xlsx')
  })
})

describe('file export', () => {
  it('PDF valid dihasilkan', async () => {
    const blob = await buildPdf(META, REPORT, reportTables(REPORT))
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.startsWith('%PDF-')).toBe(true)
    expect(text).toContain('Laporan Penjualan')
    expect(text).toContain('VALENTINE / SCANDALOUS')
    expect(text).toContain('Rp13.800')
    expect(bytes.length).toBeGreaterThan(2000)
    expect(text).toContain('omzet - HPP') // tanda kurung di-escape dalam string PDF
    expect(text).not.toContain('\u2212')
  })

  it('Excel (.xlsx) valid dan berisi data laporan', async () => {
    const { default: writeExcelFile } = await import('write-excel-file/node')
    const rows = excelRows(META, REPORT, reportTables(REPORT)).map((r) => r.map((v) => (v === null ? null : { value: v })))
    const buf = await writeExcelFile(rows).toBuffer()
    const files = unzipSync(new Uint8Array(buf))
    expect(Object.keys(files)).toContain('xl/worksheets/sheet1.xml')
    const all = Object.values(files).map((f) => strFromU8(f)).join('\n')
    expect(all).toContain('Laporan Penjualan')
    expect(all).toContain('Periode: 21/11/2026 (WITA)')
    expect(all).toContain('Laba bersih (laba kotor − pengeluaran)')
    expect(all).toContain('Rp13.800')
  })
})

describe('keamanan export Excel', () => {
  it('nama produk berawalan "=" disimpan sebagai teks, bukan formula (anti formula-injection)', async () => {
    const { default: writeExcelFile } = await import('write-excel-file/node')
    const evil = '=HYPERLINK("http://evil.example","klik")'
    const r = { ...REPORT, top_products: [{ ...REPORT.top_products[0], name: evil }], top_profit_products: null }
    const rows = excelRows(META, r, reportTables(r)).map((row) => row.map((v) => (v === null ? null : { value: v })))
    const files = unzipSync(new Uint8Array(await writeExcelFile(rows).toBuffer()))
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml'])
    expect(sheet).not.toMatch(/<f>/) // tidak ada sel formula
    const all = Object.values(files).map((f) => strFromU8(f)).join('\n')
    expect(all).toMatch(/=HYPERLINK\((&quot;|")http:\/\/evil\.example/) // tersimpan sebagai teks biasa
    // setiap sel bernilai teks bertipe string (shared/inline string), bukan formula
    expect(sheet).not.toMatch(/t="e"|<f\b/)
  })
})

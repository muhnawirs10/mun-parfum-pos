/**
 * Penyusunan isi laporan untuk PDF & Excel. Bagian penyusunan data berupa
 * fungsi murni (mudah diuji); pustaka PDF/Excel dimuat saat dibutuhkan saja.
 */
import { PAYMENT_LABEL } from '@/features/dashboard/api'
import type { ExpenseCategory, ExpenseList } from '@/features/expenses/api'
import { EXPENSE_CATEGORY_LABEL } from '@/features/expenses/api'
import { formatDateWita, formatNumber, formatRupiah, UNIT_LABEL } from '@/lib/format'
import { periodLabel } from '@/lib/periods'
import type { CashSession, SalesReport } from './api'

export interface ReportMeta {
  title: string
  outletName: string
  generatedBy: string
  generatedAt?: Date
}

export interface Table {
  title: string
  head: string[]
  rows: (string | number)[][]
  /** kolom berisi angka (rata kanan) */
  numeric?: number[]
}

/** Ringkasan keuangan. Baris laba hanya bila pengguna berizin. */
export function summaryTable(r: SalesReport): Table {
  const rows: [string, string][] = [
    ['Jumlah transaksi', String(r.transaction_count)],
    ['Transaksi dibatalkan (tidak dihitung)', String(r.void_count)],
    ['Penjualan kotor (sebelum diskon)', formatRupiah(r.subtotal_before_discount)],
    ['Total diskon', formatRupiah(r.discount_total)],
    ['Omzet (setelah diskon)', formatRupiah(r.omzet)],
    ['Rata-rata nilai transaksi', formatRupiah(r.average_transaction)],
  ]
  for (const u of r.qty_by_unit) rows.push([`Terjual (${UNIT_LABEL[u.unit]})`, formatNumber(u.quantity)])
  if (r.can_view_profit) {
    rows.push(['Total HPP', formatRupiah(r.cost_total)])
    rows.push(['Laba kotor (omzet − HPP)', formatRupiah(r.gross_profit)])
    rows.push(['Pengeluaran operasional', formatRupiah(r.expenses_total)])
    rows.push(['Laba bersih (laba kotor − pengeluaran)', formatRupiah(r.net_profit)])
  }
  return { title: 'Ringkasan', head: ['Keterangan', 'Nilai'], rows, numeric: [1] }
}

export function paymentTable(r: SalesReport): Table {
  return {
    title: 'Penjualan per metode pembayaran',
    head: ['Metode', 'Transaksi', 'Nominal'],
    rows: r.by_payment_method.map((m) => [PAYMENT_LABEL[m.method], m.count, formatRupiah(m.amount)]),
    numeric: [1, 2],
  }
}

export function topProductsTable(r: SalesReport): Table {
  const withProfit = r.can_view_profit
  return {
    title: 'Produk terlaris',
    head: ['Produk', 'Terjual', 'Omzet', ...(withProfit ? ['Laba kotor'] : [])],
    rows: r.top_products.map((p) => [
      p.name,
      `${formatNumber(p.quantity)} ${UNIT_LABEL[p.unit]}`,
      formatRupiah(p.omzet),
      ...(withProfit ? [formatRupiah(p.gross_profit)] : []),
    ]),
    numeric: withProfit ? [1, 2, 3] : [1, 2],
  }
}

export function topProfitTable(r: SalesReport): Table | null {
  if (!r.top_profit_products) return null
  return {
    title: 'Produk dengan laba terbesar',
    head: ['Produk', 'Terjual', 'Omzet', 'Laba kotor'],
    rows: r.top_profit_products.map((p) => [p.name, `${formatNumber(p.quantity)} ${UNIT_LABEL[p.unit]}`, formatRupiah(p.omzet), formatRupiah(p.gross_profit)]),
    numeric: [1, 2, 3],
  }
}

export function outletTable(r: SalesReport): Table | null {
  if (r.by_outlet.length < 2) return null
  return {
    title: 'Perbandingan outlet',
    head: ['Outlet', 'Transaksi', 'Omzet', ...(r.can_view_profit ? ['Laba kotor'] : [])],
    rows: r.by_outlet.map((o) => [
      `${o.code} — ${o.name}`,
      o.transaction_count,
      formatRupiah(o.omzet),
      ...(r.can_view_profit ? [formatRupiah(o.gross_profit)] : []),
    ]),
    numeric: [1, 2, 3],
  }
}

export function expenseTable(e: ExpenseList): Table {
  return {
    title: 'Pengeluaran per kategori',
    head: ['Kategori', 'Catatan', 'Nominal'],
    rows: [...e.by_category.map((c) => [EXPENSE_CATEGORY_LABEL[c.category as ExpenseCategory], c.count, formatRupiah(c.amount)]), ['Total', e.count, formatRupiah(e.total_amount)]],
    numeric: [1, 2],
  }
}

export function cashSessionsTable(sessions: CashSession[]): Table {
  return {
    title: 'Sesi kas',
    head: ['Kasir', 'Buka', 'Tutup', 'Kas awal', 'Tunai masuk', 'Kas seharusnya', 'Kas fisik', 'Selisih'],
    rows: sessions.map((s) => [
      s.opened_by_name ?? '-',
      formatDateWita(s.opened_at, 'HH:mm'),
      s.closed_at ? formatDateWita(s.closed_at, 'HH:mm') : 'Masih buka',
      formatRupiah(s.opening_cash),
      formatRupiah(s.cash_sales),
      formatRupiah(s.expected_cash),
      s.counted_cash === null ? '-' : formatRupiah(s.counted_cash),
      s.cash_difference === null ? '-' : formatRupiah(s.cash_difference),
    ]),
    numeric: [3, 4, 5, 6, 7],
  }
}

/** Semua tabel laporan penjualan (+ closing bila ada sesi kas / pengeluaran). */
export function reportTables(r: SalesReport, extra: { expenses?: ExpenseList | null; sessions?: CashSession[] | null } = {}): Table[] {
  return [
    summaryTable(r),
    paymentTable(r),
    topProductsTable(r),
    topProfitTable(r),
    outletTable(r),
    extra.expenses && extra.expenses.count > 0 ? expenseTable(extra.expenses) : null,
    extra.sessions && extra.sessions.length > 0 ? cashSessionsTable(extra.sessions) : null,
  ].filter((t): t is Table => t !== null)
}

export function fileName(prefix: string, r: { from: string; to: string }, ext: 'pdf' | 'xlsx') {
  return `${prefix}_${r.from}${r.from === r.to ? '' : `_sd_${r.to}`}.${ext}`
}

function headerLines(meta: ReportMeta, r: { from: string; to: string }) {
  return [
    meta.outletName,
    `Periode: ${periodLabel(r)} (WITA)`,
    `Dibuat: ${formatDateWita(meta.generatedAt ?? new Date(), 'd MMM yyyy HH:mm')} WITA oleh ${meta.generatedBy}`,
  ]
}

/**
 * Font standar PDF (Helvetica/WinAnsi) tidak memuat beberapa karakter Unicode;
 * ganti dengan padanan aman agar tidak tercetak sebagai simbol rusak.
 */
export function pdfSafe(text: string): string {
  return text.replace(/\u2212/g, '-').replace(/[\u2192]/g, '->').replace(/[^\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC]/g, '?')
}

/** Membuat PDF (A4). Mengembalikan Blob. */
export async function buildPdf(meta: ReportMeta, r: { from: string; to: string }, tables: Table[]): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(pdfSafe(meta.title), 14, 18)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  headerLines(meta, r).forEach((line, i) => doc.text(pdfSafe(line), 14, 25 + i * 5))
  let y = 42
  for (const t of tables) {
    if (y > 260) {
      doc.addPage()
      y = 18
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(pdfSafe(t.title), 14, y)
    autoTable(doc, {
      startY: y + 2,
      head: [t.head.map(pdfSafe)],
      body: t.rows.map((row) => row.map((c) => pdfSafe(String(c)))),
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 1.8 },
      headStyles: { fillColor: [23, 23, 23], textColor: [245, 197, 24] },
      columnStyles: Object.fromEntries((t.numeric ?? []).map((i) => [i, { halign: 'right' as const }])),
      margin: { left: 14, right: 14 },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
  }
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.text(`MUN PARFUM POS · Halaman ${i}/${pages}`, 14, 290)
  }
  return doc.output('blob')
}

/** Baris sheet Excel: header laporan + setiap tabel dipisah baris kosong. */
export function excelRows(meta: ReportMeta, r: { from: string; to: string }, tables: Table[]) {
  const rows: (string | number | null)[][] = [[meta.title], ...headerLines(meta, r).map((l) => [l]), []]
  for (const t of tables) {
    rows.push([t.title])
    rows.push(t.head)
    rows.push(...t.rows)
    rows.push([])
  }
  return rows
}

export async function buildExcel(meta: ReportMeta, r: { from: string; to: string }, tables: Table[]): Promise<Blob> {
  const { default: writeExcelFile } = await import('write-excel-file/browser')
  const data = excelRows(meta, r, tables).map((row) =>
    row.map((v, i) => (v === null || v === undefined ? null : i === 0 && row.length === 1 ? { value: String(v), fontWeight: 'bold' as const } : { value: v })),
  )
  return writeExcelFile(data).toBlob()
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

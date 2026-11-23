import { formatTimeWita } from '@/lib/format'
import type { Table } from '@/features/reports/export'
import type { Recap } from './api'
import { DAY_STATUS_LABEL, formatMinutes, HIDDEN_DAY } from './lib'

/** Tabel ekspor (format sama dengan laporan penjualan). */
export function recapTables(r: Recap): Table[] {
  return [
    {
      title: 'Ringkasan per karyawan',
      head: ['Karyawan', 'Hadir', 'Terlambat', 'Total telat', 'Sakit', 'Izin', 'Cuti', 'Libur', 'Mangkir', 'Jam kerja'],
      rows: r.employees.map((e) => [
        e.full_name,
        e.summary.hadir,
        e.summary.terlambat,
        formatMinutes(e.summary.late_minutes),
        e.summary.sakit,
        e.summary.izin,
        e.summary.cuti,
        e.summary.libur,
        e.summary.mangkir,
        formatMinutes(e.summary.worked_minutes),
      ]),
      numeric: [1, 2, 4, 5, 6, 7, 8],
    },
    {
      title: 'Rincian harian',
      head: ['Tanggal', 'Karyawan', 'Status', 'Masuk', 'Pulang', 'Telat (mnt)', 'Jarak masuk (m)'],
      rows: r.employees.flatMap((e) =>
        e.days
          .filter((d) => !HIDDEN_DAY.has(d.status))
          .map((d) => [
            d.date,
            e.full_name,
            DAY_STATUS_LABEL[d.status] ?? d.status,
            d.check_in_at ? formatTimeWita(d.check_in_at) : '',
            d.check_out_at ? formatTimeWita(d.check_out_at) : '',
            d.late_minutes ?? '',
            d.check_in_distance_m ?? '',
          ]),
      ),
      numeric: [5, 6],
    },
  ]
}


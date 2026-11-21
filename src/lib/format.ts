import { Decimal, type DecimalInput } from './decimal'
import { TZDate } from '@date-fns/tz'
import { format as fmt } from 'date-fns'
import { id as localeId } from 'date-fns/locale'

/** Zona waktu bisnis: Asia/Makassar (WITA, UTC+8). */
export const BUSINESS_TZ = 'Asia/Makassar'

function groupThousands(intStr: string) {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Format Rupiah: "Rp20.000", "-Rp1.500". Dibulatkan ke rupiah penuh. */
export function formatRupiah(value: DecimalInput | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'Rp0'
  const d = Decimal.from(value).round(0)
  const s = d.toString()
  const neg = s.startsWith('-')
  const digits = neg ? s.slice(1) : s
  return `${neg ? '-' : ''}Rp${groupThousands(digits)}`
}

/** Format angka gaya Indonesia: 148,5 / 1.250,25 (maks 3 desimal). */
export function formatNumber(value: DecimalInput | null | undefined, maxFraction = 3): string {
  if (value === null || value === undefined || value === '') return '0'
  const d = Decimal.from(value).round(maxFraction)
  const [int, frac] = d.toString().split('.')
  const neg = int.startsWith('-')
  const absInt = neg ? int.slice(1) : int
  return `${neg ? '-' : ''}${groupThousands(absInt)}${frac ? `,${frac}` : ''}`
}

export const UNIT_LABEL = {
  ML: 'ml',
  PCS: 'pcs',
  GRAM: 'gram',
  UNIT: 'unit',
  BOTOL: 'botol',
} as const

export type StockUnit = keyof typeof UNIT_LABEL

/** Satuan yang boleh memakai angka desimal. */
export const DECIMAL_UNITS: readonly StockUnit[] = ['ML', 'GRAM']

export function formatQty(value: DecimalInput | null | undefined, unit: StockUnit): string {
  return `${formatNumber(value)} ${UNIT_LABEL[unit]}`
}

/** Tanggal/jam dalam WITA, mis. "Sabtu, 21 Nov 2026". */
export function formatDateWita(date: Date | string, pattern = 'EEEE, d MMM yyyy'): string {
  const d = new TZDate(new Date(date).getTime(), BUSINESS_TZ)
  return fmt(d, pattern, { locale: localeId })
}

export function formatTimeWita(date: Date | string, withSeconds = false): string {
  return formatDateWita(date, withSeconds ? 'HH:mm:ss' : 'HH:mm')
}

/** Tanggal bisnis (YYYY-MM-DD) menurut WITA — sama dengan kolom `business_date` di DB. */
export function businessDate(date: Date = new Date()): string {
  return formatDateWita(date, 'yyyy-MM-dd')
}

export function greetingWita(date: Date = new Date()): string {
  const h = Number(formatDateWita(date, 'H'))
  if (h < 11) return 'Selamat Pagi'
  if (h < 15) return 'Selamat Siang'
  if (h < 18) return 'Selamat Sore'
  return 'Selamat Malam'
}

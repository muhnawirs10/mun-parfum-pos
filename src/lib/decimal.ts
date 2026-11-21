/**
 * Aritmetika desimal presisi tetap berbasis BigInt.
 *
 * Nilai uang dan volume stok TIDAK boleh dihitung dengan floating-point
 * (0.1 + 0.2 !== 0.3). Semua nilai disimpan sebagai bilangan bulat yang
 * diskalakan 10^SCALE. Aturan pembulatan meniru PostgreSQL `round()` untuk
 * numeric: half away from zero.
 *
 * Catatan: perhitungan yang sah (authoritative) selalu dilakukan di database
 * (RPC `create_sale`). Modul ini dipakai untuk pratinjau di UI dan harus
 * menghasilkan angka yang sama persis.
 */

const SCALE = 6
const FACTOR = 10n ** BigInt(SCALE)

export type DecimalInput = Decimal | string | number | bigint

export class Decimal {
  /** nilai × 10^SCALE */
  readonly raw: bigint

  private constructor(raw: bigint) {
    this.raw = raw
  }

  static fromRaw(raw: bigint): Decimal {
    return new Decimal(raw)
  }

  static from(value: DecimalInput): Decimal {
    if (value instanceof Decimal) return value
    if (typeof value === 'bigint') return new Decimal(value * FACTOR)
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new RangeError(`Angka tidak valid: ${value}`)
      // toString() dari number memberi representasi desimal terpendek yang tepat
      // (mis. 148.5 → "148.5"), lalu di-parse sebagai string.
      return Decimal.parse(numberToPlainString(value))
    }
    return Decimal.parse(value)
  }

  static parse(input: string): Decimal {
    const s = input.trim().replace(',', '.')
    const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(s)
    if (!m || (m[2] === '' && (m[3] ?? '') === '')) {
      throw new RangeError(`Format angka tidak valid: "${input}"`)
    }
    const sign = m[1] === '-' ? -1n : 1n
    const intPart = m[2] || '0'
    let frac = m[3] ?? ''
    let roundUp = false
    if (frac.length > SCALE) {
      roundUp = Number(frac[SCALE]) >= 5
      frac = frac.slice(0, SCALE)
    }
    frac = frac.padEnd(SCALE, '0')
    let raw = BigInt(intPart) * FACTOR + BigInt(frac || '0')
    if (roundUp) raw += 1n
    return new Decimal(sign * raw)
  }

  static zero = new Decimal(0n)

  add(o: DecimalInput) {
    return new Decimal(this.raw + Decimal.from(o).raw)
  }
  sub(o: DecimalInput) {
    return new Decimal(this.raw - Decimal.from(o).raw)
  }
  mul(o: DecimalInput) {
    // hasil skala 2×SCALE → turunkan ke SCALE dengan pembulatan half-away-from-zero
    return new Decimal(divRound(this.raw * Decimal.from(o).raw, FACTOR))
  }
  div(o: DecimalInput) {
    const d = Decimal.from(o).raw
    if (d === 0n) throw new RangeError('Pembagian dengan nol')
    return new Decimal(divRound(this.raw * FACTOR, d))
  }
  /** Bulatkan ke `places` digit desimal (half away from zero, sama seperti PostgreSQL). */
  round(places = 0) {
    if (places >= SCALE) return this
    const unit = 10n ** BigInt(SCALE - places)
    return new Decimal(divRound(this.raw, unit) * unit)
  }
  neg() {
    return new Decimal(-this.raw)
  }
  cmp(o: DecimalInput): -1 | 0 | 1 {
    const r = Decimal.from(o).raw
    return this.raw < r ? -1 : this.raw > r ? 1 : 0
  }
  eq(o: DecimalInput) {
    return this.cmp(o) === 0
  }
  gt(o: DecimalInput) {
    return this.cmp(o) > 0
  }
  gte(o: DecimalInput) {
    return this.cmp(o) >= 0
  }
  lt(o: DecimalInput) {
    return this.cmp(o) < 0
  }
  lte(o: DecimalInput) {
    return this.cmp(o) <= 0
  }
  isZero() {
    return this.raw === 0n
  }
  isNegative() {
    return this.raw < 0n
  }
  isInteger() {
    return this.raw % FACTOR === 0n
  }
  static max(a: DecimalInput, b: DecimalInput) {
    const x = Decimal.from(a)
    const y = Decimal.from(b)
    return x.gte(y) ? x : y
  }
  static min(a: DecimalInput, b: DecimalInput) {
    const x = Decimal.from(a)
    const y = Decimal.from(b)
    return x.lte(y) ? x : y
  }
  static sum(values: DecimalInput[]) {
    return values.reduce<Decimal>((acc, v) => acc.add(v), Decimal.zero)
  }

  /** Representasi string tanpa nol berlebih, mis. "297", "148.5". */
  toString() {
    const neg = this.raw < 0n
    const abs = neg ? -this.raw : this.raw
    const int = abs / FACTOR
    const frac = (abs % FACTOR).toString().padStart(SCALE, '0').replace(/0+$/, '')
    return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`
  }

  /** Untuk dikirim ke API (PostgREST menerima string numeric). */
  toJSON() {
    return this.toString()
  }

  /** Hanya untuk tampilan / chart. Jangan dipakai untuk perhitungan. */
  toNumber() {
    return Number(this.toString())
  }
}

function divRound(n: bigint, d: bigint): bigint {
  const q = n / d
  const r = n % d
  if (r === 0n) return q
  const neg = n < 0n !== d < 0n
  const twiceR = (r < 0n ? -r : r) * 2n
  const absD = d < 0n ? -d : d
  if (twiceR >= absD) return neg ? q - 1n : q + 1n
  return q
}

function numberToPlainString(n: number): string {
  const s = n.toString()
  if (!/e/i.test(s)) return s
  // ubah notasi eksponen menjadi desimal biasa
  return n.toFixed(SCALE + 2)
}

export const dec = Decimal.from

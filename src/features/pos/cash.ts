import { Decimal } from '@/lib/decimal'

/** Nominal uang cepat: uang pas lalu pembulatan ke pecahan umum di atas total. */
export function quickCashAmounts(total: Decimal): Decimal[] {
  const out: Decimal[] = [total]
  for (const step of [5000, 10000, 20000, 50000, 100000]) {
    const up = total.div(step).round(0)
    let v = up.mul(step)
    if (v.lt(total)) v = v.add(step)
    if (!out.some((x) => x.eq(v))) out.push(v)
  }
  return out.sort((a, b) => a.cmp(b)).slice(0, 5)
}

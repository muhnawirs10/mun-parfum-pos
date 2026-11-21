import { Decimal } from '@/lib/decimal'
import { quickCashAmounts } from './cash'

it('nominal cepat: uang pas + pecahan di atas total', () => {
  expect(quickCashAmounts(Decimal.from(17000)).map((d) => d.toString())).toEqual(['17000', '20000', '50000', '100000'])
  expect(quickCashAmounts(Decimal.from(20000)).map((d) => d.toString())).toEqual(['20000', '50000', '100000'])
  expect(quickCashAmounts(Decimal.from(123500)).map((d) => d.toString())).toEqual(['123500', '125000', '130000', '140000', '150000'])
})

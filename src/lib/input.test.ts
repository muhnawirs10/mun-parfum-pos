import { parseMoneyInput, parseQtyInput } from './input'

describe('parseMoneyInput', () => {
  it.each([
    ['2000', '2000'],
    ['2.000', '2000'],
    ['1.014', '1014'],
    ['1.250,50', '1250.5'],
    ['Rp 20.000', '20000'],
    ['0', '0'],
  ])('%s → %s', (input, out) => expect(parseMoneyInput(input)?.toString()).toBe(out))
  it.each(['', 'abc', '-5', '2.00', '1,234', '1.5,5', '12,345'])('menolak "%s"', (input) => expect(parseMoneyInput(input)).toBeNull())
})

describe('parseQtyInput', () => {
  it.each([
    ['10', '10'],
    ['148,5', '148.5'],
    ['2.5', '2.5'],
    ['0,125', '0.125'],
  ])('%s → %s', (input, out) => expect(parseQtyInput(input)?.toString()).toBe(out))
  it.each(['', '-1', '1.2345', '1.000.000', 'x'])('menolak "%s"', (input) => expect(parseQtyInput(input)).toBeNull())
})

import { Decimal, dec } from './decimal'

describe('Decimal', () => {
  it('tidak terkena galat floating point', () => {
    expect(dec('0.1').add('0.2').toString()).toBe('0.3')
    expect(0.1 + 0.2).not.toBe(0.3)
  })

  it('parse string, number, dan koma desimal', () => {
    expect(dec('148,5').toString()).toBe('148.5')
    expect(dec(148.5).toString()).toBe('148.5')
    expect(dec('-12.250').toString()).toBe('-12.25')
    expect(dec(10n).toString()).toBe('10')
    expect(() => dec('abc')).toThrow()
    expect(() => dec('')).toThrow()
  })

  it('perkalian dan pembulatan half-away-from-zero seperti PostgreSQL', () => {
    expect(dec('1014').mul('10').toString()).toBe('10140')
    expect(dec('2.5').round(0).toString()).toBe('3')
    expect(dec('-2.5').round(0).toString()).toBe('-3')
    expect(dec('2.49').round(0).toString()).toBe('2')
    expect(dec('1.005').round(2).toString()).toBe('1.01')
    expect(dec('3000').mul('0.333').round(0).toString()).toBe('999')
  })

  it('perbandingan dan stok desimal', () => {
    expect(dec('307').sub('10').toString()).toBe('297')
    expect(dec('148.5').sub('0.5').toString()).toBe('148')
    expect(dec('5').gt('4.999')).toBe(true)
    expect(Decimal.sum(['1.1', '2.2', '3.3']).toString()).toBe('6.6')
    expect(dec('10').div('3').round(3).toString()).toBe('3.333')
  })
})

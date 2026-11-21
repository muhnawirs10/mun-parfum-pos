import { Badge } from '@/components/ui/badge'
import { Decimal } from '@/lib/decimal'
import { formatQty, type StockUnit } from '@/lib/format'

export type StockLevel = 'empty' | 'low' | 'ok'

export function stockLevel(current: number | string, min: number | string): StockLevel {
  const c = Decimal.from(current)
  if (c.lte(0)) return 'empty'
  if (c.lte(min)) return 'low'
  return 'ok'
}

export function StockBadge({ current, min, unit }: { current: number | string; min: number | string; unit: StockUnit }) {
  const level = stockLevel(current, min)
  const variant = level === 'empty' ? 'danger' : level === 'low' ? 'default' : 'success'
  const prefix = level === 'empty' ? 'Habis · ' : level === 'low' ? 'Menipis · ' : ''
  return (
    <Badge variant={variant} data-level={level}>
      {prefix}Stok: {formatQty(current, unit)}
    </Badge>
  )
}

import { createPortal } from 'react-dom'
import { PAYMENT_LABEL } from '@/features/dashboard/api'
import { formatDateWita, formatNumber, formatRupiah, UNIT_LABEL } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { TransactionDetail } from './api'

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-2', bold && 'text-[1.1em] font-bold')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

/**
 * Struk penjualan. Lebar mengikuti kertas 58 mm saat dicetak (lihat index.css).
 * Data selalu berasal dari database (get_transaction_detail), bukan dari keranjang.
 */
export function Receipt({
  t,
  reprint = false,
  print = false,
  className,
}: {
  t: TransactionDetail
  reprint?: boolean
  print?: boolean
  className?: string
}) {
  const payment = t.payments[0]
  return (
    <div
      className={cn('mx-auto w-full max-w-[300px] bg-white p-4 font-mono text-xs leading-relaxed text-black', print && 'receipt-print', className)}
      data-testid={print ? 'receipt-print' : 'receipt'}
    >
      <div className="text-center">
        <p className="text-sm font-bold uppercase">{t.outlet.name}</p>
        {t.outlet.address && <p>{t.outlet.address}</p>}
        {t.outlet.phone && <p>Telp. {t.outlet.phone}</p>}
      </div>
      <hr className="my-2 border-dashed border-black" />
      <p>{t.number}</p>
      <p>{formatDateWita(t.created_at, 'dd/MM/yyyy HH:mm')} WITA</p>
      <p>Kasir: {t.cashier_name ?? '-'}</p>
      {t.customer_name && <p>Pelanggan: {t.customer_name}</p>}
      {reprint && <p className="font-bold">*** CETAK ULANG ***</p>}
      {t.status === 'void' && <p className="text-center text-sm font-bold">*** DIBATALKAN ***</p>}
      <hr className="my-2 border-dashed border-black" />
      <div className="space-y-1.5">
        {t.items.map((i) => (
          <div key={i.id}>
            <p className="font-semibold">{i.product_name}</p>
            <Row label={`${formatNumber(i.quantity)} ${UNIT_LABEL[i.unit]} x ${formatRupiah(i.unit_price)}`} value={formatRupiah(i.subtotal)} />
            {i.discount_amount > 0 && <Row label="  Diskon" value={`-${formatRupiah(i.discount_amount)}`} />}
          </div>
        ))}
      </div>
      <hr className="my-2 border-dashed border-black" />
      <Row label="Subtotal" value={formatRupiah(t.subtotal)} />
      {t.discount_amount > 0 && <Row label="Diskon" value={`-${formatRupiah(t.discount_amount)}`} />}
      <Row label="TOTAL" value={formatRupiah(t.total)} bold />
      <Row label={PAYMENT_LABEL[t.payment_method]} value={formatRupiah(t.amount_paid)} />
      {t.payment_method === 'cash' && <Row label="Kembali" value={formatRupiah(t.change_amount)} />}
      {payment?.reference && <p>Ref: {payment.reference}</p>}
      {t.note && <p className="mt-1">Catatan: {t.note}</p>}
      <hr className="my-2 border-dashed border-black" />
      <p className="text-center">{t.receipt_footer}</p>
    </div>
  )
}

/** Salinan struk khusus cetak, di-portal ke <body> dan hanya tampil saat mencetak. */
export function PrintableReceipt({ t, reprint = false }: { t: TransactionDetail; reprint?: boolean }) {
  return createPortal(
    <div className="print-root" aria-hidden="true">
      <Receipt t={t} reprint={reprint} print />
    </div>,
    document.body,
  )
}

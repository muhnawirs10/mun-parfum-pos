import { CheckCircle2, Loader2, Plus, Printer, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { toUserMessage } from '@/lib/errors'
import { formatRupiah } from '@/lib/format'
import { useTransactionDetail } from './queries'
import { printReceipt } from './print'
import { PrintableReceipt, Receipt } from './receipt'

/** Ditampilkan setelah penjualan berhasil disimpan di database. */
export function SaleSuccessDialog({ transactionId, onNewSale }: { transactionId: string | null; onNewSale: () => void }) {
  const detail = useTransactionDetail(transactionId)
  const t = detail.data
  return (
    <Dialog open={!!transactionId} onOpenChange={(o) => !o && onNewSale()}>
      <DialogContent title="Transaksi berhasil" className="max-w-md">
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-3 rounded-2xl bg-success/10 p-4 text-success">
            <CheckCircle2 className="h-8 w-8 shrink-0" />
            <div>
              <p className="font-semibold">Tersimpan di server{t ? ` · ${t.number}` : ''}</p>
              {t && t.payment_method === 'cash' && (
                <p className="text-2xl font-bold text-foreground" data-testid="success-change">
                  Kembalian {formatRupiah(t.change_amount)}
                </p>
              )}
            </div>
          </div>
          {detail.isPending ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : detail.isError ? (
            <div className="space-y-2 text-center text-sm">
              <p className="text-destructive">Struk gagal dimuat: {toUserMessage(detail.error)}</p>
              <Button variant="outline" size="sm" onClick={() => void detail.refetch()}>
                <RefreshCw /> Muat ulang struk
              </Button>
            </div>
          ) : (
            <div className="max-h-[45dvh] overflow-y-auto rounded-xl border">
              <Receipt t={t!} />
              <PrintableReceipt t={t!} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={printReceipt} disabled={!t}>
              <Printer /> Cetak struk
            </Button>
            <Button size="lg" onClick={onNewSale}>
              <Plus /> Transaksi baru
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

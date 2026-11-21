import { useEffect, useState } from 'react'
import { Ban, Loader2, Printer, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { toUserMessage } from '@/lib/errors'
import { formatDateWita, formatRupiah } from '@/lib/format'
import { useTransactionDetail, useVoidTransaction } from './queries'
import { printReceipt } from './print'
import { PrintableReceipt, Receipt } from './receipt'

export function TransactionDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const detail = useTransactionDetail(id)
  const voidTx = useVoidTransaction()
  const online = useOnlineStatus()
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string>()
  const t = detail.data

  useEffect(() => {
    setVoiding(false)
    setReason('')
    setError(undefined)
  }, [id])

  async function confirmVoid() {
    if (!reason.trim()) return setError('Alasan pembatalan wajib diisi')
    if (!online) return setError('Tidak ada koneksi internet. Transaksi belum dibatalkan.')
    setError(undefined)
    try {
      await voidTx.mutateAsync({ id: id!, reason: reason.trim() })
      toast.success(`Transaksi ${t?.number} dibatalkan. Stok dikembalikan.`)
      setVoiding(false)
    } catch (e) {
      setError(toUserMessage(e))
    }
  }

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && !voidTx.isPending && onClose()}>
      <DialogContent title={t?.number ?? 'Detail transaksi'} className="max-w-lg">
        <div className="space-y-4 p-5">
          {detail.isPending ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : detail.isError ? (
            <div className="space-y-2 text-center">
              <p className="text-destructive">{toUserMessage(detail.error)}</p>
              <Button variant="outline" size="sm" onClick={() => void detail.refetch()}>
                <RefreshCw /> Coba lagi
              </Button>
            </div>
          ) : (
            t && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {t.status === 'void' ? <Badge variant="danger">Dibatalkan</Badge> : <Badge variant="success">Selesai</Badge>}
                  {t.gross_profit !== null && <Badge variant="default">Laba kotor {formatRupiah(t.gross_profit)}</Badge>}
                </div>
                {t.status === 'void' && (
                  <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                    Dibatalkan oleh {t.voided_by_name ?? '-'} · {formatDateWita(t.voided_at!, 'd MMM yyyy, HH:mm')}
                    <br />
                    Alasan: {t.void_reason}
                  </p>
                )}
                <div className="max-h-[45dvh] overflow-y-auto rounded-xl border">
                  <Receipt t={t} reprint />
                </div>
                <PrintableReceipt t={t} reprint />

                {voiding ? (
                  <div className="space-y-3 rounded-xl border border-destructive/40 p-4">
                    <p className="text-sm">Stok semua item akan dikembalikan. Transaksi tetap tersimpan dengan status batal.</p>
                    <Field id="void-reason" label="Alasan pembatalan" error={error}>
                      <Textarea id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="contoh: salah input jumlah" />
                    </Field>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setVoiding(false)} disabled={voidTx.isPending}>
                        Kembali
                      </Button>
                      <Button variant="destructive" onClick={() => void confirmVoid()} disabled={voidTx.isPending}>
                        {voidTx.isPending ? <Loader2 className="animate-spin" /> : <Ban />} Batalkan transaksi
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {t.can_void && (
                      <Button variant="destructive-ghost" onClick={() => setVoiding(true)}>
                        <Ban /> Batalkan
                      </Button>
                    )}
                    <Button className="flex-1" size="lg" onClick={printReceipt}>
                      <Printer /> Cetak ulang struk
                    </Button>
                  </div>
                )}
              </>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

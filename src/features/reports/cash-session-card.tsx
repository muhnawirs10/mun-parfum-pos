import { useState } from 'react'
import { Loader2, LockKeyhole, LockKeyholeOpen, RefreshCw, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { PAYMENT_LABEL } from '@/features/dashboard/api'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { toUserMessage } from '@/lib/errors'
import { formatDateWita, formatRupiah } from '@/lib/format'
import { parseMoneyInput } from '@/lib/input'
import { cn } from '@/lib/utils'
import { useCloseCashSession, useMyCashSession, useOpenCashSession, type CashSession } from './api'

function Line({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'plus' | 'minus' }) {
  return (
    <div className={cn('flex justify-between gap-3 py-1', strong && 'text-base font-bold')}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('tabular-nums', tone === 'plus' && 'text-success', tone === 'minus' && 'text-destructive')}>{value}</span>
    </div>
  )
}

/** Buka kas (kas awal) dan closing (hitung kas fisik → selisih). */
export function CashSessionCard({ className }: { className?: string }) {
  const online = useOnlineStatus()
  const session = useMyCashSession()
  const open = useOpenCashSession()
  const close = useCloseCashSession()
  const [opening, setOpening] = useState('')
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string>()
  const [closed, setClosed] = useState<CashSession | null>(null)
  const s = session.data

  async function onOpen() {
    const v = opening.trim() === '' ? '0' : parseMoneyInput(opening)?.toString()
    if (v === undefined) return setError('Kas awal tidak valid (contoh: 100.000)')
    if (!online) return setError('Tidak ada koneksi internet.')
    setError(undefined)
    try {
      await open.mutateAsync(v)
      setClosed(null)
      setOpening('')
      toast.success('Kas dibuka')
    } catch (e) {
      setError(toUserMessage(e))
    }
  }

  async function onClose() {
    const v = parseMoneyInput(counted)
    if (!v) return setError('Masukkan jumlah kas fisik hasil hitung (contoh: 120.000)')
    if (!online) return setError('Tidak ada koneksi internet. Closing belum disimpan.')
    setError(undefined)
    try {
      const r = await close.mutateAsync({ sessionId: s!.id, countedCash: v.toString(), note: note.trim() || null })
      setClosed(r)
      setCounted('')
      setNote('')
      toast.success('Closing kas tersimpan')
    } catch (e) {
      setError(toUserMessage(e))
    }
  }

  return (
    <Card className={className} data-testid="cash-session">
      <CardHeader>
        <CardTitle>
          <Wallet className="h-5 w-5" /> Sesi Kas Saya
        </CardTitle>
        {s && <span className="text-sm text-muted-foreground">Dibuka {formatDateWita(s.opened_at, 'd MMM, HH:mm')}</span>}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {session.isPending ? (
          <Skeleton className="h-24" />
        ) : session.isError ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-destructive">{toUserMessage(session.error)}</p>
            <Button size="sm" variant="outline" onClick={() => void session.refetch()}>
              <RefreshCw /> Coba lagi
            </Button>
          </div>
        ) : !s ? (
          <>
            {closed && (
              <div className="rounded-xl bg-muted p-3" data-testid="closing-result">
                <p className="mb-1 font-semibold">Closing terakhir</p>
                <Line label="Kas seharusnya" value={formatRupiah(closed.expected_cash)} />
                <Line label="Kas fisik" value={formatRupiah(closed.counted_cash)} />
                <Line
                  label="Selisih"
                  value={formatRupiah(closed.cash_difference)}
                  strong
                  tone={closed.cash_difference === 0 ? undefined : (closed.cash_difference ?? 0) > 0 ? 'plus' : 'minus'}
                />
              </div>
            )}
            <p className="text-muted-foreground">Kas belum dibuka. Isi uang modal di laci sebelum mulai berjualan agar closing akurat.</p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field id="opening-cash" label="Kas awal (Rp)" error={error}>
                  <Input id="opening-cash" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="100.000" />
                </Field>
              </div>
              <Button onClick={() => void onOpen()} disabled={open.isPending || !online} className={error ? 'mb-7' : ''}>
                {open.isPending ? <Loader2 className="animate-spin" /> : <LockKeyholeOpen />} Buka kas
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-xl bg-muted p-3">
              <Line label="Kas awal" value={formatRupiah(s.opening_cash)} />
              <Line label={`Penjualan (${s.transaction_count} transaksi)`} value={formatRupiah(s.sales_total)} />
              {s.by_payment_method.map((m) => (
                <Line key={m.method} label={`  · ${PAYMENT_LABEL[m.method]}`} value={formatRupiah(m.amount)} />
              ))}
              <Line label="Kas seharusnya di laci" value={formatRupiah(s.expected_cash)} strong />
            </div>
            {s.can_close ? (
              <>
                <Field id="counted-cash" label="Kas fisik hasil hitung (Rp)" error={error}>
                  <Input id="counted-cash" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="contoh: 120.000" />
                </Field>
                <Input aria-label="Catatan closing" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (opsional)" />
                <Button className="w-full" variant="dark" size="lg" onClick={() => void onClose()} disabled={close.isPending || !online}>
                  {close.isPending ? <Loader2 className="animate-spin" /> : <LockKeyhole />} Tutup kas (closing)
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground">Closing kas dilakukan oleh admin/pemilik.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

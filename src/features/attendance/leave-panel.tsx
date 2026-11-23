import { useState } from 'react'
import { Check, FileText, ImageIcon, Paperclip, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/auth-context'
import { toUserMessage } from '@/lib/errors'
import { addDays, monthRange } from '@/lib/periods'
import { businessDate, formatDateWita } from '@/lib/format'
import { useCancelLeave, useCreateLeave, useLeaveRequests, useRecap, useReviewLeave, useSignedPhoto, type LeaveRequest } from './api'
import { shrinkImage } from './camera'
import { LEAVE_TYPE_LABEL, type LeaveType } from './lib'

const STATUS: Record<LeaveRequest['status'], { label: string; variant: 'default' | 'success' | 'danger' | 'muted' }> = {
  pending: { label: 'Menunggu', variant: 'default' },
  approved: { label: 'Disetujui', variant: 'success' },
  rejected: { label: 'Ditolak', variant: 'danger' },
  cancelled: { label: 'Dibatalkan', variant: 'muted' },
}

const fmt = (d: string) => formatDateWita(d + 'T12:00:00+08:00', 'd MMM yyyy')

export function LeavePanel({ manager }: { manager: boolean }) {
  const today = businessDate()
  const [month, setMonth] = useState(today.slice(0, 7))
  const period = monthRange(month)
  const q = useLeaveRequests(period)
  const review = useReviewLeave()
  const cancel = useCancelLeave()
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex items-center gap-3">
          <span className="text-sm font-medium">Bulan</span>
          <input type="month" aria-label="Bulan izin" className="h-11 rounded-xl border bg-card px-3" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </label>
        <Button onClick={() => setOpen(true)}>
          <Plus /> {manager ? 'Ajukan / tetapkan izin' : 'Ajukan izin'}
        </Button>
      </div>
      {q.isPending ? (
        <Skeleton className="h-32" />
      ) : q.isError ? (
        <p className="text-destructive">{toUserMessage(q.error)}</p>
      ) : q.data.length === 0 ? (
        <Card>
          <EmptyState icon={FileText} title="Belum ada pengajuan" description="Ajukan izin sakit, izin, atau cuti di sini. Tidak absen tanpa izin disetujui dihitung mangkir." />
        </Card>
      ) : (
        <Card className="divide-y overflow-hidden">
          {q.data.map((l) => (
            <div key={l.id} className="space-y-2 p-4" data-testid="leave-row">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="dark">{LEAVE_TYPE_LABEL[l.leave_type]}</Badge>
                <Badge variant={STATUS[l.status].variant}>{STATUS[l.status].label}</Badge>
                {manager && <span className="font-semibold">{l.full_name}</span>}
              </div>
              <p className="text-sm font-medium">
                {fmt(l.date_from)}
                {l.date_to !== l.date_from && ` – ${fmt(l.date_to)}`}
              </p>
              <p className="text-sm">{l.reason}</p>
              {l.attachment_path && <Attachment path={l.attachment_path} />}
              {l.review_note && <p className="text-xs text-muted-foreground">Catatan {l.reviewed_by_name}: {l.review_note}</p>}
              <div className="flex flex-wrap gap-2">
                {manager && l.status === 'pending' && !l.is_self && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => review.mutate({ id: l.id, approve: true }, { onSuccess: () => toast.success('Izin disetujui'), onError: (e) => toast.error(toUserMessage(e)) })}
                      disabled={review.isPending}
                    >
                      <Check /> Setujui
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const note = window.prompt('Alasan penolakan (opsional)') ?? undefined
                        review.mutate({ id: l.id, approve: false, note }, { onSuccess: () => toast.success('Izin ditolak'), onError: (e) => toast.error(toUserMessage(e)) })
                      }}
                      disabled={review.isPending}
                    >
                      <X /> Tolak
                    </Button>
                  </>
                )}
                {l.is_self && l.status === 'pending' && (
                  <Button size="sm" variant="destructive-ghost" onClick={() => cancel.mutate(l.id, { onError: (e) => toast.error(toUserMessage(e)) })} disabled={cancel.isPending}>
                    Batalkan pengajuan
                  </Button>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
      <LeaveDialog open={open} onOpenChange={setOpen} manager={manager} />
    </div>
  )
}

function Attachment({ path }: { path: string }) {
  const [show, setShow] = useState(false)
  const url = useSignedPhoto(show ? path : null)
  return show ? (
    url.data ? (
      <a href={url.data} target="_blank" rel="noreferrer">
        <img src={url.data} alt="Lampiran surat" className="max-h-60 rounded-xl border" />
      </a>
    ) : (
      <Skeleton className="h-24 w-40" />
    )
  ) : (
    <Button size="sm" variant="ghost" onClick={() => setShow(true)}>
      <ImageIcon /> Lihat lampiran
    </Button>
  )
}

function LeaveDialog({ open, onOpenChange, manager }: { open: boolean; onOpenChange: (o: boolean) => void; manager: boolean }) {
  const today = businessDate()
  const { session } = useAuth()
  const [type, setType] = useState<LeaveType>('sakit')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [reason, setReason] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [userId, setUserId] = useState<string>('')
  const create = useCreateLeave()
  // daftar karyawan outlet (dari rekap 1 hari) untuk pengelola
  const staff = useRecap({ from: today, to: today }, null, manager && open)
  const forOther = manager && userId && userId !== session?.user.id
  const types: LeaveType[] = forOther ? ['sakit', 'izin', 'cuti', 'libur'] : ['sakit', 'izin', 'cuti']

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (reason.trim().length < 3) return toast.error('Alasan wajib diisi (min. 3 huruf).')
    if (to < from) return toast.error('Tanggal selesai tidak boleh sebelum tanggal mulai.')
    try {
      const attachment = file ? await shrinkImage(file) : null
      await create.mutateAsync({ type, from, to, reason, attachment, userId: forOther ? userId : null })
      toast.success(forOther ? 'Izin ditetapkan' : 'Pengajuan izin terkirim')
      setReason('')
      setFile(null)
      onOpenChange(false)
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={manager ? 'Ajukan / tetapkan izin' : 'Ajukan izin'} description="Tidak absen tanpa izin yang disetujui dihitung mangkir." className="max-w-md">
        <form onSubmit={submit} className="space-y-4 p-5">
          {manager && (
            <Field id="leave-user" label="Karyawan">
              <NativeSelect id="leave-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Saya sendiri</option>
                {staff.data?.employees
                  .filter((s) => s.user_id !== session?.user.id)
                  .map((s) => (
                    <option key={s.user_id} value={s.user_id}>
                      {s.full_name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
          )}
          <Field id="leave-type" label="Jenis" hint={forOther ? 'Izin yang ditetapkan pengelola langsung disetujui.' : 'Libur ditetapkan oleh pemilik.'}>
            <NativeSelect id="leave-type" value={type} onChange={(e) => setType(e.target.value as LeaveType)}>
              {types.map((t) => (
                <option key={t} value={t}>
                  {LEAVE_TYPE_LABEL[t]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="leave-from" label="Dari tanggal">
              <Input id="leave-from" type="date" value={from} min={addDays(today, -30)} onChange={(e) => e.target.value && (setFrom(e.target.value), to < e.target.value && setTo(e.target.value))} />
            </Field>
            <Field id="leave-to" label="Sampai tanggal">
              <Input id="leave-to" type="date" value={to} min={from} max={addDays(from, 30)} onChange={(e) => e.target.value && setTo(e.target.value)} />
            </Field>
          </div>
          <Field id="leave-reason" label="Alasan">
            <Textarea id="leave-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Contoh: demam, ada surat dokter" />
          </Field>
          <Field id="leave-file" label="Foto surat (opsional)">
            <label className="flex h-11 cursor-pointer items-center gap-2 rounded-xl border bg-card px-3 text-sm">
              <Paperclip className="h-4 w-4" />
              <span className="truncate">{file ? file.name : 'Pilih / foto surat dokter'}</span>
              <input id="leave-file" type="file" accept="image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </Field>
          <Button type="submit" className="w-full" size="lg" disabled={create.isPending}>
            {forOther ? 'Tetapkan' : 'Kirim pengajuan'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

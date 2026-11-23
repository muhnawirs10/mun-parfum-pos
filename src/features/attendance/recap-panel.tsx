import { useMemo, useState } from 'react'
import { FileDown, FileSpreadsheet, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/features/auth/auth-context'
import { PeriodInputs, PeriodTabs, type PeriodState } from '@/features/reports/period-picker'
import { toUserMessage } from '@/lib/errors'
import { businessDate, formatDateWita, formatTimeWita } from '@/lib/format'
import { periodFor, periodLabel } from '@/lib/periods'
import { useAttempts, useRecap, useSignedPhoto, type RecapDay } from './api'
import { recapTables } from './recap-export'
import { DAY_STATUS_LABEL, formatMinutes, HIDDEN_DAY } from './lib'

const VARIANT: Record<string, 'success' | 'danger' | 'default' | 'muted' | 'dark' | 'outline'> = {
  hadir: 'success',
  terlambat: 'default',
  mangkir: 'danger',
  sakit: 'dark',
  izin: 'dark',
  cuti: 'dark',
  libur: 'muted',
  tutup: 'muted',
  belum_absen: 'outline',
  akan_datang: 'outline',
}

export function DayStatusBadge({ status }: { status: string }) {
  return <Badge variant={VARIANT[status] ?? 'outline'}>{DAY_STATUS_LABEL[status] ?? status}</Badge>
}

const REASON_LABEL: Record<string, string> = {
  TOO_FAR: 'Di luar radius',
  LOW_ACCURACY: 'GPS kurang akurat',
  INVALID_QR: 'QR tidak valid',
  NO_GPS: 'GPS mati',
  NO_PHOTO: 'Tanpa foto',
  DEVICE_PENDING: 'HP belum disetujui',
  DEVICE_REVOKED: 'HP dicabut',
  ALREADY_IN: 'Sudah absen masuk',
  ALREADY_OUT: 'Sudah absen pulang',
  NOT_IN: 'Belum absen masuk',
  OTHER_OUTLET: 'Outlet berbeda',
  LOCATION_NOT_SET: 'Lokasi belum diatur',
}

export function RecapPanel() {
  const today = businessDate()
  const { activeOutlet, profile } = useAuth()
  const [state, setState] = useState<PeriodState>({ kind: 'monthly', anchor: today, month: today.slice(0, 7), range: { from: today.slice(0, 8) + '01', to: today } })
  const period = useMemo(() => periodFor(state.kind, state), [state])
  const q = useRecap(period, null)
  const attempts = useAttempts(period)
  const [detail, setDetail] = useState<{ name: string; day: RecapDay } | null>(null)
  const [exporting, setExporting] = useState<null | 'pdf' | 'xlsx'>(null)

  async function exportAs(kind: 'pdf' | 'xlsx') {
    if (!q.data) return
    setExporting(kind)
    try {
      const { buildExcel, buildPdf, downloadBlob, fileName } = await import('@/features/reports/export')
      const meta = { title: 'Rekap Absensi', outletName: activeOutlet?.outlet_name ?? '', generatedBy: profile?.full_name ?? '' }
      const tables = recapTables(q.data)
      const blob = kind === 'pdf' ? await buildPdf(meta, q.data, tables) : await buildExcel(meta, q.data, tables)
      downloadBlob(blob, fileName('absensi', q.data, kind))
    } catch (e) {
      toast.error(toUserMessage(e))
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="space-y-4">
      <PeriodTabs value={state.kind} onChange={(kind) => setState((s) => ({ ...s, kind }))} kinds={['daily', 'monthly', 'range']} />
      <Card className="p-4">
        <PeriodInputs state={state} onChange={setState} max={today} />
      </Card>
      {q.isPending ? (
        <Skeleton className="h-48" />
      ) : q.isError ? (
        <p className="text-destructive">{toUserMessage(q.error)}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {periodLabel(period)} · jam masuk {q.data.work_start_time}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void exportAs('xlsx')} disabled={!!exporting}>
                <FileSpreadsheet /> Excel
              </Button>
              <Button size="sm" variant="outline" onClick={() => void exportAs('pdf')} disabled={!!exporting}>
                <FileDown /> PDF
              </Button>
            </div>
          </div>
          {q.data.employees.map((e) => (
            <Card key={e.user_id} className="p-4" data-testid="recap-employee">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-bold">{e.full_name}</p>
                <p className="text-xs text-muted-foreground">Jam kerja {formatMinutes(e.summary.worked_minutes)}</p>
              </div>
              <div className="mb-3 grid grid-cols-4 gap-2 text-center text-xs sm:grid-cols-7">
                {(
                  [
                    ['Hadir', e.summary.hadir],
                    ['Terlambat', e.summary.terlambat],
                    ['Sakit', e.summary.sakit],
                    ['Izin', e.summary.izin],
                    ['Cuti', e.summary.cuti],
                    ['Libur', e.summary.libur],
                    ['Mangkir', e.summary.mangkir],
                  ] as const
                ).map(([label, n]) => (
                  <div key={label} className={`rounded-xl p-2 ${label === 'Mangkir' && n ? 'bg-destructive/10 text-destructive' : 'bg-muted'}`}>
                    <p className="text-lg font-bold tabular-nums">{n}</p>
                    <p>{label}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {e.days
                  .filter((d) => !HIDDEN_DAY.has(d.status))
                  .map((d) => (
                    <button
                      key={d.date}
                      type="button"
                      title={`${d.date} · ${DAY_STATUS_LABEL[d.status]}`}
                      aria-label={`${e.full_name} ${d.date} ${DAY_STATUS_LABEL[d.status]}`}
                      onClick={() => setDetail({ name: e.full_name, day: d })}
                      className={`h-8 w-8 rounded-lg text-xs font-semibold tabular-nums ${dotClass(d.status)}`}
                    >
                      {Number(d.date.slice(8))}
                    </button>
                  ))}
              </div>
            </Card>
          ))}
        </>
      )}

      <Card className="p-4">
        <p className="mb-2 flex items-center gap-2 font-semibold">
          <ShieldAlert className="h-4 w-4" /> Percobaan absen yang ditolak
        </p>
        {attempts.isPending ? (
          <Skeleton className="h-16" />
        ) : !attempts.data?.length ? (
          <p className="text-sm text-muted-foreground">Tidak ada.</p>
        ) : (
          <ul className="divide-y text-sm" data-testid="attempts">
            {attempts.data.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="tabular-nums text-muted-foreground">{formatDateWita(a.created_at, 'd MMM HH:mm')}</span>
                <span className="font-medium">{a.full_name}</span>
                <Badge variant="danger">{REASON_LABEL[a.reason] ?? a.reason}</Badge>
                {a.distance_m != null && <span className="text-muted-foreground">{Math.round(a.distance_m)} m</span>}
                {a.accuracy_m != null && <span className="text-muted-foreground">±{Math.round(a.accuracy_m)} m</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        {detail && (
          <DialogContent title={detail.name} description={formatDateWita(detail.day.date + 'T12:00:00+08:00')} className="max-w-md">
            <DayDetail day={detail.day} />
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}


function dotClass(status: string) {
  switch (status) {
    case 'hadir':
      return 'bg-success text-success-foreground'
    case 'terlambat':
      return 'bg-primary text-primary-foreground'
    case 'mangkir':
      return 'bg-destructive text-destructive-foreground'
    case 'sakit':
    case 'izin':
    case 'cuti':
      return 'bg-secondary text-secondary-foreground'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

function DayDetail({ day }: { day: RecapDay }) {
  return (
    <div className="space-y-4 p-5">
      <DayStatusBadge status={day.status} />
      <div className="grid grid-cols-2 gap-3">
        <PhotoBox label="Masuk" at={day.check_in_at} path={day.check_in_photo_path} distance={day.check_in_distance_m} />
        <PhotoBox label="Pulang" at={day.check_out_at} path={day.check_out_photo_path} distance={day.check_out_distance_m} />
      </div>
      {!!day.late_minutes && <p className="text-sm font-semibold text-destructive">Terlambat {day.late_minutes} menit</p>}
      {day.worked_minutes != null && <p className="text-sm">Lama kerja {formatMinutes(day.worked_minutes)}</p>}
    </div>
  )
}

function PhotoBox({ label, at, path, distance }: { label: string; at: string | null; path: string | null; distance: number | null }) {
  const url = useSignedPhoto(path)
  return (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums">{at ? formatTimeWita(at) : '—'}</p>
      {distance != null && <p className="text-xs text-muted-foreground">{distance} m dari toko</p>}
      {path && (url.data ? <img src={url.data} alt={`Selfie ${label.toLowerCase()}`} className="aspect-[3/4] w-full rounded-xl object-cover" /> : <Skeleton className="aspect-[3/4] w-full" />)}
    </div>
  )
}

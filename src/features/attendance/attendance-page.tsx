import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, CalendarCheck, Clock, FileText, LogIn, LogOut, MapPinOff, Settings2, Smartphone, Table2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/features/auth/auth-context'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { toUserMessage } from '@/lib/errors'
import { businessDate, formatDateWita, formatTimeWita } from '@/lib/format'
import { monthRange } from '@/lib/periods'
import { useMyAttendance, useRecap } from './api'
import { CheckFlowDialog } from './check-flow'
import { DevicesPanel } from './devices-panel'
import { LeavePanel } from './leave-panel'
import { getDeviceId, HIDDEN_DAY, parseQr, type QrPayload } from './lib'
import { DayStatusBadge, RecapPanel } from './recap-panel'
import { SettingsPanel } from './settings-panel'

export function AttendancePage() {
  const { can, activeOutlet, session, setActiveOutlet, outlets } = useAuth()
  const manager = can('attendance.manage')
  const [params, setParams] = useSearchParams()
  const [presetQr, setPresetQr] = useState<QrPayload | null>(null)
  const [flow, setFlow] = useState<{ open: boolean; kind: 'in' | 'out' }>({ open: false, kind: 'in' })
  const deviceId = useMemo(() => getDeviceId(), [])
  const outletId = activeOutlet?.outlet_id ?? null
  const me = useMyAttendance(outletId, deviceId)
  const online = useOnlineStatus()

  // QR dipindai dengan kamera bawaan HP → membuka /absen?o=…&t=…
  const fromQr = useMemo(() => parseQr(`/absen?${params.toString()}`), [params])
  useEffect(() => {
    if (!fromQr) return
    if (fromQr.outletId !== outletId && outlets.some((o) => o.outlet_id === fromQr.outletId)) setActiveOutlet(fromQr.outletId)
  }, [fromQr, outletId, outlets, setActiveOutlet])
  useEffect(() => {
    if (!fromQr || !me.data || fromQr.outletId !== outletId) return
    setPresetQr(fromQr)
    setFlow({ open: true, kind: me.data.record ? 'out' : 'in' })
    setParams({}, { replace: true })
  }, [fromQr, me.data, outletId, setParams])

  const rec = me.data?.record
  const done = !!rec?.check_out_at

  return (
    <>
      <PageHeader icon={CalendarCheck} title="Absensi" description={activeOutlet ? `${activeOutlet.outlet_name} · ${formatDateWita(new Date())}` : undefined} />

      <Card className="mb-4 p-5" data-testid="today-card">
        {me.isPending ? (
          <Skeleton className="h-28" />
        ) : me.isError ? (
          <p className="text-destructive">{toUserMessage(me.error)}</p>
        ) : (
          <div className="space-y-4">
            {!me.data.location_set && (
              <Notice icon={MapPinOff}>
                Lokasi toko belum diatur. {manager ? 'Atur di tab Pengaturan (berdiri di dalam toko).' : 'Minta pemilik mengatur lokasi toko.'}
              </Notice>
            )}
            {me.data.device_status === 'pending' && <Notice icon={Smartphone}>HP ini menunggu persetujuan pemilik. Anda belum bisa absen dari HP ini.</Notice>}
            {me.data.device_status === 'revoked' && <Notice icon={Smartphone}>HP ini tidak lagi diizinkan untuk absen. Hubungi pemilik.</Notice>}
            {!me.data.device_status && me.data.has_approved_device && (
              <Notice icon={Smartphone}>Akun Anda sudah terdaftar di HP lain. Absen dari HP ini perlu persetujuan pemilik.</Notice>
            )}
            <div className="grid grid-cols-2 gap-3">
              <TimeBox label="Masuk" value={rec ? formatTimeWita(rec.check_in_at) : '—'} sub={rec?.late_minutes ? `Terlambat ${rec.late_minutes} mnt` : rec ? 'Tepat waktu' : `Jam masuk ${me.data.work_start_time}`} danger={!!rec?.late_minutes} />
              <TimeBox label="Pulang" value={rec?.check_out_at ? formatTimeWita(rec.check_out_at) : '—'} />
            </div>
            {done ? (
              <p className="rounded-xl bg-success/10 p-3 text-center font-medium text-success">Absensi hari ini selesai. Terima kasih!</p>
            ) : (
              <Button
                size="xl"
                className="w-full"
                disabled={!online || !me.data.location_set}
                onClick={() => {
                  setPresetQr(null)
                  setFlow({ open: true, kind: rec ? 'out' : 'in' })
                }}
              >
                {rec ? <LogOut /> : <LogIn />} {rec ? 'Absen pulang' : 'Absen masuk'}
              </Button>
            )}
            <p className="text-center text-xs text-muted-foreground">
              Scan QR di toko · maks. {me.data.radius_m} m dari toko · selfie wajib
            </p>
          </div>
        )}
      </Card>

      <Tabs defaultValue="riwayat">
        <TabsList className={manager ? 'grid grid-cols-5' : 'grid grid-cols-2'}>
          <TabsTrigger className={TAB} value="riwayat">
            <Clock /> Riwayat
          </TabsTrigger>
          <TabsTrigger className={TAB} value="izin">
            <FileText /> Izin
          </TabsTrigger>
          {manager && (
            <>
              <TabsTrigger className={TAB} value="rekap">
                <Table2 /> Rekap
              </TabsTrigger>
              <TabsTrigger className={TAB} value="perangkat">
                <Smartphone /> HP
              </TabsTrigger>
              <TabsTrigger className={TAB} value="pengaturan">
                <Settings2 /> Atur
              </TabsTrigger>
            </>
          )}
        </TabsList>
        <TabsContent value="riwayat">{session && <MyHistory userId={session.user.id} />}</TabsContent>
        <TabsContent value="izin">
          <LeavePanel manager={manager} />
        </TabsContent>
        {manager && (
          <>
            <TabsContent value="rekap">
              <RecapPanel />
            </TabsContent>
            <TabsContent value="perangkat">
              <DevicesPanel />
            </TabsContent>
            <TabsContent value="pengaturan">
              <SettingsPanel />
            </TabsContent>
          </>
        )}
      </Tabs>

      {me.data && (
        <CheckFlowDialog
          open={flow.open}
          onOpenChange={(open) => setFlow((f) => ({ ...f, open }))}
          kind={flow.kind}
          maxAccuracy={me.data.max_accuracy_m}
          presetQr={presetQr}
        />
      )}
    </>
  )
}

// ikon di atas label agar 5 tab muat di layar HP
const TAB = 'h-14 flex-col gap-0.5 px-1 text-xs sm:h-11 sm:flex-row sm:gap-2 sm:text-sm'

function Notice({ icon: Icon, children }: { icon: typeof AlertTriangle; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-primary/20 p-3 text-sm" role="note">
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{children}</p>
    </div>
  )
}

function TimeBox({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="rounded-2xl bg-muted p-4" data-testid={`time-${label.toLowerCase()}`}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
      {sub && <p className={`text-xs ${danger ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>{sub}</p>}
    </div>
  )
}

function MyHistory({ userId }: { userId: string }) {
  const today = businessDate()
  const [month, setMonth] = useState(today.slice(0, 7))
  const range = monthRange(month)
  const period = { from: range.from, to: range.to > today ? today : range.to }
  const q = useRecap(period, userId)
  const emp = q.data?.employees[0]
  return (
    <Card className="p-4">
      <label className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Bulan</span>
        <input type="month" aria-label="Bulan riwayat" className="h-11 rounded-xl border bg-card px-3" value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </label>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <p className="text-destructive">{toUserMessage(q.error)}</p>
      ) : !emp ? (
        <p className="text-sm text-muted-foreground">Belum ada data.</p>
      ) : (
        <>
          <p className="mb-3 text-sm" data-testid="my-summary">
            Hadir <b>{emp.summary.hadir}</b> · Terlambat <b>{emp.summary.terlambat}</b> · Izin/Sakit/Cuti <b>{emp.summary.izin + emp.summary.sakit + emp.summary.cuti}</b> · Mangkir{' '}
            <b>{emp.summary.mangkir}</b>
          </p>
          <ul className="divide-y">
            {[...emp.days].filter((d) => !HIDDEN_DAY.has(d.status)).reverse().map((d) => (
              <li key={d.date} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>{formatDateWita(d.date + 'T12:00:00+08:00', 'EEE, d MMM')}</span>
                <span className="tabular-nums text-muted-foreground">
                  {d.check_in_at ? formatTimeWita(d.check_in_at) : ''}
                  {d.check_out_at ? ` – ${formatTimeWita(d.check_out_at)}` : ''}
                </span>
                <DayStatusBadge status={d.status} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

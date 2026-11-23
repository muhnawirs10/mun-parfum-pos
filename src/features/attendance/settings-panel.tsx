import { useEffect, useState } from 'react'
import { Crosshair, FileDown, Loader2, MapPin, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { toUserMessage } from '@/lib/errors'
import { useAttendanceSettings, useRegenerateQr, useSetLocation, useUpdateSchedule, type AttendanceSettings } from './api'
import { buildQrUrl, waitForGps, WEEKDAYS, type GpsFix } from './lib'

export function SettingsPanel() {
  const q = useAttendanceSettings()
  if (q.isPending) return <Skeleton className="h-64" />
  if (q.isError) return <p className="text-destructive">{toUserMessage(q.error)}</p>
  return (
    <div className="space-y-4">
      <LocationCard s={q.data} />
      <QrCard s={q.data} />
      <ScheduleCard s={q.data} />
    </div>
  )
}

function LocationCard({ s }: { s: AttendanceSettings }) {
  const setLoc = useSetLocation()
  const [fix, setFix] = useState<GpsFix | null>(null)
  const [busy, setBusy] = useState(false)

  async function capture() {
    setBusy(true)
    setFix(null)
    try {
      const f = await waitForGps(10, { onProgress: setFix, timeoutMs: 30_000 })
      if (f.accuracy > 30) throw new Error(`GPS kurang akurat (±${Math.round(f.accuracy)} m). Coba di dekat pintu/jendela toko lalu ulangi.`)
      await setLoc.mutateAsync(f)
      toast.success(`Lokasi toko disimpan (akurasi ±${Math.round(f.accuracy)} m)`)
    } catch (e) {
      toast.error(toUserMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-3 p-5">
      <p className="flex items-center gap-2 font-bold">
        <MapPin className="h-4 w-4" /> Titik lokasi toko
      </p>
      {s.latitude != null ? (
        <p className="text-sm" data-testid="store-location">
          {s.latitude.toFixed(6)}, {s.longitude!.toFixed(6)} ·{' '}
          <a className="underline" href={`https://maps.google.com/?q=${s.latitude},${s.longitude}`} target="_blank" rel="noreferrer">
            lihat di peta
          </a>
        </p>
      ) : (
        <p className="text-sm text-destructive">Belum diatur — karyawan belum bisa absen.</p>
      )}
      <p className="text-sm text-muted-foreground">
        Berdiri di <b>dalam toko</b> (dekat tempat QR dipasang), lalu tekan tombol di bawah. Karyawan hanya bisa absen dalam radius <b>{s.radius_m} m</b> dari titik ini dengan akurasi GPS ≤ {s.max_accuracy_m} m.
      </p>
      {busy && fix && <p className="text-sm">Akurasi saat ini ±{Math.round(fix.accuracy)} m…</p>}
      <Button onClick={() => void capture()} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Crosshair />} {s.latitude != null ? 'Perbarui dari posisi saya sekarang' : 'Gunakan posisi saya sekarang'}
      </Button>
    </Card>
  )
}

function QrCard({ s }: { s: AttendanceSettings }) {
  const url = buildQrUrl(window.location.origin, s.outlet_id, s.token)
  const [img, setImg] = useState<string | null>(null)
  const regen = useRegenerateQr()

  useEffect(() => {
    let alive = true
    import('qrcode').then((QR) => QR.toDataURL(url, { width: 512, margin: 2, errorCorrectionLevel: 'M' })).then((d) => alive && setImg(d))
    return () => {
      alive = false
    }
  }, [url])

  async function downloadPdf() {
    if (!img) return
    const [{ jsPDF }, { downloadBlob }] = await Promise.all([import('jspdf'), import('@/features/reports/export')])
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(26)
    doc.text('ABSENSI KARYAWAN', 105, 30, { align: 'center' })
    doc.setFontSize(16)
    doc.text(`MUN PARFUM - ${s.outlet_name}`.replace(/[^\x20-\x7E]/g, '?'), 105, 42, { align: 'center' })
    doc.addImage(img, 'PNG', 45, 55, 120, 120)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(13)
    ;[
      '1. Buka aplikasi MUN PARFUM POS > menu Absensi',
      '2. Tekan "Absen masuk" / "Absen pulang", lalu scan QR ini',
      `3. Pastikan GPS aktif dan Anda berada di dalam toko (maks. ${s.radius_m} m)`,
      '4. Ambil selfie - absen terkirim',
    ].forEach((line, i) => doc.text(line, 30, 192 + i * 9))
    doc.setFontSize(9)
    doc.text('QR ini rahasia toko. Jangan difoto/disebarkan. Pemilik dapat mengganti QR kapan saja.', 105, 240, { align: 'center' })
    downloadBlob(doc.output('blob'), `qr-absensi-${s.outlet_code}.pdf`)
  }

  return (
    <Card className="space-y-3 p-5">
      <p className="font-bold">QR absensi untuk dicetak</p>
      <div className="flex flex-wrap items-center gap-4">
        {img ? <img src={img} alt="QR absensi" className="h-44 w-44 rounded-xl border" data-testid="qr-image" /> : <Skeleton className="h-44 w-44" />}
        <div className="flex flex-1 flex-col gap-2">
          <p className="text-sm text-muted-foreground">Cetak, lalu tempel di dalam toko (dekat meja kasir). Bila QR tersebar (difoto karyawan), buat QR baru — QR lama langsung tidak berlaku.</p>
          <Button onClick={() => void downloadPdf()} disabled={!img}>
            <FileDown /> Unduh QR (PDF A4)
          </Button>
          <Button
            variant="outline"
            disabled={regen.isPending}
            onClick={() => {
              if (!window.confirm('Buat QR baru? QR lama yang sudah dicetak tidak berlaku lagi.')) return
              regen.mutate(undefined, { onSuccess: () => toast.success('QR baru dibuat. Cetak dan ganti QR di toko.'), onError: (e) => toast.error(toUserMessage(e)) })
            }}
          >
            <RefreshCw /> Buat QR baru
          </Button>
        </div>
      </div>
    </Card>
  )
}

function ScheduleCard({ s }: { s: AttendanceSettings }) {
  const save = useUpdateSchedule()
  const [start, setStart] = useState(s.work_start_time)
  const [tol, setTol] = useState(String(s.late_tolerance_minutes))
  const [days, setDays] = useState<number[]>(s.work_days)
  const toggle = (n: number) => setDays((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n].sort()))

  return (
    <Card className="space-y-4 p-5">
      <p className="font-bold">Jam kerja & keterlambatan</p>
      <div className="grid grid-cols-2 gap-3">
        <Field id="work-start" label="Jam masuk">
          <Input id="work-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field id="late-tol" label="Toleransi (menit)" hint="Lewat dari ini = terlambat">
          <Input id="late-tol" inputMode="numeric" value={tol} onChange={(e) => setTol(e.target.value.replace(/\D/g, '').slice(0, 3))} />
        </Field>
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium">Hari buka (hari lain tidak dihitung mangkir)</p>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d) => (
            <button
              key={d.n}
              type="button"
              aria-pressed={days.includes(d.n)}
              onClick={() => toggle(d.n)}
              className={`h-10 w-12 rounded-xl border text-sm font-medium ${days.includes(d.n) ? 'border-transparent bg-primary' : 'bg-card text-muted-foreground'}`}
            >
              {d.short}
            </button>
          ))}
        </div>
      </div>
      <Button
        disabled={save.isPending || !days.length || !start || tol === ''}
        onClick={() =>
          save.mutate(
            { work_start: start, late_tolerance: Number(tol), work_days: days },
            { onSuccess: () => toast.success('Jam kerja disimpan'), onError: (e) => toast.error(toUserMessage(e)) },
          )
        }
      >
        Simpan jam kerja
      </Button>
    </Card>
  )
}

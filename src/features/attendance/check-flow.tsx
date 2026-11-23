import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, MapPin, QrCode, ScanFace, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { toUserMessage } from '@/lib/errors'
import { formatTimeWita } from '@/lib/format'
import { useAttendanceCheck, type CheckResult } from './api'
import { captureJpeg, createQrDecoder, useCamera } from './camera'
import { deviceLabel, getDeviceId, parseQr, waitForGps, type GpsFix, type QrPayload } from './lib'

type Step = 'scan' | 'selfie' | 'sending' | 'result'

/**
 * Alur absen: scan QR toko → (GPS dicari bersamaan) → selfie → kirim.
 * Server memeriksa ulang semuanya dan mencatat percobaan yang ditolak.
 */
export function CheckFlowDialog({
  open,
  onOpenChange,
  kind,
  maxAccuracy,
  presetQr,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  kind: 'in' | 'out'
  maxAccuracy: number
  /** QR yang sudah dipindai lewat kamera bawaan HP (membuka /absen?o=&t=) */
  presetQr?: QrPayload | null
}) {
  const [step, setStep] = useState<Step>('scan')
  const [qr, setQr] = useState<QrPayload | null>(null)
  const [gps, setGps] = useState<GpsFix | null>(null)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [scanHint, setScanHint] = useState<string | null>(null)
  const [result, setResult] = useState<CheckResult | null>(null)
  const gpsPromise = useRef<Promise<GpsFix> | null>(null)
  const check = useAttendanceCheck()

  function startGps() {
    setGps(null)
    setGpsError(null)
    const p = waitForGps(Math.min(maxAccuracy, 15), { onProgress: setGps })
    p.then(setGps, (e: Error) => setGpsError(e.message))
    gpsPromise.current = p
  }

  useEffect(() => {
    if (!open) return
    setResult(null)
    setScanHint(null)
    if (presetQr) {
      setQr(presetQr)
      setStep('selfie')
      startGps()
    } else {
      setQr(null)
      setStep('scan')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function onScanned(text: string) {
    const p = parseQr(text)
    if (!p) return setScanHint('Ini bukan QR absensi MUN PARFUM. Arahkan ke QR yang terpasang di toko.')
    setQr(p)
    setStep('selfie')
    startGps()
  }

  async function onPhoto(photo: Blob) {
    setStep('sending')
    try {
      const fix = await gpsPromise.current!
      const r = await check.mutateAsync({
        outletId: qr!.outletId,
        token: qr!.token,
        kind,
        lat: fix.lat,
        lng: fix.lng,
        accuracy: fix.accuracy,
        deviceId: getDeviceId(),
        deviceLabel: deviceLabel(),
        photo,
      })
      setResult(r)
    } catch (e) {
      setResult({ ok: false, reason: 'ERROR', message: toUserMessage(e) })
    }
    setStep('result')
  }

  const title = kind === 'in' ? 'Absen masuk' : 'Absen pulang'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} className="max-w-md">
        <div className="space-y-4 p-5">
          <Steps step={step} />
          {step === 'scan' && <ScanStep onScanned={onScanned} hint={scanHint} />}
          {step === 'selfie' && (
            <>
              <GpsStatus fix={gps} error={gpsError} maxAccuracy={maxAccuracy} onRetry={startGps} />
              <SelfieStep onPhoto={onPhoto} disabled={!!gpsError} />
            </>
          )}
          {step === 'sending' && (
            <div className="flex flex-col items-center gap-3 py-10 text-center" role="status">
              <Loader2 className="h-10 w-10 animate-spin" />
              <p className="font-medium">{gps && gps.accuracy > maxAccuracy ? 'Menunggu GPS lebih akurat…' : 'Mengirim absen…'}</p>
              {gps && <p className="text-sm text-muted-foreground">Akurasi GPS ±{Math.round(gps.accuracy)} m</p>}
            </div>
          )}
          {step === 'result' && result && (
            <ResultView
              result={result}
              onRetry={() => {
                setResult(null)
                setStep('scan')
              }}
              onClose={() => onOpenChange(false)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Steps({ step }: { step: Step }) {
  const items = [
    { key: 'scan', icon: QrCode, label: 'Scan QR' },
    { key: 'selfie', icon: ScanFace, label: 'Selfie & GPS' },
    { key: 'result', icon: CheckCircle2, label: 'Selesai' },
  ]
  const idx = step === 'scan' ? 0 : step === 'selfie' ? 1 : 2
  return (
    <ol className="flex items-center gap-2 text-xs">
      {items.map((s, i) => (
        <li key={s.key} className={`flex flex-1 items-center gap-1.5 rounded-xl px-2 py-1.5 ${i === idx ? 'bg-primary/25 font-semibold' : i < idx ? 'text-foreground' : 'text-muted-foreground'}`}>
          <s.icon className="h-4 w-4 shrink-0" />
          {s.label}
        </li>
      ))}
    </ol>
  )
}

function ScanStep({ onScanned, hint }: { onScanned: (text: string) => void; hint: string | null }) {
  const { videoRef, error, ready } = useCamera('environment', true)
  const cb = useRef(onScanned)
  cb.current = onScanned

  useEffect(() => {
    if (!ready) return
    let stop = false
    let last = ''
    ;(async () => {
      const decode = await createQrDecoder()
      while (!stop) {
        const v = videoRef.current
        const text = v ? await decode(v).catch(() => null) : null
        if (text && text !== last) {
          last = text
          cb.current(text)
        }
        await new Promise((r) => setTimeout(r, 200))
      }
    })()
    return () => {
      stop = true
    }
  }, [ready, videoRef])

  return (
    <div className="space-y-3">
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-secondary">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted data-testid="scan-video" />
        <div className="pointer-events-none absolute inset-10 rounded-2xl border-4 border-primary/80" />
        {!ready && !error && <Loader2 className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 animate-spin text-white" />}
      </div>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : <p className="text-sm text-muted-foreground">Arahkan kamera ke QR absensi yang terpasang di toko.</p>}
      {hint && <p className="text-sm text-destructive" role="alert">{hint}</p>}
    </div>
  )
}

function GpsStatus({ fix, error, maxAccuracy, onRetry }: { fix: GpsFix | null; error: string | null; maxAccuracy: number; onRetry: () => void }) {
  if (error)
    return (
      <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive" role="alert">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1">{error}</div>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Coba lagi
        </Button>
      </div>
    )
  const good = fix && fix.accuracy <= maxAccuracy
  return (
    <div className={`flex items-center gap-2 rounded-xl p-3 text-sm ${good ? 'bg-success/10 text-success' : 'bg-muted'}`} data-testid="gps-status">
      {good ? <MapPin className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
      {fix ? `GPS ±${Math.round(fix.accuracy)} m${good ? ' — siap' : ' — menunggu sinyal lebih akurat…'}` : 'Mencari lokasi GPS…'}
    </div>
  )
}

function SelfieStep({ onPhoto, disabled }: { onPhoto: (b: Blob) => void; disabled: boolean }) {
  const { videoRef, error, ready } = useCamera('user', true)
  const [busy, setBusy] = useState(false)
  return (
    <div className="space-y-3">
      <div className="relative mx-auto aspect-[3/4] w-full max-w-xs overflow-hidden rounded-2xl bg-secondary">
        <video ref={videoRef} className="h-full w-full -scale-x-100 object-cover" playsInline muted data-testid="selfie-video" />
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <Button
        className="w-full"
        size="lg"
        disabled={!ready || busy || disabled}
        onClick={async () => {
          setBusy(true)
          try {
            onPhoto(await captureJpeg(videoRef.current!))
          } finally {
            setBusy(false)
          }
        }}
      >
        <ScanFace /> Ambil selfie & kirim
      </Button>
      <p className="text-center text-xs text-muted-foreground">Pastikan wajah terlihat jelas. Foto hanya dapat dilihat pemilik.</p>
    </div>
  )
}

function ResultView({ result, onRetry, onClose }: { result: CheckResult; onRetry: () => void; onClose: () => void }) {
  if (result.ok)
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center" data-testid="check-result" role="status">
        <CheckCircle2 className="h-14 w-14 text-success" />
        <p className="text-xl font-bold">{result.kind === 'in' ? 'Absen masuk berhasil' : 'Absen pulang berhasil'}</p>
        <p className="text-3xl font-bold tabular-nums">{formatTimeWita(result.at!)}</p>
        <p className="text-sm text-muted-foreground">Jarak dari toko {Number(result.distance_m).toLocaleString('id-ID')} m</p>
        {!!result.late_minutes && result.kind === 'in' && <p className="font-semibold text-destructive">Terlambat {result.late_minutes} menit</p>}
        <Button className="mt-3 w-full" onClick={onClose}>
          Selesai
        </Button>
      </div>
    )
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center" data-testid="check-result" role="alert">
      <XCircle className="h-14 w-14 text-destructive" />
      <p className="text-xl font-bold">Absen ditolak</p>
      <p>{result.message}</p>
      <div className="mt-3 grid w-full grid-cols-2 gap-2">
        <Button variant="outline" onClick={onClose}>
          Tutup
        </Button>
        <Button onClick={onRetry}>Coba lagi</Button>
      </div>
    </div>
  )
}

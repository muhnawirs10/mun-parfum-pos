/** Kamera HP: pemindai QR (kamera belakang) & selfie (kamera depan). */
import { useEffect, useRef, useState } from 'react'
import { cameraErrorMessage } from './lib'

export function useCamera(facing: 'user' | 'environment', active: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!active) return
    let stream: MediaStream | null = null
    let cancelled = false
    const video = videoRef.current
    setError(null)
    setReady(false)
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no camera'), { name: 'NotFoundError' })
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (cancelled) return stream.getTracks().forEach((t) => t.stop())
        const v = video
        if (v) {
          v.srcObject = stream
          v.setAttribute('playsinline', 'true')
          v.muted = true
          await v.play().catch(() => {})
          setReady(true)
        }
      } catch (e) {
        if (!cancelled) setError(cameraErrorMessage(e))
      }
    })()
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
      if (video) video.srcObject = null
    }
  }, [facing, active])

  return { videoRef, error, ready }
}

type Decoder = (video: HTMLVideoElement) => Promise<string | null>

/** BarcodeDetector bawaan (Android Chrome) bila ada; selain itu jsQR. */
export async function createQrDecoder(): Promise<Decoder> {
  const BD = (globalThis as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> }; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector
  const formats: string[] = BD ? ((await BD.getSupportedFormats?.().catch(() => [] as string[])) ?? []) : []
  if (BD && formats.includes('qr_code')) {
    const det = new BD({ formats: ['qr_code'] })
    return async (video) => (await det.detect(video).catch(() => []))[0]?.rawValue ?? null
  }
  const { default: jsQR } = await import('jsqr')
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  return async (video) => {
    if (!ctx || !video.videoWidth) return null
    const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null
  }
}

/** Ambil satu frame video sebagai JPEG kecil (maks. 720 px). */
export function captureJpeg(video: HTMLVideoElement, maxSize = 720, quality = 0.75): Promise<Blob> {
  const scale = Math.min(1, maxSize / Math.max(video.videoWidth || 1, video.videoHeight || 1))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round((video.videoWidth || 1) * scale))
  canvas.height = Math.max(1, Math.round((video.videoHeight || 1) * scale))
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal mengambil foto'))), 'image/jpeg', quality))
}

/** Perkecil foto dari galeri/kamera (lampiran surat) menjadi JPEG ≤ 1280 px. */
export async function shrinkImage(file: File, maxSize = 1280, quality = 0.8): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxSize / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal memproses gambar'))), 'image/jpeg', quality))
}

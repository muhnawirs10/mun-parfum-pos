/**
 * Utilitas absensi (murni, mudah diuji). Semua aturan sesungguhnya
 * (jarak, akurasi, token QR, perangkat, foto) DIPERIKSA ULANG DI SERVER.
 */

export interface QrPayload {
  outletId: string
  token: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Isi QR cetak: URL aplikasi /absen?o=<outlet>&t=<token>. */
export function buildQrUrl(origin: string, outletId: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/absen?o=${outletId}&t=${token}`
}

/** Baca isi QR (URL lengkap atau hanya query string). null bila bukan QR absensi. */
export function parseQr(text: string): QrPayload | null {
  try {
    const url = new URL(text.trim(), 'https://x.invalid')
    if (!/\/absen\/?$/.test(url.pathname)) return null
    const outletId = url.searchParams.get('o') ?? ''
    const token = url.searchParams.get('t') ?? ''
    if (!UUID.test(outletId) || !/^[A-Za-z0-9]{16,128}$/.test(token)) return null
    return { outletId, token }
  } catch {
    return null
  }
}

/** Jarak haversine (meter) — hanya untuk tampilan; server menghitung ulang. */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371008.8
  const rad = (d: number) => (d * Math.PI) / 180
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

const DEVICE_KEY = 'mun-pos-device-id'

/** ID acak per HP (disimpan di perangkat). Dipakai untuk aturan "satu HP per karyawan". */
export function getDeviceId(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): string {
  let id: string | null = null
  try {
    id = storage?.getItem(DEVICE_KEY) ?? null
  } catch {
    /* penyimpanan diblokir */
  }
  if (id && /^[A-Za-z0-9-]{16,100}$/.test(id)) return id
  id = crypto.randomUUID()
  try {
    storage?.setItem(DEVICE_KEY, id)
  } catch {
    /* abaikan */
  }
  return id
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Nama perangkat yang mudah dikenali pemilik, mis. "Android · Chrome". */
export function deviceLabel(ua: string = navigator.userAgent): string {
  const os = /iPhone|iPad/.test(ua)
    ? 'iPhone/iPad'
    : /Android/.test(ua)
      ? (ua.match(/Android [^;)]*;\s*([^;)]+?)(?: Build|\))/)?.[1]?.trim() ?? 'Android')
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS/.test(ua)
          ? 'Mac'
          : 'Perangkat'
  const browser = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /EdgA?\//.test(ua) ? 'Edge' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : /Firefox/.test(ua) ? 'Firefox' : 'Browser'
  return `${os} · ${browser}`.slice(0, 160)
}

export interface GpsFix {
  lat: number
  lng: number
  accuracy: number
}

/**
 * Tunggu posisi GPS yang cukup akurat. Mengembalikan posisi terbaik yang
 * didapat dalam `timeoutMs` (default 20 detik), atau lebih cepat bila
 * akurasi sudah ≤ targetAccuracy. Melempar Error bila GPS tidak tersedia/ditolak.
 */
export function waitForGps(
  targetAccuracy: number,
  { timeoutMs = 20_000, onProgress, geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined }: { timeoutMs?: number; onProgress?: (fix: GpsFix) => void; geo?: Geolocation } = {},
): Promise<GpsFix> {
  return new Promise((resolve, reject) => {
    if (!geo) return reject(new Error('Perangkat ini tidak mendukung GPS/lokasi.'))
    let best: GpsFix | null = null
    let done = false
    const finish = (fn: () => void) => {
      if (done) return
      done = true
      geo.clearWatch(watchId)
      clearTimeout(timer)
      fn()
    }
    const watchId = geo.watchPosition(
      (p) => {
        const fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }
        if (!best || fix.accuracy <= best.accuracy) best = fix
        onProgress?.(best)
        if (best.accuracy <= targetAccuracy) finish(() => resolve(best!))
      },
      (err) => {
        if (err.code === 1) finish(() => reject(new Error('Izin lokasi ditolak. Izinkan akses Lokasi untuk aplikasi ini di pengaturan browser/HP.')))
        // kode 2/3: sinyal belum ada — tunggu sampai batas waktu
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
    )
    const timer = setTimeout(
      () => finish(() => (best ? resolve(best) : reject(new Error('GPS tidak mendapatkan lokasi. Aktifkan Lokasi (GPS) lalu coba lagi.')))),
      timeoutMs,
    )
  })
}

export const LEAVE_TYPE_LABEL = { sakit: 'Sakit', izin: 'Izin', cuti: 'Cuti', libur: 'Libur' } as const
export type LeaveType = keyof typeof LEAVE_TYPE_LABEL

export const DAY_STATUS_LABEL: Record<string, string> = {
  hadir: 'Hadir',
  terlambat: 'Terlambat',
  sakit: 'Sakit',
  izin: 'Izin',
  cuti: 'Cuti',
  libur: 'Libur',
  tutup: 'Toko tutup',
  mangkir: 'Mangkir',
  belum_absen: 'Belum absen',
  akan_datang: '—',
  belum_berlaku: 'Belum berlaku',
}

/** Hari yang tidak ditampilkan di rekap/riwayat. */
export const HIDDEN_DAY = new Set(['akan_datang', 'belum_berlaku'])

export const WEEKDAYS = [
  { n: 1, short: 'Sen' },
  { n: 2, short: 'Sel' },
  { n: 3, short: 'Rab' },
  { n: 4, short: 'Kam' },
  { n: 5, short: 'Jum' },
  { n: 6, short: 'Sab' },
  { n: 7, short: 'Min' },
]

export function formatMinutes(mins: number | null | undefined): string {
  if (!mins) return '0 mnt'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h ? `${h} j ${m} mnt` : `${m} mnt`
}

/** Pesan ramah untuk kegagalan kamera (getUserMedia). */
export function cameraErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Izin kamera ditolak. Izinkan akses Kamera untuk aplikasi ini di pengaturan browser/HP.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Kamera tidak ditemukan di perangkat ini.'
  if (name === 'NotReadableError') return 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.'
  return 'Kamera tidak dapat dibuka.'
}

import { buildQrUrl, deviceLabel, distanceM, formatMinutes, getDeviceId, parseQr, waitForGps } from './lib'

const OUTLET = '3f2b8a3e-7c1d-4e5f-9a0b-1c2d3e4f5a6b'
const TOKEN = 'a'.repeat(64)

describe('QR absensi', () => {
  it('membuat & membaca URL QR', () => {
    const url = buildQrUrl('https://mun-parfum-pos.vercel.app/', OUTLET, TOKEN)
    expect(url).toBe(`https://mun-parfum-pos.vercel.app/absen?o=${OUTLET}&t=${TOKEN}`)
    expect(parseQr(url)).toEqual({ outletId: OUTLET, token: TOKEN })
    expect(parseQr(`/absen?o=${OUTLET}&t=${TOKEN}`)).toEqual({ outletId: OUTLET, token: TOKEN })
  })
  it('menolak QR lain', () => {
    expect(parseQr('https://contoh.com/bayar?o=1')).toBeNull()
    expect(parseQr(`https://x.com/absen?o=bukan-uuid&t=${TOKEN}`)).toBeNull()
    expect(parseQr(`https://x.com/absen?o=${OUTLET}&t=pendek`)).toBeNull()
    expect(parseQr('teks biasa')).toBeNull()
  })
})

describe('jarak & format', () => {
  it('haversine ≈ 10 m untuk geser 0,0000899° lintang', () => {
    expect(distanceM(-5.4167, 119.4333, -5.4167 + 10 / 111195, 119.4333)).toBeCloseTo(10, 1)
  })
  it('format menit', () => {
    expect(formatMinutes(0)).toBe('0 mnt')
    expect(formatMinutes(45)).toBe('45 mnt')
    expect(formatMinutes(480)).toBe('8 j 0 mnt')
  })
})

describe('perangkat', () => {
  it('ID perangkat stabil di penyimpanan yang sama', () => {
    const m = new Map<string, string>()
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
    const a = getDeviceId(s)
    expect(a).toMatch(/^[A-Za-z0-9-]{16,100}$/)
    expect(getDeviceId(s)).toBe(a)
  })
  it('label perangkat', () => {
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 13; SM-A145F Build/TP1A) AppleWebKit Chrome/120 Mobile Safari')).toBe('SM-A145F · Chrome')
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1')).toBe('iPhone/iPad · Safari')
  })
})

describe('waitForGps', () => {
  function fakeGeo(fixes: number[], deny = false) {
    return {
      watchPosition: (ok: PositionCallback, fail: PositionErrorCallback) => {
        if (deny) setTimeout(() => fail({ code: 1 } as GeolocationPositionError))
        fixes.forEach((acc, i) => setTimeout(() => ok({ coords: { latitude: 1, longitude: 2, accuracy: acc } } as GeolocationPosition), i * 5))
        return 1
      },
      clearWatch: () => {},
      getCurrentPosition: () => {},
    } as unknown as Geolocation
  }
  it('selesai begitu akurasi tercapai', async () => {
    await expect(waitForGps(30, { geo: fakeGeo([80, 25, 5]) })).resolves.toEqual({ lat: 1, lng: 2, accuracy: 25 })
  })
  it('mengembalikan posisi terbaik saat waktu habis', async () => {
    await expect(waitForGps(10, { geo: fakeGeo([90, 40]), timeoutMs: 50 })).resolves.toMatchObject({ accuracy: 40 })
  })
  it('izin lokasi ditolak', async () => {
    await expect(waitForGps(30, { geo: fakeGeo([], true) })).rejects.toThrow(/Izin lokasi ditolak/)
  })
})

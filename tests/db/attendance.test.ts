import { asUser, createUser, createWorld, errorOf, sql, uuid, type World } from './helpers'

// Titik toko (Takalar) & geser N meter ke utara
const LAT = -5.4167
const LNG = 119.4333
const north = (m: number) => LAT + m / 111195

let w: World
const DEV_A = 'devA-' + '1'.repeat(20)
const DEV_B = 'devB-' + '2'.repeat(20)

async function tokenOf(outlet: string) {
  const [{ s }] = await asUser(w.owner, `select public.get_attendance_settings($1) s`, [outlet])
  return s.token as string
}

/** Unggah "selfie" sebagai pengguna (lewat policy storage) dan kembalikan path-nya. */
async function photo(user: string, outlet: string) {
  const path = `${outlet}/${user}/${uuid()}.jpg`
  await asUser(user, `insert into storage.objects (bucket_id, name) values ('attendance', $1)`, [path])
  return path
}

async function check(
  user: string,
  opts: { kind?: 'in' | 'out'; lat?: number | null; acc?: number; device?: string; token?: string; photo?: string | null; outlet?: string } = {},
) {
  const outlet = opts.outlet ?? w.tkl
  const token = opts.token ?? (await tokenOf(outlet))
  const p = opts.photo === undefined ? await photo(user, outlet) : opts.photo
  const [{ r }] = await asUser(user, `select public.attendance_check($1, $2, $3, $4, $5, $6, $7, 'HP Uji', $8) r`, [
    outlet,
    token,
    opts.kind ?? 'in',
    opts.lat === undefined ? north(3) : opts.lat,
    LNG,
    opts.acc ?? 8,
    opts.device ?? DEV_A,
    p,
  ])
  return r
}

beforeEach(async () => {
  w = await createWorld()
  await asUser(w.owner, `select public.set_attendance_location($1, $2, $3, 6)`, [w.tkl, LAT, LNG])
  // jam masuk = 00:00 agar uji keterlambatan tidak bergantung jam berjalan
  await asUser(w.owner, `select public.update_attendance_settings($1, '00:00', 0, '{1,2,3,4,5,6,7}')`, [w.tkl])
})

describe('Absen masuk & pulang', () => {
  it('berhasil di dalam radius: tercatat dengan jarak, foto, dan keterlambatan', async () => {
    const r = await check(w.kasirTkl)
    expect(r.ok).toBe(true)
    expect(Number(r.distance_m)).toBeGreaterThan(2)
    expect(Number(r.distance_m)).toBeLessThan(4)
    const [rec] = await sql(`select * from public.attendance_records where user_id = $1`, [w.kasirTkl])
    expect(rec.check_in_photo_path).toMatch(new RegExp(`^${w.tkl}/${w.kasirTkl}/`))
    const [{ mins }] = await sql(`select floor(extract(epoch from ((now() at time zone 'Asia/Makassar')::time - '00:00'::time)) / 60)::int mins`)
    expect(Math.abs(rec.late_minutes - mins)).toBeLessThanOrEqual(1)

    expect((await check(w.kasirTkl)).reason).toBe('ALREADY_IN')
    const out = await check(w.kasirTkl, { kind: 'out' })
    expect(out.ok).toBe(true)
    expect((await check(w.kasirTkl, { kind: 'out' })).reason).toBe('ALREADY_OUT')
  })

  it('tidak terlambat bila masih dalam toleransi', async () => {
    await asUser(w.owner, `select public.update_attendance_settings($1, '23:59', 0, '{1,2,3,4,5,6,7}')`, [w.tkl])
    const r = await check(w.kasirTkl)
    expect(r.ok).toBe(true)
    expect(r.late_minutes).toBe(0)
  })

  it('ditolak bila > 10 m, GPS kurang akurat, QR salah, tanpa GPS/foto — dan setiap percobaan dicatat', async () => {
    expect((await check(w.kasirTkl, { lat: north(11) })).reason).toBe('TOO_FAR')
    expect((await check(w.kasirTkl, { acc: 31 })).reason).toBe('LOW_ACCURACY')
    expect((await check(w.kasirTkl, { token: 'qr-palsu' })).reason).toBe('INVALID_QR')
    expect((await check(w.kasirTkl, { lat: null })).reason).toBe('NO_GPS')
    expect((await check(w.kasirTkl, { photo: null })).reason).toBe('NO_PHOTO')
    // foto milik orang lain tidak bisa dipakai
    expect((await check(w.kasirTkl, { photo: await photo(w.adminTkl, w.tkl) })).reason).toBe('NO_PHOTO')
    expect((await check(w.kasirTkl, { kind: 'out' })).reason).toBe('NOT_IN')
    const attempts = await sql(`select reason from public.attendance_attempts where user_id = $1 order by created_at`, [w.kasirTkl])
    expect(attempts.map((a) => a.reason)).toEqual(['TOO_FAR', 'LOW_ACCURACY', 'INVALID_QR', 'NO_GPS', 'NO_PHOTO', 'NO_PHOTO', 'NOT_IN'])
    expect((await sql(`select count(*)::int n from public.attendance_records where user_id = $1`, [w.kasirTkl]))[0].n).toBe(0)
    // tepat 9,5 m masih diterima
    expect((await check(w.kasirTkl, { lat: north(9.5) })).ok).toBe(true)
  })

  it('lokasi belum diatur → ditolak; outlet lain tanpa akses → error', async () => {
    expect((await check(w.kasirMks, { outlet: w.mks })).reason).toBe('LOCATION_NOT_SET')
    expect(await errorOf(check(w.kasirMks, { outlet: w.tkl, photo: null }))).toMatch(/Akses ditolak/)
  })

  it('QR dibuat ulang → QR lama tidak berlaku', async () => {
    const old = await tokenOf(w.tkl)
    await asUser(w.owner, `select public.regenerate_attendance_qr($1)`, [w.tkl])
    expect((await check(w.kasirTkl, { token: old })).reason).toBe('INVALID_QR')
    expect((await check(w.kasirTkl)).ok).toBe(true)
  })

  it('karyawan tidak dapat membaca token QR maupun mengubah lokasi toko', async () => {
    expect(await errorOf(asUser(w.kasirTkl, `select attendance_token from public.outlets`))).toMatch(/permission denied/)
    const rows = await asUser(w.kasirTkl, `select id, latitude, attendance_radius_m from public.outlets`)
    expect(rows).toHaveLength(1)
    expect(await errorOf(asUser(w.kasirTkl, `select public.get_attendance_settings($1)`, [w.tkl]))).toMatch(/attendance.manage/)
    expect(await errorOf(asUser(w.adminTkl, `select public.set_attendance_location($1, 0, 0, 5)`, [w.tkl]))).toMatch(/attendance.manage/)
    // owner pun tidak bisa langsung UPDATE kolom absensi (harus lewat RPC)
    expect(await errorOf(asUser(w.owner, `update public.outlets set attendance_radius_m = 200`))).toMatch(/permission denied/)
    expect(await errorOf(asUser(w.owner, `select public.set_attendance_location($1, 0, 0, 45)`, [w.tkl]))).toMatch(/kurang akurat/)
  })

  it('tabel absensi tidak dapat ditulis langsung', async () => {
    await check(w.kasirTkl)
    expect(await errorOf(asUser(w.kasirTkl, `update public.attendance_records set late_minutes = 0`))).toMatch(/permission denied/)
    expect(await errorOf(asUser(w.kasirTkl, `delete from public.attendance_attempts`))).toMatch(/permission denied/)
    expect(await errorOf(sql(`delete from public.attendance_records`))).toMatch(/tidak diizinkan/)
  })
})

describe('Satu HP per karyawan', () => {
  it('HP pertama otomatis disetujui; HP kedua menunggu; menyetujui HP baru mencabut yang lama', async () => {
    expect((await check(w.kasirTkl)).ok).toBe(true)
    expect((await check(w.kasirTkl, { kind: 'out', device: DEV_B })).reason).toBe('DEVICE_PENDING')

    const [{ d }] = await asUser(w.owner, `select public.list_attendance_devices($1) d`, [w.tkl])
    const pending = d.find((x: any) => x.status === 'pending')
    expect(pending.full_name).toBe('Kasir TKL')
    // kasir/admin tanpa izin tidak bisa menyetujui
    expect(await errorOf(asUser(w.kasirTkl, `select public.set_attendance_device_status($1, 'approved')`, [pending.id]))).toMatch(/Akses ditolak/)
    expect(await errorOf(asUser(w.adminTkl, `select public.set_attendance_device_status($1, 'approved')`, [pending.id]))).toMatch(/Akses ditolak/)
    await asUser(w.owner, `select public.set_attendance_device_status($1, 'approved')`, [pending.id])

    expect((await check(w.kasirTkl, { kind: 'out', device: DEV_A })).reason).toBe('DEVICE_REVOKED')
    expect((await check(w.kasirTkl, { kind: 'out', device: DEV_B })).ok).toBe(true)
    const statuses = await sql(`select device_id, status from public.attendance_devices where user_id = $1 order by device_id`, [w.kasirTkl])
    expect(statuses).toEqual([
      { device_id: DEV_A, status: 'revoked' },
      { device_id: DEV_B, status: 'approved' },
    ])
  })

  it('izin attendance.manage dapat didelegasikan owner ke admin', async () => {
    await asUser(w.owner, `update public.outlet_users set permissions = '{attendance.manage}' where user_id = $1`, [w.adminTkl])
    await check(w.kasirTkl)
    await check(w.kasirTkl, { kind: 'out', device: DEV_B })
    const [{ d }] = await asUser(w.adminTkl, `select public.list_attendance_devices($1) d`, [w.tkl])
    const pending = d.find((x: any) => x.status === 'pending')
    await asUser(w.adminTkl, `select public.set_attendance_device_status($1, 'approved')`, [pending.id])
    // tetapi tidak untuk outlet lain
    expect(await errorOf(asUser(w.adminTkl, `select public.get_attendance_settings($1)`, [w.mks]))).toMatch(/attendance.manage/)
  })
})

describe('Pengajuan izin & rekap', () => {
  const leave = (user: string, type: string, from: string, to: string, target: string | null = null) =>
    asUser(user, `select public.create_leave_request($1, $2::public.leave_type, $3, $4, 'Demam tinggi', null, $5) id`, [w.tkl, type, from, to, target]).then(
      (r) => r[0].id as string,
    )

  it('karyawan mengajukan sakit; owner menyetujui; tidak bisa mengajukan libur sendiri / tumpang tindih', async () => {
    const id = await leave(w.kasirTkl, 'sakit', '2026-11-02', '2026-11-03')
    expect(await errorOf(leave(w.kasirTkl, 'izin', '2026-11-03', '2026-11-04'))).toMatch(/Sudah ada pengajuan/)
    expect(await errorOf(leave(w.kasirTkl, 'libur', '2026-11-10', '2026-11-10'))).toMatch(/Libur ditetapkan/)
    expect(await errorOf(asUser(w.kasirTkl, `select public.review_leave_request($1, true)`, [id]))).toMatch(/attendance.manage/)
    await asUser(w.owner, `select public.review_leave_request($1, true, 'Semoga lekas sembuh')`, [id])
    expect(await errorOf(asUser(w.owner, `select public.review_leave_request($1, false)`, [id]))).toMatch(/sudah diproses/)
    const [{ status }] = await sql(`select status from public.leave_requests where id = $1`, [id])
    expect(status).toBe('approved')
    // kasir lain tidak melihat pengajuan ini
    const [{ l }] = await asUser(w.adminTkl, `select public.list_leave_requests($1, '2026-11-01', '2026-11-30') l`, [w.tkl])
    expect(l).toEqual([])
  })

  it('batal hanya oleh pemilik pengajuan saat masih menunggu', async () => {
    const id = await leave(w.kasirTkl, 'izin', '2026-11-05', '2026-11-05')
    expect(await errorOf(asUser(w.adminTkl, `select public.cancel_leave_request($1)`, [id]))).toMatch(/tidak ditemukan/)
    await asUser(w.kasirTkl, `select public.cancel_leave_request($1)`, [id])
    expect(await errorOf(asUser(w.kasirTkl, `select public.cancel_leave_request($1)`, [id]))).toMatch(/masih menunggu/)
    // setelah dibatalkan, tanggal yang sama boleh diajukan lagi
    await leave(w.kasirTkl, 'izin', '2026-11-05', '2026-11-05')
  })

  it('rekap: hadir/terlambat, sakit, libur dari owner, tutup, mangkir dihitung otomatis', async () => {
    // Senin 2–Minggu 8 November 2026; Minggu = toko tutup
    await asUser(w.owner, `select public.update_attendance_settings($1, '09:00', 10, '{1,2,3,4,5,6}')`, [w.tkl])
    const sick = await leave(w.kasirTkl, 'sakit', '2026-11-03', '2026-11-03')
    await asUser(w.owner, `select public.review_leave_request($1, true)`, [sick])
    await leave(w.owner, 'libur', '2026-11-04', '2026-11-04', w.kasirTkl) // ditetapkan owner → langsung disetujui
    await leave(w.kasirTkl, 'izin', '2026-11-05', '2026-11-05') // masih menunggu → tetap mangkir
    // catatan hadir buatan (superuser) — 2 Nov tepat waktu, 6 Nov terlambat 25 menit, 7 Nov pulang
    const ins = (day: string, inAt: string, outAt: string | null, late: number) =>
      sql(
        `insert into public.attendance_records (outlet_id, user_id, business_date, check_in_at, check_in_lat, check_in_lng,
           check_in_accuracy_m, check_in_distance_m, check_in_photo_path, check_in_device_id, late_minutes, check_out_at)
         values ($1, $2, $3, $4, 0, 0, 5, 3, 'x', 'd', $5, $6)`,
        [w.tkl, w.kasirTkl, day, inAt, late, outAt],
      )
    await ins('2026-11-02', '2026-11-02T09:05:00+08', '2026-11-02T17:05:00+08', 0)
    await ins('2026-11-06', '2026-11-06T09:25:00+08', null, 25)
    await ins('2026-11-07', '2026-11-07T08:55:00+08', '2026-11-07T12:55:00+08', 0)

    const [{ r }] = await asUser(w.owner, `select public.get_attendance_recap($1, '2026-11-02', '2026-11-08') r`, [w.tkl])
    const kasir = r.employees.find((e: any) => e.full_name === 'Kasir TKL')
    expect(kasir.days.map((d: any) => d.status)).toEqual(['hadir', 'sakit', 'libur', 'mangkir', 'terlambat', 'hadir', 'tutup'])
    expect(kasir.summary).toMatchObject({ hadir: 3, terlambat: 1, sakit: 1, libur: 1, mangkir: 1, late_minutes: 25, worked_minutes: 480 + 240 })
    // kasir hanya boleh rekap dirinya sendiri
    expect(await errorOf(asUser(w.kasirTkl, `select public.get_attendance_recap($1, '2026-11-02', '2026-11-08')`, [w.tkl]))).toMatch(/attendance.manage/)
    const [{ r: mine }] = await asUser(w.kasirTkl, `select public.get_attendance_recap($1, '2026-11-02', '2026-11-08', $2) r`, [w.tkl, w.kasirTkl])
    expect(mine.employees).toHaveLength(1)
  })

  it('foto absensi: hanya pemilik foto & pengelola yang dapat membaca', async () => {
    const path = await photo(w.kasirTkl, w.tkl)
    const read = (u: string) => asUser(u, `select name from storage.objects where name = $1`, [path])
    expect(await read(w.kasirTkl)).toHaveLength(1)
    expect(await read(w.owner)).toHaveLength(1)
    expect(await read(w.adminTkl)).toHaveLength(0)
    expect(await read(w.kasirMks)).toHaveLength(0)
    // tidak bisa mengunggah atas nama orang lain
    expect(
      await errorOf(asUser(w.adminTkl, `insert into storage.objects (bucket_id, name) values ('attendance', $1)`, [`${w.tkl}/${w.kasirTkl}/x.jpg`])),
    ).toMatch(/row-level security/)
    expect(await errorOf(asUser(w.kasirMks, `insert into storage.objects (bucket_id, name) values ('attendance', $1)`, [`${w.tkl}/${w.kasirMks}/x.jpg`]))).toMatch(
      /row-level security/,
    )
  })

  it('pengguna yang dibuat belakangan tetap muncul di rekap', async () => {
    const baru = await createUser('absen-baru@test.local', 'Zaki Baru')
    await asUser(w.owner, `insert into public.outlet_users (outlet_id, user_id, role) values ($1, $2, 'kasir')`, [w.tkl, baru])
    const [{ r }] = await asUser(w.owner, `select public.get_attendance_recap($1, '2026-11-02', '2026-11-02') r`, [w.tkl])
    expect(r.employees.map((e: any) => e.full_name)).toContain('Zaki Baru')
  })
})

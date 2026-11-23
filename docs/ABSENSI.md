# Absensi Karyawan

Karyawan absen dari **HP masing-masing** dengan 3 bukti sekaligus, dan semuanya
diperiksa **di server** (bukan di HP, sehingga tidak bisa diakali dari aplikasi):

| Bukti | Aturan |
|---|---|
| **QR cetak di toko** | Berisi kode rahasia outlet. Bisa diganti kapan saja (QR lama langsung tidak berlaku). |
| **GPS** | Jarak ke titik toko **≤ 10 m** dan akurasi GPS **≤ 30 m**. Aplikasi menunggu sinyal stabil hingga 20 detik. |
| **Selfie** | Diambil langsung dari kamera depan (bukan dari galeri), disimpan di penyimpanan **privat**; hanya karyawan itu & pengelola yang bisa melihat. |
| **Satu HP per karyawan** | HP pertama otomatis terdaftar. HP lain menunggu persetujuan pemilik; menyetujui HP baru otomatis mencabut HP lama. |

Setiap percobaan yang **ditolak** (di luar radius, GPS kurang akurat, QR salah,
HP belum disetujui, dst.) dicatat beserta jarak & akurasinya.

## Pertama kali (pemilik)

1. Jalankan SQL migration absensi di Supabase (sekali saja) — lihat bagian *Pemasangan*.
2. Buka **Absensi → Atur** dengan HP, **berdiri di dalam toko** (dekat tempat QR akan dipasang),
   tekan **Gunakan posisi saya sekarang**. Ulangi di dekat pintu/jendela bila akurasi buruk.
3. Atur **jam masuk**, **toleransi terlambat**, dan **hari buka**.
4. **Unduh QR (PDF A4)**, cetak, tempel di dalam toko. Lakukan untuk setiap outlet.

Absensi mulai dihitung sejak tanggal lokasi toko pertama kali diatur (hari sebelumnya
tidak dihitung mangkir). Untuk karyawan baru, sejak tanggal ia ditugaskan.

## Karyawan

**Absensi → Absen masuk** → scan QR di toko → ambil selfie → selesai. Pulang: **Absen pulang**
dengan cara yang sama. Bisa juga memindai QR dengan aplikasi kamera bawaan HP (tautan membuka
aplikasi langsung ke langkah selfie).

**Izin:** tab **Izin → Ajukan izin** (Sakit / Izin / Cuti, maks. 31 hari, boleh lampirkan foto surat).
Pemilik menyetujui/menolak di tab yang sama. **Libur** hanya bisa ditetapkan pemilik
(langsung disetujui).

## Status di rekap

| Status | Arti |
|---|---|
| Hadir | Absen masuk ≤ jam masuk + toleransi |
| Terlambat | Absen masuk setelah jam masuk + toleransi (menit dihitung dari jam masuk) |
| Sakit / Izin / Cuti / Libur | Ada izin **yang disetujui** pada tanggal itu |
| Mangkir | Hari buka, tidak absen, dan tanpa izin yang disetujui (dihitung otomatis) |
| Toko tutup | Bukan hari buka |

Rekap per karyawan (hadir, terlambat, total menit telat, izin, mangkir, total jam kerja) bisa
diekspor ke **Excel / PDF**. Klik tanggal untuk melihat jam, jarak, dan selfie masuk/pulang.

## Hak akses

Izin baru **`attendance.manage`** (bawaan: pemilik). Pemilik dapat memberikannya ke admin outlet
tertentu (menu Karyawan). Semua karyawan yang login dapat absen & mengajukan izin untuk dirinya.

## Pemasangan di Supabase (sekali)

SQL Editor → New query → tempel isi
[`supabase/migrations/20261123000100_attendance.sql`](../supabase/migrations/20261123000100_attendance.sql)
→ **Run**. Lalu jalankan [`supabase/verify.sql`](../supabase/verify.sql): semua 11 baris harus ✅.
Project baru cukup memakai `supabase/setup.sql` (sudah termasuk absensi).

## Keterbatasan yang perlu diketahui

- GPS di HP **dapat dipalsukan** dengan aplikasi "fake GPS" (HP di-root/mode developer). Karena itu
  QR fisik + selfie + satu HP tetap diwajibkan; periksa selfie bila ada kecurigaan.
- Di dalam gedung/mal, akurasi GPS bisa > 30 m sehingga absen ditolak. Atur titik toko di dekat
  pintu/jendela dan minta karyawan absen di sana.
- Menghapus data browser/menginstal ulang aplikasi membuat HP dianggap HP baru (perlu disetujui lagi).

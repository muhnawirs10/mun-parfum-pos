# Checklist Uji Penerimaan (UAT) sebelum produksi

Semua fitur sudah diuji otomatis di lingkungan pengembangan (unit, database
PostgreSQL, E2E Playwright, PWA). Bagian di bawah **belum dapat diuji** tanpa
project Supabase sungguhan dan perangkat fisik. Centang bersama pemilik.

## A. Supabase sungguhan

- [x] Database terpasang (`setup.sql`) — `verify.sql` 8/8 ✅ (22 Nov 2026)
- [ ] Security Advisor ditinjau (3 view security definer memang disengaja)
- [x] Sign-up publik dimatikan; panjang sandi minimal 8 (diuji `smoke:supabase`)
- [x] `private.bootstrap_owner(...)` — pemilik Nawir (nawir08) & outlet TKL dibuat
- [ ] Pemilik berhasil login dengan email di aplikasi yang sudah di-deploy
- [x] Edge Function `admin-users` ter-deploy (Dashboard) dan menolak tanpa login (diuji `smoke:supabase`)
- [ ] Tambah kasir dari menu Karyawan → kasir login dengan **username**
- [ ] Reset sandi & nonaktifkan akun → kasir tidak bisa login
- [ ] Unggah foto produk (bucket `product-images`) tampil di kasir
- [ ] Kasir tidak bisa melihat HPP/laba (cek juga lewat DevTools → Network)

## B. Alur bisnis (tablet kasir)

- [ ] Tambah VALENTINE / SCANDALOUS: Rp2.000/ml, HPP Rp1.014, stok 307 ml
- [ ] Jual 10 ml tunai, uang Rp50.000 → kembalian Rp30.000, sisa 297 ml
- [ ] Laporan harian: omzet Rp20.000, HPP Rp10.140, laba kotor Rp9.860
- [ ] Jual 5 ml QRIS; jual dengan diskon item & transaksi
- [ ] Matikan Wi-Fi saat di kasir → banner offline, tombol bayar nonaktif
- [ ] Nyalakan lagi → "Koneksi pulih" → Coba lagi
- [ ] Batalkan transaksi → stok kembali, laporan tidak menghitung
- [ ] Catat pengeluaran → laba bersih berkurang, omzet tetap
- [ ] Buka kas → jual tunai → tutup kas → selisih benar
- [ ] Cetak Laporan Closing (PDF) & export Excel terbuka benar
- [ ] Nomor transaksi `MP-<KODE>-<YYYYMMDD>-0001` berganti tanggal pukul 00.00 WITA

## C. Perangkat & PWA

- [ ] Android Chrome: Lainnya → Instal aplikasi → ikon & splash tampil
- [ ] iPad Safari: Bagikan → Tambahkan ke Layar Utama → layar penuh
- [ ] Cetak struk ke printer thermal 58 mm (via aplikasi layanan cetak, mis. RawBT)
- [ ] Deploy versi baru → muncul "Versi baru tersedia" → Perbarui
- [ ] Lighthouse (Chrome DevTools) kategori PWA, Performance, Accessibility

## D. Operasional

- [ ] Backup harian / PITR aktif
- [ ] Domain HTTPS & header keamanan aktif (`curl -I https://domain`)
- [ ] `ALLOWED_ORIGINS` Edge Function diisi domain produksi
- [ ] CI GitHub Actions hijau pada `main`

## D. Absensi (lihat docs/ABSENSI.md)

- [ ] Migration absensi dijalankan; `verify.sql` 11/11 ✅
- [ ] Pemilik mengatur titik lokasi toko dari dalam toko (akurasi ≤ 30 m)
- [ ] QR dicetak & ditempel di toko
- [ ] Karyawan absen masuk dari HP-nya di dalam toko → berhasil, selfie terlihat di rekap
- [ ] Coba absen dari luar toko (> 10 m) → ditolak & tercatat di "Percobaan absen yang ditolak"
- [ ] Login akun yang sama di HP lain → muncul "perlu persetujuan pemilik"
- [ ] Ajukan izin sakit → pemilik setujui → rekap menampilkan "Sakit"
- [ ] Export rekap Excel/PDF


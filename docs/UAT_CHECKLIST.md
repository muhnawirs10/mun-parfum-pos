# Checklist Uji Penerimaan (UAT) sebelum produksi

Semua fitur sudah diuji otomatis di lingkungan pengembangan (unit, database
PostgreSQL, E2E Playwright, PWA). Bagian di bawah **belum dapat diuji** tanpa
project Supabase sungguhan dan perangkat fisik. Centang bersama pemilik.

## A. Supabase sungguhan

- [ ] `npx supabase db push` — semua migration 0100–0900 berhasil
- [ ] Security Advisor ditinjau (3 view security definer memang disengaja)
- [ ] Sign-up publik dimatikan; panjang sandi minimal 8
- [ ] `private.bootstrap_owner(...)` → owner bisa login dengan email
- [ ] `npx supabase functions deploy admin-users` berhasil
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

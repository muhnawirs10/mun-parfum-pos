# IMPLEMENTATION PLAN — MUN PARFUM POS

Dokumen ini adalah rencana teknis yang mengikuti *Final Technical Specification*.
Status diperbarui di akhir setiap fase.

## Keputusan final (tidak diubah tanpa persetujuan pemilik)

| Aspek | Keputusan |
|---|---|
| Platform | Web App + PWA (satu codebase) |
| Frontend | React 19 + TypeScript + Vite 6 |
| UI | Tailwind CSS 3 + komponen gaya shadcn/ui (Radix) + ikon Lucide |
| Backend | Supabase (Auth, PostgreSQL, RLS, RPC) |
| Inventaris | **Simple product inventory** — stok produk jadi, tanpa resep/BOM |
| Bahasa / Mata uang / Zona waktu | Indonesia / IDR / Asia/Makassar (WITA) |
| Warna | #FFFFFF, #F5C518, #FFD84D, #171717, #F5F5F3, #E8E8E8 — tanpa biru |

## Prinsip arsitektur

1. **Database adalah sumber kebenaran.** Penjualan, perubahan stok, dan void
   dijalankan oleh fungsi PostgreSQL (RPC) dalam satu transaksi database
   (atomik), dengan row lock pada produk.
2. **Stok tidak berubah tanpa `stock_movements`.** Kolom `products.current_stock`
   hanya dapat diubah oleh RPC; trigger menolak perubahan langsung.
3. **Keamanan di database, bukan di frontend.** RLS aktif di semua tabel bisnis;
   pengguna `authenticated` tidak punya hak INSERT/UPDATE langsung pada
   tabel kritis (produk, stok, transaksi). HPP dan laba disembunyikan dengan
   column privilege dan hanya dibuka lewat view/RPC yang memeriksa izin.
4. **Tanpa floating point untuk uang/volume.** DB: `numeric(14,2)` untuk uang,
   `numeric(14,3)` untuk volume. Frontend: kelas `Decimal` berbasis BigInt.
5. **Idempotensi.** Setiap transaksi membawa `idempotency_key` (UUID) yang unik;
   pengiriman ulang mengembalikan transaksi yang sama, bukan transaksi baru.
6. **Cloud-first, bukan offline POS.** Saat offline, UI menampilkan indikator
   dan menolak penyimpanan; tidak ada antrean transaksi lokal.
7. **Multi-outlet sejak awal.** Semua data operasional memiliki `outlet_id`.
8. **Tidak ada penghapusan permanen transaksi.** Pembatalan = status `void`
   + pengembalian stok yang tercatat.

## Aturan perhitungan (identik di `src/lib/sale-calc.ts` dan RPC `create_sale`)

```
line_subtotal = round(harga × qty, 0)       -- rupiah penuh, half away from zero
line_total    = line_subtotal − diskon_item
line_cost     = round(hpp × qty, 2)
omzet (total) = Σ line_total − diskon_transaksi
laba_kotor    = omzet − Σ line_cost
laba_bersih   = laba_kotor − pengeluaran operasional
kembalian     = uang_diterima − total      (tunai saja)
```

Contoh wajib — VALENTINE / SCANDALOUS (Rp2.000/ml, HPP Rp1.014/ml, stok 307 ml),
jual 10 ml → omzet Rp20.000, HPP Rp10.140, laba kotor Rp9.860, sisa 297 ml.

## Peran dan izin

Peran: `owner` (global, semua outlet), `admin` dan `kasir` (per outlet lewat
`outlet_users`). Izin dasar per peran dapat ditambah per pengguna.

| Izin | Owner | Admin (default) | Kasir (default) |
|---|---|---|---|
| `pos.sell` buat transaksi | ✓ | ✓ | ✓ |
| `transactions.view_all` lihat semua transaksi outlet | ✓ | ✓ | – (hanya miliknya) |
| `transactions.void` batalkan transaksi | ✓ | ✓ | – |
| `products.manage` kelola produk | ✓ | ✓ | – |
| `stock.manage` stok masuk/keluar/opname | ✓ | ✓ | – |
| `cost.view` lihat HPP | ✓ | ✓ | – |
| `profit.view` lihat laba & laporan keuangan | ✓ | opsional | – |
| `reports.view` laporan operasional | ✓ | ✓ | – |
| `expenses.view` / `expenses.manage` | ✓ | opsional | – |
| `closing.perform` closing kas | ✓ | ✓ | opsional |
| `users.manage` kelola kasir | ✓ | opsional | – |
| `settings.manage` | ✓ | – | – |
| `audit.view` riwayat audit | ✓ | – | – |

## Fase

| Fase | Lingkup | Status |
|---|---|---|
| 1 | Audit repository, fondasi proyek, tema, layout, routing, utilitas desimal/format, unit test, dokumentasi | ✅ Selesai |
| 2 | Migration database, Supabase Auth, RLS, peran & izin, RPC atomik, tes database | ✅ Selesai |
| 3 | Dashboard (data nyata) & manajemen produk (CRUD, SKU otomatis, foto) | ✅ Selesai |
| 4 | Stok masuk/keluar/opname & riwayat pergerakan | ✅ Selesai |
| 5 | Kasir, keranjang, diskon, pembayaran, kembalian, struk, riwayat & void | ✅ Selesai |
| 6 | Laporan keuangan, closing harian, pengeluaran, export PDF & Excel | ✅ Selesai |
| 7 | Multi-outlet, manajemen karyawan (Edge Function), pengaturan | ✅ Selesai |
| 8 | PWA (manifest, service worker, ikon, install prompt), optimasi tablet & ukuran bundle | ⏳ Berikutnya |
| 9 | E2E test, security audit, deployment | – |

Setiap fase ditutup dengan: build, unit test, tes database, pemeriksaan console
browser, perbaikan bug, dan laporan.

## Catatan Fase 1

- Repository awal **kosong** (tidak ada fondasi yang bisa dipakai ulang). Screenshot
  referensi berasal dari aplikasi kasir yang sedang dipakai; tata letaknya
  (navigasi bawah dengan tombol Kasir di tengah, kartu putih, daftar menu
  "Lainnya") diadopsi dengan identitas dan palet MUN PARFUM POS.
- Dibuat: konfigurasi Vite/TS/Tailwind, alias `@/`, komponen UI (Button, Card,
  Input, Label, Badge, Switch, Skeleton, EmptyState), AppShell + BottomNav +
  OfflineBanner, 10 rute halaman wajib + halaman Lainnya + 404, `Decimal`,
  `sale-calc`, format Rupiah/angka/WITA, validasi env dengan Zod, klien Supabase.
- Diuji: 21 unit/komponen test lulus; build produksi sukses; dijalankan di
  Chromium 1280×800 (tablet landscape) dan 390×844 (ponsel): 0 console error,
  tanpa overflow horizontal; banner offline muncul/hilang sesuai koneksi.

## Catatan Fase 2

**Migration** (`supabase/migrations/`):

- `0100_core_schema` — 14 tabel (`profiles, outlets, outlet_users, categories,
  products, outlet_counters, cash_sessions, transactions, transaction_items,
  payments, stock_movements, expenses, audit_logs, app_settings`), UUID PK, FK
  komposit `(product_id, outlet_id)` agar item/pergerakan tidak bisa lintas
  outlet, check constraint (total = subtotal − diskon, laba = omzet − HPP,
  stok_sesudah = stok_sebelum + qty, satuan bulat untuk PCS/UNIT/BOTOL), index.
- `0200_security` — fungsi izin (`is_owner`, `has_outlet_access`,
  `has_permission`, `my_access`), trigger profil otomatis, trigger penjaga
  (stok hanya lewat pergerakan; transaksi/item/pembayaran/pergerakan/audit tidak
  bisa dihapus/diubah), audit otomatis, column privilege (HPP/laba
  tersembunyi), RLS di 14 tabel, view sensitif dengan filter izin.
- `0300_rpc` — `create_product`, `update_product`, `set_product_active`,
  `adjust_stock`, `create_sale`, `void_transaction`, `open_cash_session`,
  `close_cash_session`, `get_sales_report`, `private.bootstrap_owner`.

**Frontend**: `AuthProvider` (sesi Supabase, profil, akses per outlet, outlet
aktif), login dengan email atau username (Zod), logout, `RequireAuth`,
`RequirePermission`, menu "Lainnya" yang difilter izin + pemilih outlet.

**Hasil uji Fase 2**

- Tes database: **51 lulus** pada PostgreSQL 16 sungguhan dengan stub skema
  `auth` Supabase; query dijalankan sebagai role `authenticated`/`anon` dengan
  klaim JWT, persis seperti PostgREST.
- Uji mutasi: mematikan cek stok → 3 tes gagal; mematikan pencabutan izin →
  2 tes gagal (tes terbukti mendeteksi regresi).
- Unit/komponen: **33 lulus**. Typecheck & lint: 0 error. Build sukses.
- Browser: layar setup (tanpa env) dan alur login dengan backend tak terjangkau
  diuji di Chromium; satu-satunya error console adalah kegagalan jaringan yang
  disengaja.
- Seed contoh + `bootstrap_owner` diuji pada database.

**Belum diuji terhadap project Supabase sungguhan** (tidak tersedia di
lingkungan pengembangan ini): GoTrue (login nyata), PostgREST, dan Security
Advisor. Wajib diverifikasi saat project Supabase dibuat.

## Catatan Fase 3

**Database** (`0400_dashboard_products`): RPC `get_dashboard` (ringkasan hari
ini dalam satu panggilan, menyesuaikan izin: kasir hanya melihat transaksinya
sendiri, laba hanya untuk `profit.view`, pengeluaran untuk `expenses.*`, stok
menipis untuk pengelola produk/stok) dan bucket Storage `product-images`
(publik, maks. 2 MB, JPG/PNG/WEBP) dengan policy unggah/hapus per outlet
berdasarkan izin `products.manage`.

**Frontend**:

- Beranda: transaksi, omzet, laba kotor, pengeluaran hari ini; transaksi
  terakhir (jam WITA, metode bayar, status batal); stok menipis; pintasan
  sesuai izin; diperbarui otomatis tiap 60 detik.
- Produk: daftar mirip referensi (foto, kategori, SKU, harga/satuan, HPP
  hanya untuk `cost.view`, badge stok aman/menipis/habis), pencarian nama/SKU,
  filter kategori & status; form tambah/edit dengan validasi Zod, input angka
  format Indonesia ("2.000", "148,5"), SKU otomatis, unggah foto, stok awal
  dicatat sebagai pergerakan (stok tidak dapat diedit dari form), nonaktifkan
  (bukan hapus); kelola kategori.
- Input angka: uang memakai titik ribuan & koma desimal; volume menerima
  koma atau titik sebagai desimal (maks. 3 angka).

**Hasil uji Fase 3**

- Tes database: **59 lulus** (8 baru: dashboard per peran, kategori lintas
  outlet, policy foto).
- Unit/komponen: **74 lulus** (41 baru), tanpa peringatan `act`. Klien
  Supabase palsu kini berupa backend kecil di memori sehingga fungsi API
  sungguhan ikut teruji dari UI.
- Browser (Chromium, respons Supabase disimulasikan lewat intersepsi
  jaringan Playwright): Beranda, Produk, dan form di 1280×800 dan 390×844 —
  0 error console, tanpa overflow horizontal. Perbaikan dari pemeriksaan
  visual: field pertama yang salah kini difokuskan, tombol form menempel di
  bawah, filter ponsel dibuat dua kolom.
- Belum: uji terhadap PostgREST/Supabase sungguhan. Pemasangan PostgREST
  lokal ditolak oleh pengaman otomatis lingkungan pengembangan.

## Catatan Fase 4

**Database** (`0500_stock`): `get_stock_movements` (riwayat dengan nama
produk, pengguna, nomor transaksi; filter produk/jenis/tanggal WITA; paging;
ringkasan per jenis) dan `get_stock_summary` (produk aktif, menipis, habis,
nilai persediaan; nilai HPP hanya untuk `cost.view`, stok minus tidak
menambah nilai). Perubahan stok tetap hanya lewat `adjust_stock`,
`create_sale`, `void_transaction`.

**Frontend** (`/stok`): kartu ringkasan; tab Daftar Stok (cari, filter
menipis/habis, tombol Masuk/Keluar/Opname/Riwayat per produk) dan Riwayat
Pergerakan (filter produk, jenis, tanggal; jumlah bertanda; stok sebelum →
sesudah; pengguna; nomor transaksi; jam WITA; "muat lebih banyak"). Dialog
penyesuaian: pilihan Masuk/Keluar/Opname, pratinjau stok sesudah (dengan
peringatan bila minus), alasan cepat, alasan wajib untuk keluar/opname,
validasi satuan bulat, blokir saat offline. **Satu idempotency key per
pengisian dialog**: klik ganda atau kirim ulang setelah gangguan jaringan
tidak menggandakan stok. Tombol riwayat di halaman Produk membuka riwayat
produk tersebut.

**Hasil uji Fase 4**

- Tes database: **65 lulus** (6 baru, termasuk konsistensi rantai
  stok_sebelum/stok_sesudah di seluruh jenis pergerakan).
- Unit/komponen: **88 lulus** (14 baru, termasuk kirim ulang dengan kunci
  yang sama setelah error jaringan).
- Browser (tablet & ponsel, respons Supabase disimulasikan): 0 error console,
  tanpa overflow. Perbaikan dari pemeriksaan visual: pencarian & filter
  ditumpuk di ponsel, label tanggal terlihat, gaya fokus tab.

## Catatan Fase 5

**Database** (`0600_transactions`): `get_transactions` (riwayat dengan filter
tanggal WITA, status, metode, pencarian nomor/produk/pelanggan; kasir hanya
miliknya; omzet hanya transaksi selesai) dan `get_transaction_detail` (data
struk: item, pembayaran, outlet, kasir, footer dari pengaturan
`receipt_footer`; laba hanya untuk `profit.view`; transaksi orang lain dijawab
"tidak ditemukan"). Penyimpanan tetap oleh `create_sale` (0300).

**Kasir** (`/kasir`): katalog (cari, kategori, A–Z/Z–A, penanda jumlah di
keranjang, stok habis), dialog jumlah dengan tombol cepat (1–50 ml) dan input
desimal, diskon item, keranjang (+/−, ubah, hapus, kosongkan), diskon
transaksi, nama pelanggan, pembayaran Tunai/QRIS/Transfer/E-wallet/Lainnya,
uang diterima + nominal cepat + kembalian, nomor referensi non-tunai. Tablet:
keranjang di samping; ponsel: bar keranjang + dialog.

Keamanan transaksi di UI:

- Keranjang dikosongkan dan struk ditampilkan **hanya setelah server
  mengonfirmasi**; struk diambil dari database, bukan dari keranjang.
- Kunci idempotensi per isi keranjang: bila respons hilang (koneksi putus
  setelah server menyimpan), "Coba lagi" mengembalikan transaksi yang sama.
  Pesan menegaskan transaksi BELUM dipastikan tersimpan.
- Offline: tombol bayar nonaktif; tidak ada antrean transaksi lokal.
- Validasi stok di dialog (kecuali stok minus diizinkan); keputusan akhir
  tetap di database.

**Struk**: lebar 58 mm, cetak lewat dialog cetak browser. Salinan cetak
dirender langsung di `<body>` agar tidak terpotong/tergeser dialog.
Cetak ulang dari Riwayat Transaksi diberi tanda "CETAK ULANG".

**Riwayat Transaksi** (`/transaksi`): filter tanggal (default hari ini WITA),
status, metode, pencarian; ringkasan jumlah & omzet; detail + struk; cetak
ulang; pembatalan dengan alasan wajib (stok dikembalikan, transaksi tetap
tersimpan).

**Hasil uji Fase 5**

- Tes database: **69 lulus** (4 baru).
- Unit/komponen: **107 lulus** (19 baru): penjualan 10 ml tunai (kembalian
  Rp30.000, stok 297 ml, HPP Rp10.140, laba Rp9.860), 5 ml QRIS, diskon,
  uang kurang, desimal, stok tidak cukup dari server, respons hilang + coba
  lagi (1 transaksi), offline, riwayat, cetak ulang, pembatalan.
- Browser (tablet & ponsel, respons Supabase disimulasikan): alur kasir →
  bayar → struk → riwayat; 0 error console; tanpa overflow. Perbaikan dari
  pemeriksaan visual: posisi struk saat dicetak, ruang bawah katalog ponsel.
- Catatan printer: cetak memakai dialog cetak sistem. Printer thermal
  Bluetooth di Android memerlukan aplikasi layanan cetak (mis. RawBT);
  cetak ESC/POS langsung belum termasuk.

## Catatan Fase 6

**Database** (`0700_reports_expenses`): `get_expenses` (daftar + total per
kategori, nama pencatat, `can_manage`), `get_my_cash_session` (sesi kas
terbuka dengan kas seharusnya dihitung langsung) dan `get_cash_sessions`
(daftar sesi untuk closing). Laporan memakai `get_sales_report` (0300).
Pengeluaran ditulis langsung ke tabel dengan RLS (`expenses.manage`),
soft delete, dan audit otomatis.

**Laporan** (`/laporan`, mengikuti screenshot referensi): Harian / 7 Hari /
30 Hari / Bulanan / Rentang (tanggal WITA), cakupan outlet aktif atau semua
outlet (owner), sakelar "Masukkan pengeluaran", kartu Transaksi / Penjualan /
Laba, ringkasan (omzet, kas masuk tunai, rata-rata, diskon, terjual per
satuan, HPP, laba kotor, pengeluaran, laba bersih), metode pembayaran,
produk terlaris, produk laba terbesar, perbandingan outlet. Tanpa
`profit.view`, HPP/laba tidak dikirim server maupun ditampilkan.
Kasir dengan `closing.perform` hanya melihat kartu sesi kas.

**Closing**: buka kas (kas awal) dari halaman Kasir atau Laporan; tutup kas
dengan hitung kas fisik → selisih. "Cetak Laporan Closing" membuat PDF berisi
ringkasan, metode bayar, produk, pengeluaran per kategori, dan sesi kas.

**Export**: PDF (jsPDF + autotable, A4, header hitam-kuning, nomor halaman)
dan Excel (.xlsx). Pustaka dimuat hanya saat tombol export ditekan. Teks PDF
disanitasi untuk font standar (mis. "−" → "-").

**Pengeluaran** (`/pengeluaran`): filter Harian/Bulanan/Rentang + kategori,
total & per kategori, catat/ubah/hapus (soft delete dengan konfirmasi),
mode hanya-baca untuk `expenses.view`, blokir saat offline.

**Keamanan dependensi**: `npm audit --omit=dev` = 0 kerentanan. Dalam fase
ini jspdf dinaikkan ke 4.2.1, zod 3 → 4.6.7 (memperbaiki kerentanan
memory exhaustion; seluruh validasi tetap lulus uji), write-excel-file 4.1.1
(tanpa dependensi archiver/glob).

**Hasil uji Fase 6**

- Tes database: **75 lulus** (6 baru).
- Unit/komponen: **131 lulus** (24 baru), tanpa peringatan `act`.
- Browser (tablet & ponsel, respons Supabase disimulasikan): Laporan,
  Pengeluaran, PDF closing diunduh lalu dirender dengan pdftoppm (2 halaman,
  semua tabel benar), Excel diunduh. Perbaikan dari pemeriksaan: halaman
  Laporan meluap horizontal di ponsel (kolom grid & tab periode).
- Catatan untuk Fase 8: bundle utama ~1 MB (gzip ~290 KB), terutama
  react-dom, supabase-js, react-router, dan zod 4. Akan dipecah per halaman.

## Catatan Fase 7

**Database** (`0800_staff_outlets_settings`): `can_manage_staff`,
`can_manage_user`, `assign_outlet_user`, `set_staff_active`,
`update_staff_name`, `list_staff`, `get_audit_logs`, `get_settings`,
`set_setting` (daftar kunci yang diizinkan; stok minus hanya owner; footer
struk ≤ 200 karakter), trigger kode outlet terkunci setelah dipakai pada
transaksi, penjaga profil diperbarui (admin boleh mengubah nama kasirnya,
tidak boleh mengubah status/username).

Aturan anti-eskalasi (diuji): admin tidak bisa memberi peran admin, izin di
luar "closing kas"/"lihat semua transaksi", mengubah diri sendiri, mengubah
admin lain/owner, atau mengelola outlet lain.

**Edge Function** `supabase/functions/admin-users`: `create_staff`,
`reset_password`, `set_active`. Logika di `handler.ts` (tanpa dependensi
Deno, diuji 7 tes), `index.ts` hanya penghubung Deno. Otorisasi selalu lewat
fungsi DB sebagai pemanggil; bila penugasan outlet gagal setelah akun Auth
dibuat, akun dihapus kembali. Nonaktifkan akun = profil nonaktif (semua akses
data hilang) + blokir login di Auth.

**Frontend**: Karyawan (daftar, tambah via username, atur akses per outlet
dengan centang izin efektif, reset sandi, nonaktifkan; tab Aktivitas berisi
riwayat audit), Outlet (kartu per outlet: omzet & laba hari ini, stok
menipis/habis, tambah/ubah, logo, pindah outlet aktif), Pengaturan (akun
saya: nama & kata sandi; pesan struk; izin stok minus). Halaman sementara
"sedang dibangun" dihapus — ke-10 halaman wajib sudah nyata.

**Hasil uji Fase 7**

- Tes database: **86 lulus** (11 baru).
- Unit/komponen + Edge Function: **152 lulus** (21 baru). Tes UI memanggil
  handler Edge Function yang sebenarnya lewat backend palsu.
- Browser (tablet & ponsel): Karyawan, dialog Tambah, Outlet, Pengaturan —
  0 error console, tanpa overflow.
- **Belum diuji**: `index.ts` di runtime Deno/Supabase (Deno tidak tersedia di
  lingkungan pengembangan). Wajib dicoba setelah `supabase functions deploy`.

## Status 22 pengujian wajib

| # | Pengujian | Status | Lokasi |
|---|---|---|---|
| 1 | Login & logout | ✅ UI (klien Supabase palsu) — perlu verifikasi di Supabase nyata | `src/features/auth/auth.test.tsx` |
| 2 | Role pengguna | ✅ DB + UI (termasuk aturan anti-eskalasi pengelolaan karyawan) | `tests/db/security.test.ts`, `auth.test.tsx` |
| 3 | Tambah produk | ✅ DB + UI | `tests/db/products-stock.test.ts`, `products-page.test.tsx` |
| 4 | Edit produk | ✅ DB + UI | 〃 |
| 5 | Hapus/nonaktifkan produk | ✅ DB + UI | 〃 |
| 6 | Stok masuk | ✅ DB + UI | `products-stock.test.ts`, `stock.test.ts`, `stock-page.test.tsx` |
| 7 | Stok keluar | ✅ DB + UI | 〃 |
| 8 | Penjualan 5 ml | ✅ DB + unit + UI | `tests/db/sales.test.ts`, `sale-calc.test.ts` |
| 9 | Penjualan 10 ml | ✅ DB + unit + UI | 〃 + `pos-page.test.tsx` |
| 10 | Penjualan dengan diskon | ✅ DB + unit + UI | 〃 |
| 11 | Pembayaran tunai | ✅ DB + UI | `tests/db/sales.test.ts` |
| 12 | Pembayaran QRIS | ✅ DB + UI | 〃 |
| 13 | Perhitungan kembalian | ✅ DB + unit + UI | 〃 |
| 14 | Perhitungan HPP | ✅ DB + unit | 〃 |
| 15 | Perhitungan laba | ✅ DB + unit + UI | `tests/db/reports.test.ts` |
| 16 | Closing harian | ✅ DB (sesi kas) + UI (buka/tutup kas, PDF closing) | `tests/db/reports.test.ts` |
| 17 | Export PDF | ✅ file PDF dibuat & diperiksa isinya; diunduh dari browser dan dirender ke gambar | `export.test.ts`, `reports-page.test.tsx` |
| 18 | Export Excel | ✅ file .xlsx dibuat, dibuka ulang (zip) dan diperiksa isinya | `export.test.ts`, `reports-page.test.tsx` |
| 19 | Pembatasan akses outlet | ✅ DB + UI (termasuk outlet/penugasan nonaktif) | `tests/db/security.test.ts` |
| 20 | Pencegahan transaksi ganda | ✅ DB (10 permintaan paralel) + UI (coba lagi setelah respons hilang) | `tests/db/sales.test.ts` |
| 21 | Internet terputus | ✅ indikator, tombol bayar nonaktif, tidak ada klaim sukses | `app-shell.test.tsx`, `pos-page.test.tsx` |
| 22 | Instalasi PWA | ⏳ Fase 8 | – |

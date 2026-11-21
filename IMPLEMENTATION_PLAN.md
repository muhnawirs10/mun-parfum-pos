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
| 2 | Migration database, Supabase Auth, RLS, peran & izin, RPC atomik, tes database | ⏳ Berikutnya |
| 3 | Dashboard (data nyata) & manajemen produk (CRUD, SKU otomatis, foto) | – |
| 4 | Stok masuk/keluar/opname & riwayat pergerakan | – |
| 5 | Kasir, keranjang, diskon, pembayaran, kembalian, struk, riwayat & void | – |
| 6 | Laporan keuangan, closing harian, pengeluaran, export PDF & Excel | – |
| 7 | Multi-outlet, manajemen karyawan (Edge Function), pengaturan | – |
| 8 | PWA (manifest, service worker, ikon, install prompt), optimasi tablet | – |
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

# Keamanan MUN PARFUM POS

Dokumen ini merangkum model ancaman, kontrol keamanan, hasil audit Fase 9,
dan risiko yang tersisa.

## Model ancaman (ringkas)

| Ancaman | Contoh | Kontrol utama |
|---|---|---|
| Karyawan melihat data sensitif | kasir membaca HPP/laba lewat API | column privilege + view berizin + RPC laporan menyembunyikan laba |
| Karyawan menaikkan hak | admin memberi dirinya izin laba / menjadi owner | `can_manage_staff`, `assign_outlet_user`, trigger profil, Edge Function memeriksa DB sebagai pemanggil |
| Akses lintas outlet | kasir MKS menjual/membaca data TKL | RLS `has_outlet_access`/`has_permission`, FK komposit `(product_id, outlet_id)` |
| Manipulasi stok/transaksi | ubah `current_stock`, hapus transaksi | tidak ada hak tulis langsung; trigger penjaga; riwayat permanen |
| Transaksi ganda | klik ganda, retry jaringan | idempotency key + advisory lock di `create_sale` |
| Kebocoran rahasia | service_role di frontend | hanya anon key di frontend; `check:secrets` di CI; service_role hanya di Edge Function |
| XSS / injeksi | nama produk berisi script, URL `javascript:` | React escaping, tanpa `dangerouslySetInnerHTML`/`eval`, CSP ketat, constraint URL http(s) |
| Formula injection Excel | nama produk `=HYPERLINK(...)` | sel ditulis sebagai teks (diuji) |
| Clickjacking | aplikasi dibingkai situs lain | `frame-ancestors 'none'`, `X-Frame-Options: DENY` |
| Data basi / transaksi offline palsu | SW menyajikan data lama | data Supabase `NetworkOnly`; tidak ada antrean transaksi lokal |

## Kontrol yang diterapkan

**Database (sumber kebenaran)**
- RLS aktif di semua 14 tabel; `anon` tidak punya hak apa pun.
- Klien tidak punya INSERT/UPDATE/DELETE pada `products`, `transactions`,
  `transaction_items`, `payments`, `stock_movements`, `cash_sessions`,
  `audit_logs`, `outlet_counters`; perubahan hanya lewat RPC yang memeriksa izin.
- Semua fungsi `SECURITY DEFINER` memakai `search_path = ''`.
- Fungsi `private.*` tidak dapat dieksekusi klien; default privileges
  menutup fungsi baru.
- HPP/laba: column privilege dicabut; dibaca lewat 3 view `security_barrier`
  yang memfilter `has_permission(...)` (sengaja *security definer*).
- Trigger: stok hanya berubah via pergerakan; transaksi/item/pembayaran/
  pergerakan/audit tidak dapat dihapus/diubah; kode outlet terkunci setelah
  dipakai; profil hanya owner yang mengubah status/username.
- Audit log otomatis untuk produk, transaksi, void, stok, pengeluaran,
  penugasan, outlet, pengaturan, sesi kas.

**Edge Function `admin-users`**
- Memerlukan JWT pengguna; setiap aksi diotorisasi fungsi DB **sebagai
  pemanggil**; akun Auth dibatalkan bila penugasan gagal.
- `service_role` hanya dari secret server; opsi `ALLOWED_ORIGINS` untuk CORS.

**Frontend & hosting**
- Hanya anon key; validasi input Zod; React escaping; tanpa pola XSS.
- CSP ketat dari satu sumber (`scripts/security-headers.cjs`):
  `script-src 'self'` (tanpa `unsafe-inline`/`unsafe-eval`), `object-src 'none'`,
  `frame-ancestors 'none'`, `connect-src` hanya Supabase; plus `nosniff`,
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP.
- Service worker tidak pernah melayani data Supabase dari cache.

## Hasil audit Fase 9

| Pemeriksaan | Hasil |
|---|---|
| Audit katalog DB (`tests/db/security-audit.test.ts`, 10 tes) | ✅ setelah perbaikan |
| Serangan API langsung dengan token kasir (E2E) | ✅ semua ditolak (403) |
| Isolasi outlet lewat API (E2E) | ✅ |
| E2E di bawah CSP produksi | ✅ 0 pelanggaran CSP |
| Rahasia di bundle (`npm run check:secrets`) | ✅ tidak ada |
| Pola XSS di kode (`dangerouslySetInnerHTML`, `eval`, `innerHTML`) | ✅ tidak ada |
| Formula injection Excel | ✅ teks, bukan formula |
| `npm audit --omit=dev` (dikirim ke pengguna) | ✅ 0 kerentanan |
| `npm audit` (termasuk dev) | ⚠️ 4 sedang: `glob`/`minimatch` via `workbox-build` (alat build PWA, tidak dikirim ke pengguna) |

**Temuan & perbaikan**

1. *Sedang (defense in depth)*: `private.setting_text` dan
   `private.guard_outlet_code` masih bisa dieksekusi `PUBLIC` karena dibuat
   setelah pencabutan massal. Tidak dapat dieksploitasi (klien tanpa akses
   schema `private`). Diperbaiki di migration `0900_hardening` + default
   privileges.
2. *Rendah*: URL foto/logo menerima skema apa pun. Ditambah constraint
   `http(s)` (0900).
3. *Dependensi dev*: Vitest 3 membawa `tinypool` (kritis, RCE lewat prototype
   pollution) dan `@vitest/mocker`. Dinaikkan ke Vitest 4.1.12.
4. *Fase 6*: jspdf (kritis) dan zod (tinggi) dinaikkan ke versi aman.
5. *UX berisiko (E2E)*: karyawan baru default ke outlet pertama, bukan outlet
   aktif — diperbaiki.

## Risiko tersisa & rekomendasi

- **Belum diuji terhadap Supabase sungguhan** (GoTrue, PostgREST, Storage,
  Edge Function runtime). Jalankan `docs/UAT_CHECKLIST.md`.
- Foto produk di bucket publik (tidak rahasia, tetapi URL-nya dapat diakses siapa pun).
- Admin dengan `users.manage` dapat menambahkan kasir dari outlet lain ke
  outletnya sendiri (memberi akses ke outlet admin tersebut; tidak sebaliknya).
- `style-src 'unsafe-inline'` diperlukan pustaka UI; risiko rendah karena
  script inline tetap diblokir.
- Rekomendasi Supabase: matikan sign-up publik, panjang sandi minimal 8,
  aktifkan *leaked password protection*, MFA untuk akun pemilik, tinjau
  Security Advisor (3 view security definer di atas memang disengaja),
  aktifkan backup harian/PITR.

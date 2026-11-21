# MUN PARFUM POS

Aplikasi kasir (POS) dan inventaris untuk toko parfum isi ulang —
Web App + PWA, cloud (Supabase/PostgreSQL), multi-outlet.

- **Inventaris sederhana**: setiap varian parfum = satu produk dengan stok sendiri
  (ML, PCS, GRAM, UNIT, BOTOL; ML/GRAM mendukung desimal).
- **Penjualan atomik** di database dengan snapshot harga & HPP, idempotency key,
  dan validasi stok.
- **Keamanan** dengan Supabase Auth + Row Level Security; HPP & laba dibatasi izin.
- Bahasa Indonesia · Rupiah · zona waktu **WITA (Asia/Makassar)**.

Status fase: lihat [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).
**Belum production-ready** — semua fitur terpasang dan teruji secara lokal; pengujian terhadap project Supabase sungguhan, E2E, dan audit keamanan (Fase 9) belum dilakukan.

## Teknologi

React 19 · TypeScript · Vite 6 · Tailwind CSS 3 · komponen gaya shadcn/ui (Radix)
· Lucide · TanStack Query · Zod · Supabase (Auth, PostgreSQL, RLS, RPC) · Vitest.

## Struktur

```
src/
  components/ui/        komponen dasar (Button, Card, Input, …)
  components/layout/    AppShell, BottomNav, OfflineBanner, PageHeader
  features/auth/        AuthProvider, login, guard peran & izin
  lib/decimal.ts        aritmetika desimal BigInt (tanpa floating point)
  lib/sale-calc.ts      aturan perhitungan penjualan (identik dengan RPC)
  lib/format.ts         format Rupiah, angka, tanggal WITA
  features/             modul per fitur (pos, products, stock, reports, …)
  pwa/                  pasang aplikasi & pembaruan service worker
  pages/                beranda, lainnya, 404
supabase/migrations/    skema, keamanan/RLS, RPC
supabase/functions/     Edge Function admin-users (akun karyawan)
scripts/                ikon PWA, pemeriksaan PWA
tests/db/               tes integrasi database (RLS, RPC, perhitungan)
docs/                   setup Supabase, deployment, PWA
```

## Menjalankan secara lokal

Prasyarat: Node.js 20+.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Isi `.env.local` (lihat [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md)), lalu:

```bash
npm run dev
```

Buka <http://localhost:5173> (juga dapat diakses dari tablet di jaringan yang sama).
Tanpa `.env.local` aplikasi menampilkan layar "Konfigurasi Supabase belum diisi".

## Pengujian

Unit & komponen (tanpa database):

```bash
npm test
```

Tes integrasi database (membutuhkan PostgreSQL 15+; skema `auth` Supabase
di-stub oleh `tests/db/supabase-stub.sql`). Database `mun_pos_test` dibuat ulang setiap kali:

```bash
DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run test:db
```

Pemeriksaan PWA di Chromium (setelah `npm run build` dan `npx vite preview --port 4173`):

```bash
npm run check:pwa
```

Typecheck, lint, build:

```bash
npm run typecheck && npm run lint && npm run build
```

## Dokumentasi

- [Rencana implementasi & aturan perhitungan](IMPLEMENTATION_PLAN.md)
- [Setup Supabase](docs/SUPABASE_SETUP.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Instalasi PWA](docs/PWA_INSTALL.md)
- Edge Function: `supabase/functions/admin-users`

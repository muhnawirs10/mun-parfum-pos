# Deployment

Aplikasi adalah SPA statis (folder `dist/`) + Supabase sebagai backend.

## Build

```bash
npm ci
```

```bash
npm run test:all
```

```bash
npm run test:e2e
```

```bash
npm run build
```

## Hosting (pilih salah satu)

**Vercel** (disarankan): import repository → Framework *Vite* → isi
environment variable `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_STAFF_EMAIL_DOMAIN`. `vercel.json` sudah tersedia.

**Netlify**: build command `npm run build`, publish directory `dist`
(`_redirects` & `_headers` sudah ada di `public/`).

**Cloudflare Pages**: build `npm run build`, output `dist`. SPA fallback otomatis.

## Header keamanan & cache (sudah disiapkan)

`vercel.json` (Vercel) dan `public/_headers` + `public/_redirects` (Netlify /
Cloudflare Pages) **dihasilkan** dari `scripts/security-headers.cjs`
(`npm run headers`; tes unit memastikan selalu sinkron). Isinya:

- Content-Security-Policy ketat (script hanya dari domain sendiri, koneksi
  hanya ke `*.supabase.co`), `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy`, COOP.
- `sw.js`, `index.html`, `manifest.webmanifest`: `no-cache` (pembaruan PWA
  terdeteksi); `assets/*`: cache 1 tahun (nama ber-hash).
- SPA fallback ke `index.html`.

Bila memakai domain Supabase kustom (bukan `*.supabase.co`), tambahkan ke
`connect-src`/`img-src` di `scripts/security-headers.cjs`, lalu `npm run headers`.

Periksa setelah deploy:

```bash
curl -I https://domain-anda
```

## Wajib HTTPS

PWA (service worker, install prompt) hanya bekerja di HTTPS. Semua host di
atas menyediakan HTTPS otomatis.

## Checklist sebelum produksi

- [ ] Migration terbaru sudah di-push ke project Supabase produksi.
- [ ] Sign-up publik dimatikan.
- [ ] Hanya anon key di environment frontend.
- [ ] CI GitHub Actions hijau (lint, typecheck, unit, database, E2E, PWA, rahasia bundle).
- [ ] `docs/UAT_CHECKLIST.md` dijalankan bersama pemilik.
- [ ] Supabase *Security Advisor* ditinjau.
- [ ] Backup database harian aktif (Supabase Pro / pg_dump terjadwal).

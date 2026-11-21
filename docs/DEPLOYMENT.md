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
npm run build
```

## Hosting (pilih salah satu)

**Vercel**: import repository → Framework *Vite* → isi environment variable
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_STAFF_EMAIL_DOMAIN`.
Tambahkan `vercel.json` berisi rewrite SPA:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

**Netlify**: build command `npm run build`, publish directory `dist`,
dan file `public/_redirects` berisi `/* /index.html 200`.

**Cloudflare Pages**: build `npm run build`, output `dist`. SPA fallback otomatis.

## Header cache untuk PWA

Agar pembaruan aplikasi terdeteksi, `sw.js`, `index.html`, dan
`manifest.webmanifest` **tidak boleh** di-cache lama oleh hosting/CDN.
File di `assets/` aman di-cache permanen (nama berisi hash).

Vercel (`vercel.json`):

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [
    { "source": "/sw.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
    { "source": "/assets/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }
  ]
}
```

Netlify (`public/_headers`):

```
/sw.js
  Cache-Control: no-cache
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

## Wajib HTTPS

PWA (service worker, install prompt) hanya bekerja di HTTPS. Semua host di
atas menyediakan HTTPS otomatis.

## Checklist sebelum produksi

- [ ] Migration terbaru sudah di-push ke project Supabase produksi.
- [ ] Sign-up publik dimatikan.
- [ ] Hanya anon key di environment frontend.
- [ ] `npm run test:all` lulus.
- [ ] Supabase *Security Advisor* ditinjau.
- [ ] Backup database harian aktif (Supabase Pro / pg_dump terjadwal).

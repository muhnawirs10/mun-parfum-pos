# Instalasi PWA

MUN PARFUM POS dapat dipasang di tablet, ponsel, atau komputer seperti
aplikasi biasa: ikon di layar utama, layar pembuka (splash), dan tampilan
penuh tanpa bilah browser.

> **Penting — PWA ini bukan POS offline.** Login, membaca data, menyimpan
> transaksi, mengubah stok, dan laporan tetap memerlukan internet. Yang
> disimpan di perangkat hanya file tampilan aplikasi (agar cepat dibuka).
> Saat offline, aplikasi menampilkan banner peringatan dan tombol bayar
> dinonaktifkan; tidak ada transaksi yang disimpan diam-diam di perangkat.

Syarat: aplikasi dibuka lewat **HTTPS** (semua hosting di
`docs/DEPLOYMENT.md` sudah HTTPS).

## Android (Chrome) — disarankan untuk tablet kasir

1. Buka alamat aplikasi di Chrome.
2. Masuk ke menu **Lainnya** → kartu **Pasang MUN PARFUM POS** → **Instal aplikasi**.
   (Alternatif: menu ⋮ Chrome → **Instal aplikasi** / **Tambahkan ke layar utama**.)
3. Buka dari ikon **MUN POS** di layar utama.

Tekan lama ikon untuk pintasan langsung ke **Kasir** atau **Laporan**.

## iPad / iPhone (Safari)

1. Buka alamat aplikasi di **Safari** (bukan Chrome di iOS).
2. Ketuk tombol **Bagikan** (kotak dengan panah ke atas).
3. Pilih **Tambahkan ke Layar Utama** → **Tambah**.

Petunjuk yang sama tampil di menu **Lainnya** saat dibuka dari Safari.

## Komputer (Chrome / Edge)

Klik ikon instal di ujung kanan bilah alamat, atau menu ⋮ → **Instal MUN PARFUM POS**.

## Pembaruan aplikasi

Saat versi baru tersedia, muncul pemberitahuan **"Versi baru MUN PARFUM POS
tersedia"**. Selesaikan transaksi yang sedang berjalan, lalu ketuk
**Perbarui**. Aplikasi tidak memperbarui diri secara otomatis agar tidak
memotong transaksi kasir. Pemeriksaan versi dilakukan saat aplikasi dibuka
dan setiap 30 menit.

## Saat koneksi terputus

- Banner hitam **"Tidak ada koneksi internet…"** tampil di semua layar.
- Tombol **Bayar** nonaktif; simpan produk/stok/pengeluaran ditolak dengan pesan jelas.
- Saat koneksi pulih, banner hijau **"Koneksi pulih"** dengan tombol **Coba lagi**
  untuk memuat ulang data.
- Jika koneksi putus tepat saat menyimpan transaksi, aplikasi menyatakan
  transaksi **belum dipastikan tersimpan** dan menyediakan **Coba lagi**, yang
  aman karena idempotency key mencegah transaksi ganda.

## Apa yang disimpan di perangkat (service worker)

| Jenis | Strategi |
|---|---|
| File aplikasi (HTML, JS, CSS, font, ikon) | Precache — cepat dibuka, tersedia offline |
| Foto produk & logo outlet (publik) | Cache, maks. 300 file / 30 hari |
| Data Supabase (`/rest`, `/auth`, `/functions`, `/realtime`) | **Selalu dari jaringan**, tidak pernah dari cache |

## Pemeriksaan otomatis

```bash
npm run build
```

```bash
npx vite preview --port 4173
```

Di terminal lain:

```bash
npm run check:pwa
```

Memeriksa manifest, ikon, service worker, status **dapat diinstal** menurut
Chrome, pemuatan aplikasi saat offline, indikator offline, dan bahwa API
tidak pernah dilayani dari cache.

## Mengganti ikon

Ubah `scripts/icon.svg`, lalu:

```bash
node scripts/generate-icons.cjs
```

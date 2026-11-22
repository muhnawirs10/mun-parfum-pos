# Setup Supabase

## 1. Buat project

1. Buka <https://supabase.com/dashboard> → **New project**.
2. Region: **Southeast Asia (Singapore)** (terdekat dengan WITA).
3. Simpan *database password* di tempat aman.

## 2. Jalankan migration

**Opsi A — Supabase CLI (disarankan)**

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <PROJECT_REF>
```

```bash
npx supabase db push
```

**Opsi B — SQL Editor**: salin isi file di `supabase/migrations/` dan jalankan
**berurutan** (0100 → 0200 → 0300).

## 3. Pengaturan Auth

Dashboard → **Authentication → Sign In / Providers**:

- **Email**: aktif.
- **Allow new users to sign up**: **MATIKAN**. Akun hanya dibuat oleh pemilik.
- **Confirm email**: boleh dimatikan untuk akun karyawan (email sintetis).
- **Password**: panjang minimal 8; aktifkan *leaked password protection*.
- Pertimbangkan **MFA** untuk akun pemilik.

## 4. Buat akun pemilik (owner)

1. Authentication → **Users → Add user → Create new user**
   - Email: email pemilik, kata sandi kuat, centang *Auto Confirm User*.
   - Opsional *User Metadata*: `{"full_name":"Nawir","username":"nawir08"}`
2. SQL Editor:

```sql
select private.bootstrap_owner('email-pemilik@contoh.com', 'TKL', 'MUN Parfum Takalar', 'Takalar');
```

Fungsi ini menjadikan user tersebut owner dan membuat outlet pertama.
`private.*` tidak dapat dipanggil dari aplikasi (hanya SQL Editor / service role).

## 5. Deploy Edge Function `admin-users` (akun karyawan)

Membuat akun karyawan butuh Supabase Auth Admin API (kunci `service_role`).
Kunci itu **hanya** ada di server Edge Function, tidak pernah di aplikasi.

```bash
npx supabase functions deploy admin-users
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY` otomatis
tersedia untuk Edge Function. Bila memakai domain email staf selain bawaan,
set juga secret berikut (harus sama dengan `VITE_STAFF_EMAIL_DOMAIN`):

```bash
npx supabase secrets set STAFF_EMAIL_DOMAIN=staff.munparfum.local
```

Batasi asal pemanggil ke domain aplikasi (disarankan di produksi):

```bash
npx supabase secrets set ALLOWED_ORIGINS=https://pos.domain-anda.id
```

Setelah itu, pemilik menambah karyawan dari menu **Karyawan → Tambah**
(username + kata sandi awal + outlet + peran + hak akses). Karyawan login
dengan username tersebut. Reset kata sandi dan nonaktifkan akun juga dari
menu yang sama.

Setiap aksi Edge Function diotorisasi oleh fungsi database **sebagai
pengguna pemanggil** (`can_manage_staff`, `can_manage_user`,
`assign_outlet_user`, `set_staff_active`):

- Pemilik: mengelola admin & kasir di semua outlet.
- Admin dengan izin "Mengelola kasir": hanya kasir di outletnya, hanya izin
  tambahan "Closing kas" dan "Melihat semua transaksi outlet".

**Alternatif manual** (tanpa Edge Function): buat user di Dashboard →
Authentication dengan email `<username>@staff.munparfum.local` dan metadata
`{"full_name":"Kasir Satu","username":"kasir1"}`, lalu tugaskan lewat menu
Karyawan → Akses, atau SQL:

```sql
insert into public.outlet_users (outlet_id, user_id, role)
select o.id, u.id, 'kasir'
from public.outlets o, auth.users u
where o.code = 'TKL' and u.email = 'kasir1@staff.munparfum.local';
```

## 6. Pengaturan bisnis

Dari aplikasi: menu **Pengaturan** (pesan bawah struk; izin stok minus khusus
pemilik) dan menu **Outlet** (tambah/ubah outlet, logo). Kode outlet tidak
dapat diubah setelah dipakai pada nomor transaksi.

## 7. Data contoh (opsional)

Jalankan `supabase/seed-example.sql` di SQL Editor.

## 8. Foto produk (Storage)

Migration `0400` otomatis membuat bucket **`product-images`** (publik,
maks. 2 MB, JPG/PNG/WEBP) beserta policy: hanya pengguna dengan izin
`products.manage` di outlet terkait yang dapat mengunggah/menghapus, dengan
path `<outlet_id>/<uuid>.<ext>`. Periksa di Dashboard → Storage.

## 9. Kunci API untuk frontend

Project Settings → **API**: salin *Project URL* dan *anon public key* ke
`.env.local`. **Jangan pernah** memakai `service_role` key di frontend.

## Catatan keamanan

- RLS aktif di semua tabel bisnis. Klien tidak punya hak INSERT/UPDATE
  langsung pada `products`, `transactions`, `stock_movements`, dll.; semua
  perubahan melalui RPC yang memeriksa izin.
- HPP dan laba tidak dapat dibaca dari tabel oleh pengguna biasa (column
  privilege). Aplikasi membacanya lewat view `product_costs`,
  `transaction_profits`, `transaction_item_profits` yang memeriksa izin.
  *Supabase Security Advisor* akan menandai ketiga view ini sebagai
  "security definer view" — ini disengaja; filter izin ada di dalam view.
- Transaksi tidak dapat dihapus (trigger), hanya dibatalkan (`void_transaction`).

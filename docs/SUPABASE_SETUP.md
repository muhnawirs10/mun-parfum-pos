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

## 5. Buat akun karyawan (sementara, sebelum Fase 7)

Karyawan login memakai **username**. Username dipetakan ke email sintetis
`<username>@staff.munparfum.local` (nilai `VITE_STAFF_EMAIL_DOMAIN`).

1. Add user → Email `kasir1@staff.munparfum.local`, kata sandi, *Auto Confirm*,
   metadata `{"full_name":"Kasir Satu","username":"kasir1"}`.
2. Tugaskan ke outlet:

```sql
insert into public.outlet_users (outlet_id, user_id, role)
select o.id, u.id, 'kasir'
from public.outlets o, auth.users u
where o.code = 'TKL' and u.email = 'kasir1@staff.munparfum.local';
```

Izin tambahan/pencabutan per orang: kolom `permissions` dan
`revoked_permissions` (lihat tabel izin di `IMPLEMENTATION_PLAN.md`).
Contoh memberi admin akses laporan laba:

```sql
update public.outlet_users set permissions = '{profit.view}'
where user_id = (select id from auth.users where email = 'admin@staff.munparfum.local');
```

## 6. Pengaturan bisnis

Izinkan stok minus untuk satu outlet (default: tidak diizinkan):

```sql
insert into public.app_settings (outlet_id, key, value)
select id, 'allow_negative_stock', 'true' from public.outlets where code = 'TKL';
```

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

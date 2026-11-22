# Setup Supabase lewat Dashboard (tanpa CLI)

Waktu: ± 15 menit. Semua file yang ditempel ada di repository ini.

## 1. Buat project

1. Buka <https://supabase.com/dashboard> → **New project**.
2. Name: `mun-parfum-pos` · Region: **Southeast Asia (Singapore)** · Plan: Free
   untuk mulai.
3. **Database password**: buat yang kuat dan simpan di password manager
   (tidak dibutuhkan aplikasi, tetapi penting untuk pemulihan).
4. Tunggu sampai status project **Healthy** (± 2 menit).

## 2. Pasang database (sekali saja)

1. Menu kiri **SQL Editor** → **New query**.
2. Buka [`supabase/setup.sql`](../supabase/setup.sql) di GitHub → tombol **Raw**
   → pilih semua → salin → tempel ke editor.
3. Klik **Run**. Hasil yang benar: *Success. No rows returned*.

> Bila muncul peringatan "potentially destructive operation", lanjutkan —
> file ini hanya membuat objek baru (aman untuk project kosong).
> Jangan dijalankan dua kali; bila perlu ulang, buat project baru.

## 3. Pengaturan Auth

**Authentication → Sign In / Providers → Email**

- **Allow new users to sign up**: **matikan** (akun hanya dibuat pemilik).
- **Minimum password length**: **8**.
- Simpan.

## 4. Buat akun pemilik

1. **Authentication → Users → Add user → Create new user**.
2. Isi email Anda dan kata sandi pemilik, centang **Auto Confirm User** → Create.
3. **SQL Editor → New query**, ganti `EMAIL-ANDA` lalu Run:

```sql
select private.bootstrap_owner('EMAIL-ANDA', 'TKL', 'MUN Parfum Takalar', 'Takalar');

update public.profiles
set full_name = 'Nawir', username = 'nawir08'
where id = (select id from auth.users where lower(email) = lower('EMAIL-ANDA'));
```

Ini menjadikan akun tersebut **pemilik** dan membuat outlet pertama **TKL**.
Pemilik login memakai **email**; karyawan nanti login memakai **username**.

## 5. Edge Function `admin-users` (untuk membuat akun karyawan)

1. Menu **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Function name: `admin-users` (persis).
3. Hapus isi contoh, lalu tempel seluruh isi
   [`supabase/functions/admin-users/standalone.ts`](../supabase/functions/admin-users/standalone.ts)
   (buka Raw di GitHub).
4. Klik **Deploy function**. Biarkan **Verify JWT** tetap aktif.

## 6. Verifikasi

**SQL Editor → New query** → tempel isi [`supabase/verify.sql`](../supabase/verify.sql)
→ Run. Semua 8 baris harus **✅**.

## 7. Kunci untuk aplikasi

**Project Settings → API Keys** (atau **Data API**):

- **Project URL** — `https://<ref>.supabase.co`
- **anon / publishable key**

Keduanya memang publik (dipakai di browser) dan aman dibagikan. **Jangan pernah**
membagikan atau memasukkan `service_role` / *secret key* ke aplikasi.

Isi ke environment variable hosting (Vercel) atau `.env.local`:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon/publishable key>
```

## 8. Opsional

- Data contoh 7 parfum: jalankan [`supabase/seed-example.sql`](../supabase/seed-example.sql).
- Setelah domain produksi ada, batasi Edge Function:
  **Edge Functions → Secrets** → tambah `ALLOWED_ORIGINS` = `https://domain-anda`.

Selanjutnya: `docs/DEPLOYMENT.md` lalu `docs/UAT_CHECKLIST.md`.

> Untuk pengembang yang memakai CLI: `docs/SUPABASE_SETUP.md`.
> File `setup.sql` & `standalone.ts` dihasilkan otomatis (`npm run setup-files`)
> dan diuji sinkron dengan migration.

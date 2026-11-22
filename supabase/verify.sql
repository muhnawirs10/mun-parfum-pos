-- =====================================================================
-- MUN PARFUM POS — VERIFIKASI SETUP
-- Jalankan di SQL Editor SETELAH setup.sql (dan setelah langkah owner).
-- Semua baris seharusnya bertanda ✅.
-- =====================================================================
with checks(urut, pemeriksaan, lulus, keterangan) as (
  values
  (1, '14 tabel aplikasi ada',
      (select count(*) from pg_tables where schemaname = 'public') >= 14,
      (select count(*) from pg_tables where schemaname = 'public')::text || ' tabel'),
  (2, 'RLS aktif di semua tabel public',
      not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
      ''),
  (3, 'Fungsi penjualan create_sale ada',
      exists (select 1 from pg_proc where proname = 'create_sale'), ''),
  (4, 'anon tidak punya hak pada tabel',
      not exists (select 1 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'), ''),
  (5, 'Trigger profil otomatis di auth.users',
      exists (select 1 from pg_trigger where tgname = 'on_auth_user_created'), ''),
  (6, 'Bucket foto product-images',
      exists (select 1 from storage.buckets where id = 'product-images'), ''),
  (7, 'Minimal 1 pemilik (owner) aktif',
      exists (select 1 from public.profiles where is_owner and is_active),
      coalesce((select string_agg(full_name, ', ') from public.profiles where is_owner), 'belum ada — jalankan langkah 4')),
  (8, 'Minimal 1 outlet aktif',
      exists (select 1 from public.outlets where is_active),
      coalesce((select string_agg(code || ' ' || name, ', ') from public.outlets), 'belum ada'))
)
select case when lulus then '✅' else '❌' end as status, pemeriksaan, keterangan
from checks order by urut;

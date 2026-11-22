-- =====================================================================
-- MUN PARFUM POS — 0900 Pengerasan keamanan (Fase 9, hasil audit)
-- =====================================================================

-- Temuan audit: fungsi private yang dibuat setelah pencabutan massal di 0300
-- (private.setting_text, private.guard_outlet_code) masih memiliki hak
-- EXECUTE bawaan untuk PUBLIC. Tidak dapat dieksploitasi karena klien tidak
-- punya USAGE pada schema private, tetapi dicabut demi defense in depth.
revoke all on all functions in schema private from public, anon, authenticated;
-- fungsi baru di masa depan tertutup secara default
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public;

-- URL gambar hanya http(s) — mencegah skema javascript:/data: tersimpan
alter table public.products
  add constraint products_image_url_http check (image_url is null or image_url ~* '^https?://[^\s]+$');
alter table public.outlets
  add constraint outlets_logo_url_http check (logo_url is null or logo_url ~* '^https?://[^\s]+$');

-- =====================================================================
-- MUN PARFUM POS — SETUP DATABASE LENGKAP (dihasilkan otomatis, jangan diedit)
-- Sumber: supabase/migrations/*.sql — regenerasi: npm run setup-files
--
-- Cara pakai: Supabase Dashboard → SQL Editor → New query → tempel SELURUH
-- isi file ini → Run. Jalankan SEKALI pada project baru yang masih kosong.
-- =====================================================================

-- ┌──────────────────────────────────────────────────────────────────
-- │ 20261121000100_core_schema.sql
-- └──────────────────────────────────────────────────────────────────
-- =====================================================================
-- MUN PARFUM POS — 0100 Skema inti
-- Simple product inventory, multi-outlet, cloud (Supabase / PostgreSQL)
--
-- Konvensi:
--   * uang      : numeric(14,2)  (tidak pernah float)
--   * volume/qty: numeric(14,3)  (mendukung desimal untuk ML/GRAM)
--   * waktu     : timestamptz; tanggal bisnis dihitung di Asia/Makassar
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------
-- Tipe enumerasi
-- ---------------------------------------------------------------------
create type public.app_role as enum ('owner', 'admin', 'kasir');
create type public.stock_unit as enum ('ML', 'PCS', 'GRAM', 'UNIT', 'BOTOL');
create type public.stock_movement_type as enum (
  'initial',      -- stok awal saat produk dibuat
  'stock_in',     -- stok masuk (pembelian/restock)
  'stock_out',    -- stok keluar non-penjualan (rusak, sampel, hilang)
  'adjustment',   -- stok opname (set ke angka hasil hitung)
  'sale',         -- penjualan
  'sale_void',    -- pengembalian stok karena transaksi dibatalkan
  'transfer_in',  -- DISIAPKAN untuk transfer antar-outlet (belum aktif)
  'transfer_out'  -- DISIAPKAN untuk transfer antar-outlet (belum aktif)
);
create type public.payment_method as enum ('cash', 'qris', 'transfer', 'ewallet', 'other');
create type public.transaction_status as enum ('completed', 'void');
create type public.expense_category as enum (
  'sewa', 'listrik', 'air', 'gaji', 'transportasi', 'perlengkapan', 'operasional', 'lainnya'
);
create type public.cash_session_status as enum ('open', 'closed');

-- ---------------------------------------------------------------------
-- updated_at otomatis
-- ---------------------------------------------------------------------
create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- profiles: 1:1 dengan auth.users
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null check (length(btrim(full_name)) between 1 and 100),
  username    text unique check (username ~ '^[a-z0-9._]{3,32}$'),
  is_owner    boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- outlets
-- ---------------------------------------------------------------------
create table public.outlets (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9]{2,6}$'),
  name        text not null check (length(btrim(name)) between 1 and 100),
  address     text,
  phone       text check (phone is null or phone ~ '^[0-9+() -]{6,20}$'),
  logo_url    text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- outlet_users: penugasan admin/kasir ke outlet + izin tambahan
-- (owner bersifat global lewat profiles.is_owner)
-- ---------------------------------------------------------------------
create table public.outlet_users (
  id                  uuid primary key default gen_random_uuid(),
  outlet_id           uuid not null references public.outlets (id) on delete restrict,
  user_id             uuid not null references public.profiles (id) on delete cascade,
  role                public.app_role not null check (role in ('admin', 'kasir')),
  permissions         text[] not null default '{}',  -- izin tambahan
  revoked_permissions text[] not null default '{}',  -- izin bawaan yang dicabut
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (outlet_id, user_id)
);
create index outlet_users_user_idx on public.outlet_users (user_id) where is_active;

-- ---------------------------------------------------------------------
-- categories (per outlet)
-- ---------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  outlet_id   uuid not null references public.outlets (id) on delete restrict,
  name        text not null check (length(btrim(name)) between 1 and 60),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, outlet_id)
);
create unique index categories_outlet_name_uq on public.categories (outlet_id, lower(name));

-- ---------------------------------------------------------------------
-- products: setiap varian parfum = satu produk dengan stok sendiri
-- ---------------------------------------------------------------------
create table public.products (
  id            uuid primary key default gen_random_uuid(),
  outlet_id     uuid not null references public.outlets (id) on delete restrict,
  category_id   uuid,
  sku           text not null check (sku ~ '^[A-Za-z0-9._-]{1,32}$'),
  name          text not null check (length(btrim(name)) between 1 and 120),
  description   text check (description is null or length(description) <= 1000),
  image_url     text,
  unit          public.stock_unit not null default 'ML',
  sell_price    numeric(14,2) not null check (sell_price >= 0),
  cost_price    numeric(14,2) not null default 0 check (cost_price >= 0),
  current_stock numeric(14,3) not null default 0,
  min_stock     numeric(14,3) not null default 0 check (min_stock >= 0),
  is_active     boolean not null default true,
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (outlet_id, sku),
  unique (id, outlet_id),
  foreign key (category_id, outlet_id) references public.categories (id, outlet_id),
  -- satuan non-desimal harus berupa bilangan bulat
  check (unit in ('ML', 'GRAM') or current_stock = trunc(current_stock)),
  check (unit in ('ML', 'GRAM') or min_stock = trunc(min_stock))
);
create index products_outlet_active_idx on public.products (outlet_id, is_active, name);
create index products_category_idx on public.products (category_id);

-- ---------------------------------------------------------------------
-- Penghitung per outlet (SKU, nomor transaksi). Diakses hanya oleh RPC.
-- ---------------------------------------------------------------------
create table public.outlet_counters (
  outlet_id   uuid not null references public.outlets (id) on delete cascade,
  counter_key text not null,
  value       bigint not null default 0,
  primary key (outlet_id, counter_key)
);

-- ---------------------------------------------------------------------
-- cash_sessions: buka/tutup kas (closing)
-- ---------------------------------------------------------------------
create table public.cash_sessions (
  id              uuid primary key default gen_random_uuid(),
  outlet_id       uuid not null references public.outlets (id) on delete restrict,
  opened_by       uuid not null references public.profiles (id),
  opened_at       timestamptz not null default now(),
  opening_cash    numeric(14,2) not null default 0 check (opening_cash >= 0),
  status          public.cash_session_status not null default 'open',
  closed_by       uuid references public.profiles (id),
  closed_at       timestamptz,
  expected_cash   numeric(14,2),
  counted_cash    numeric(14,2) check (counted_cash is null or counted_cash >= 0),
  cash_difference numeric(14,2),
  note            text check (note is null or length(note) <= 500),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((status = 'open') = (closed_at is null))
);
create unique index cash_sessions_one_open_uq on public.cash_sessions (outlet_id, opened_by) where status = 'open';

-- ---------------------------------------------------------------------
-- transactions (header penjualan). Tidak pernah dihapus; batal = void.
-- ---------------------------------------------------------------------
create table public.transactions (
  id                  uuid primary key default gen_random_uuid(),
  outlet_id           uuid not null references public.outlets (id) on delete restrict,
  number              text not null unique,                -- MP-TKL-20261121-0001
  business_date       date not null,                       -- tanggal WITA
  cashier_id          uuid not null references public.profiles (id),
  cash_session_id     uuid references public.cash_sessions (id),
  status              public.transaction_status not null default 'completed',
  customer_name       text check (customer_name is null or length(customer_name) <= 100),
  note                text check (note is null or length(note) <= 500),
  subtotal            numeric(14,2) not null default 0 check (subtotal >= 0),         -- Σ total item
  item_discount_total numeric(14,2) not null default 0 check (item_discount_total >= 0),
  discount_amount     numeric(14,2) not null default 0 check (discount_amount >= 0),  -- diskon transaksi
  total               numeric(14,2) not null default 0 check (total >= 0),            -- omzet
  cost_total          numeric(14,2) not null default 0 check (cost_total >= 0),       -- HPP
  gross_profit        numeric(14,2) not null default 0,
  item_count          integer not null default 0 check (item_count >= 0),
  payment_method      public.payment_method not null,
  amount_paid         numeric(14,2) not null default 0 check (amount_paid >= 0),
  change_amount       numeric(14,2) not null default 0 check (change_amount >= 0),
  idempotency_key     uuid not null unique,
  voided_at           timestamptz,
  voided_by           uuid references public.profiles (id),
  void_reason         text check (void_reason is null or length(void_reason) <= 500),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (total = subtotal - discount_amount),
  check (gross_profit = total - cost_total),
  check ((status = 'void') = (voided_at is not null))
);
create index transactions_outlet_date_idx on public.transactions (outlet_id, business_date, status);
create index transactions_cashier_idx on public.transactions (cashier_id, created_at desc);
create index transactions_session_idx on public.transactions (cash_session_id);

-- ---------------------------------------------------------------------
-- transaction_items: snapshot harga & HPP saat transaksi
-- ---------------------------------------------------------------------
create table public.transaction_items (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references public.transactions (id) on delete restrict,
  outlet_id       uuid not null references public.outlets (id) on delete restrict,
  product_id      uuid not null,
  product_name    text not null,
  sku             text not null,
  unit            public.stock_unit not null,
  quantity        numeric(14,3) not null check (quantity > 0),
  unit_price      numeric(14,2) not null check (unit_price >= 0),
  unit_cost       numeric(14,2) not null check (unit_cost >= 0),
  subtotal        numeric(14,2) not null check (subtotal >= 0),   -- round(price × qty, 0)
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  total           numeric(14,2) not null check (total >= 0),
  cost_total      numeric(14,2) not null check (cost_total >= 0), -- round(cost × qty, 2)
  gross_profit    numeric(14,2) not null,
  created_at      timestamptz not null default now(),
  foreign key (product_id, outlet_id) references public.products (id, outlet_id),
  check (total = subtotal - discount_amount),
  check (gross_profit = total - cost_total)
);
create index transaction_items_trx_idx on public.transaction_items (transaction_id);
create index transaction_items_product_idx on public.transaction_items (product_id);

-- ---------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------
create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references public.transactions (id) on delete restrict,
  outlet_id       uuid not null references public.outlets (id) on delete restrict,
  method          public.payment_method not null,
  amount          numeric(14,2) not null check (amount >= 0),          -- dialokasikan ke total
  amount_received numeric(14,2) not null check (amount_received >= 0), -- uang diterima
  change_amount   numeric(14,2) not null default 0 check (change_amount >= 0),
  reference       text check (reference is null or length(reference) <= 100),
  created_at      timestamptz not null default now(),
  check (amount_received - amount = change_amount)
);
create index payments_trx_idx on public.payments (transaction_id);

-- ---------------------------------------------------------------------
-- stock_movements: SEMUA perubahan stok tercatat di sini (append-only)
-- ---------------------------------------------------------------------
create table public.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  outlet_id       uuid not null references public.outlets (id) on delete restrict,
  product_id      uuid not null,
  movement_type   public.stock_movement_type not null,
  quantity        numeric(14,3) not null check (quantity <> 0),  -- bertanda: + masuk, − keluar
  stock_before    numeric(14,3) not null,
  stock_after     numeric(14,3) not null,
  reason          text check (reason is null or length(reason) <= 500),
  transaction_id  uuid references public.transactions (id) on delete restrict,
  idempotency_key uuid unique,
  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  foreign key (product_id, outlet_id) references public.products (id, outlet_id),
  check (stock_after = stock_before + quantity)
);
create index stock_movements_product_idx on public.stock_movements (product_id, created_at desc);
create index stock_movements_outlet_idx on public.stock_movements (outlet_id, created_at desc);
create index stock_movements_trx_idx on public.stock_movements (transaction_id);

-- ---------------------------------------------------------------------
-- expenses: pengeluaran operasional (soft delete)
-- ---------------------------------------------------------------------
create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  outlet_id     uuid not null references public.outlets (id) on delete restrict,
  expense_date  date not null,
  category      public.expense_category not null,
  amount        numeric(14,2) not null check (amount > 0),
  description   text check (description is null or length(description) <= 500),
  created_by    uuid not null references public.profiles (id),
  deleted_at    timestamptz,
  deleted_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index expenses_outlet_date_idx on public.expenses (outlet_id, expense_date) where deleted_at is null;

-- ---------------------------------------------------------------------
-- audit_logs (append-only)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  outlet_id   uuid references public.outlets (id) on delete set null,
  user_id     uuid references public.profiles (id) on delete set null,
  action      text not null,
  entity      text not null,
  entity_id   uuid,
  details     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index audit_logs_outlet_idx on public.audit_logs (outlet_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity, entity_id);

-- ---------------------------------------------------------------------
-- app_settings: global (outlet_id null) atau per outlet
-- ---------------------------------------------------------------------
create table public.app_settings (
  id          uuid primary key default gen_random_uuid(),
  outlet_id   uuid references public.outlets (id) on delete cascade,
  key         text not null check (key ~ '^[a-z0-9_.]{2,64}$'),
  value       jsonb not null,
  updated_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique nulls not distinct (outlet_id, key)
);

-- ---------------------------------------------------------------------
-- Trigger updated_at
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','outlets','outlet_users','categories','products',
                           'cash_sessions','transactions','expenses','app_settings']
  loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

-- ┌──────────────────────────────────────────────────────────────────
-- │ 20261121000200_security.sql
-- └──────────────────────────────────────────────────────────────────
-- =====================================================================
-- MUN PARFUM POS — 0200 Keamanan: peran, izin, integritas, RLS, audit
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Profil otomatis saat user Supabase Auth dibuat
-- ---------------------------------------------------------------------
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_username text := lower(nullif(btrim(new.raw_user_meta_data ->> 'username'), ''));
begin
  insert into public.profiles (id, full_name, username)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1), 'Pengguna'),
    v_username
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------
-- 2. Fungsi izin. SECURITY DEFINER agar dapat dipakai di dalam policy
--    tanpa rekursi RLS. search_path dikosongkan (anti hijacking).
-- ---------------------------------------------------------------------
create function public.role_default_permissions(p_role public.app_role)
returns text[] language sql immutable set search_path = '' as $$
  select case p_role
    when 'owner' then array[
      'pos.sell','transactions.view_all','transactions.void','products.manage','stock.manage',
      'cost.view','profit.view','reports.view','expenses.view','expenses.manage',
      'closing.perform','users.manage','settings.manage','audit.view']
    when 'admin' then array[
      'pos.sell','transactions.view_all','transactions.void','products.manage','stock.manage',
      'cost.view','reports.view','closing.perform']
    when 'kasir' then array['pos.sell']
  end
$$;

create function public.all_permissions() returns text[]
language sql immutable set search_path = '' as $$
  select public.role_default_permissions('owner')
$$;

create function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_owner and is_active
  )
$$;

create function public.has_outlet_access(p_outlet_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_owner() or exists (
    select 1
    from public.outlet_users ou
    join public.profiles p on p.id = ou.user_id
    join public.outlets o on o.id = ou.outlet_id
    where ou.outlet_id = p_outlet_id and ou.user_id = auth.uid()
      and ou.is_active and p.is_active and o.is_active
  )
$$;

create function public.has_permission(p_outlet_id uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_owner() or exists (
    select 1
    from public.outlet_users ou
    join public.profiles p on p.id = ou.user_id
    join public.outlets o on o.id = ou.outlet_id
    where ou.outlet_id = p_outlet_id and ou.user_id = auth.uid()
      and ou.is_active and p.is_active and o.is_active
      and (p_permission = any (public.role_default_permissions(ou.role)) or p_permission = any (ou.permissions))
      and not (p_permission = any (ou.revoked_permissions))
  )
$$;

-- Ringkasan akses pengguna saat ini untuk UI (bukan sumber keamanan).
create function public.my_access()
returns table (outlet_id uuid, outlet_code text, outlet_name text, role public.app_role, permissions text[])
language sql stable security definer set search_path = '' as $$
  select o.id, o.code, o.name, 'owner'::public.app_role, public.all_permissions()
  from public.outlets o
  where public.is_owner() and o.is_active
  union all
  select o.id, o.code, o.name, ou.role,
         array(select unnest(public.role_default_permissions(ou.role) || ou.permissions)
               except select unnest(ou.revoked_permissions))
  from public.outlet_users ou
  join public.outlets o on o.id = ou.outlet_id
  join public.profiles p on p.id = ou.user_id
  where not public.is_owner() and ou.user_id = auth.uid()
    and ou.is_active and o.is_active and p.is_active
$$;

-- Validasi isi permissions di outlet_users
create function private.validate_outlet_user() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not (new.permissions <@ public.all_permissions()) or not (new.revoked_permissions <@ public.all_permissions()) then
    raise exception 'Izin tidak dikenal' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger validate_outlet_user before insert or update on public.outlet_users
  for each row execute function private.validate_outlet_user();

-- ---------------------------------------------------------------------
-- 3. Penjaga integritas
-- ---------------------------------------------------------------------

-- Stok hanya boleh berubah lewat private.apply_stock_change (yang selalu
-- menulis stock_movements). Penanda transaction-local 'app.stock_write'.
create function private.guard_product_stock() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.stock_write', true), '') <> 'on' then
    if tg_op = 'INSERT' and new.current_stock <> 0 then
      raise exception 'Stok awal harus dicatat melalui pergerakan stok' using errcode = '42501';
    elsif tg_op = 'UPDATE' and new.current_stock is distinct from old.current_stock then
      raise exception 'Stok tidak boleh diubah tanpa catatan pergerakan stok' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger guard_product_stock before insert or update on public.products
  for each row execute function private.guard_product_stock();

-- Tabel append-only / tanpa hapus permanen
create function private.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Operasi % pada % tidak diizinkan (riwayat bersifat permanen)', tg_op, tg_table_name
    using errcode = '42501';
end $$;

create trigger no_delete before delete on public.transactions for each row execute function private.forbid_change();
create trigger no_change before update or delete on public.transaction_items for each row execute function private.forbid_change();
create trigger no_change before update or delete on public.payments for each row execute function private.forbid_change();
create trigger no_change before update or delete on public.stock_movements for each row execute function private.forbid_change();
create trigger no_change before update or delete on public.audit_logs for each row execute function private.forbid_change();
create trigger no_delete before delete on public.expenses for each row execute function private.forbid_change();

-- Transaksi hanya boleh diubah oleh RPC (penanda 'app.trx_write').
create function private.guard_transaction_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.trx_write', true), '') <> 'on' then
    raise exception 'Transaksi hanya dapat diubah melalui fungsi resmi' using errcode = '42501';
  end if;
  if old.status = 'void' then
    raise exception 'Transaksi yang sudah dibatalkan tidak dapat diubah' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_transaction_update before update on public.transactions
  for each row execute function private.guard_transaction_update();

-- Profil: pengguna biasa hanya boleh mengubah nama sendiri
create function private.guard_profile_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and not public.is_owner() then
    if new.is_owner is distinct from old.is_owner or new.is_active is distinct from old.is_active
       or new.username is distinct from old.username or new.id <> auth.uid() then
      raise exception 'Tidak diizinkan mengubah data akun ini' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger guard_profile_update before update on public.profiles
  for each row execute function private.guard_profile_update();

-- ---------------------------------------------------------------------
-- 4. Audit log
-- ---------------------------------------------------------------------
create function private.log_audit(
  p_outlet_id uuid, p_action text, p_entity text, p_entity_id uuid, p_details jsonb default '{}'
) returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (outlet_id, user_id, action, entity, entity_id, details)
  values (p_outlet_id, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'));
$$;

-- Audit generik untuk tabel yang ditulis langsung lewat RLS
create function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_outlet uuid := case when tg_table_name = 'outlets' then (v_row ->> 'id')::uuid
                        else (v_row ->> 'outlet_id')::uuid end;
begin
  perform private.log_audit(
    v_outlet, lower(tg_op), tg_table_name, (v_row ->> 'id')::uuid,
    jsonb_strip_nulls(jsonb_build_object('old', v_old, 'new', v_new))
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['outlets','outlet_users','categories','expenses','app_settings']
  loop
    execute format('create trigger audit_row after insert or update or delete on public.%I
                    for each row execute function private.audit_row()', t);
  end loop;
end $$;
create trigger audit_row after update of is_owner, is_active, username on public.profiles
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------
-- 5. Hak akses tabel (column privilege) — default Supabase memberi ALL
--    ke anon/authenticated; dicabut lalu diberikan seperlunya.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon;
revoke all on all functions in schema private from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

grant select on public.profiles, public.outlets, public.outlet_users, public.categories,
  public.stock_movements, public.payments, public.cash_sessions, public.expenses,
  public.audit_logs, public.app_settings to authenticated;

grant update (full_name) on public.profiles to authenticated;
grant insert, update on public.outlets to authenticated;
grant insert, update on public.outlet_users to authenticated;
grant insert (outlet_id, name, sort_order, is_active), update (name, sort_order, is_active) on public.categories to authenticated;
grant insert (outlet_id, expense_date, category, amount, description, created_by),
      update (expense_date, category, amount, description, deleted_at, deleted_by) on public.expenses to authenticated;
grant insert (outlet_id, key, value, updated_by), update (value, updated_by) on public.app_settings to authenticated;

-- HPP & laba TIDAK termasuk: cost_price, cost_total, unit_cost, gross_profit
grant select (id, outlet_id, category_id, sku, name, description, image_url, unit, sell_price,
              current_stock, min_stock, is_active, created_by, created_at, updated_at)
  on public.products to authenticated;
grant select (id, outlet_id, number, business_date, cashier_id, cash_session_id, status, customer_name,
              note, subtotal, item_discount_total, discount_amount, total, item_count, payment_method,
              amount_paid, change_amount, voided_at, voided_by, void_reason, created_at, updated_at)
  on public.transactions to authenticated;
grant select (id, transaction_id, outlet_id, product_id, product_name, sku, unit, quantity, unit_price,
              subtotal, discount_amount, total, created_at)
  on public.transaction_items to authenticated;

-- ---------------------------------------------------------------------
-- 6. Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.outlets          enable row level security;
alter table public.outlet_users     enable row level security;
alter table public.categories       enable row level security;
alter table public.products         enable row level security;
alter table public.outlet_counters  enable row level security;
alter table public.cash_sessions    enable row level security;
alter table public.transactions     enable row level security;
alter table public.transaction_items enable row level security;
alter table public.payments         enable row level security;
alter table public.stock_movements  enable row level security;
alter table public.expenses         enable row level security;
alter table public.audit_logs       enable row level security;
alter table public.app_settings     enable row level security;

-- profiles: diri sendiri, owner, atau rekan di outlet yang sama (untuk nama kasir)
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid() or public.is_owner() or exists (
      select 1 from public.outlet_users ou
      where ou.user_id = profiles.id and public.has_outlet_access(ou.outlet_id)
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_owner())
  with check (id = auth.uid() or public.is_owner());

-- outlets
create policy outlets_select on public.outlets for select to authenticated
  using (public.has_outlet_access(id));
create policy outlets_insert on public.outlets for insert to authenticated
  with check (public.is_owner());
create policy outlets_update on public.outlets for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- outlet_users: hanya owner yang mengubah penugasan & izin (Fase 7 menambah RPC untuk admin)
create policy outlet_users_select on public.outlet_users for select to authenticated
  using (user_id = auth.uid() or public.is_owner() or public.has_permission(outlet_id, 'users.manage'));
create policy outlet_users_insert on public.outlet_users for insert to authenticated
  with check (public.is_owner());
create policy outlet_users_update on public.outlet_users for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- categories
create policy categories_select on public.categories for select to authenticated
  using (public.has_outlet_access(outlet_id));
create policy categories_insert on public.categories for insert to authenticated
  with check (public.has_permission(outlet_id, 'products.manage'));
create policy categories_update on public.categories for update to authenticated
  using (public.has_permission(outlet_id, 'products.manage'))
  with check (public.has_permission(outlet_id, 'products.manage'));

-- products: baca saja; tulis melalui RPC
create policy products_select on public.products for select to authenticated
  using (public.has_outlet_access(outlet_id));

-- outlet_counters: tanpa policy = tertutup total untuk klien

-- cash_sessions
create policy cash_sessions_select on public.cash_sessions for select to authenticated
  using (
    (opened_by = auth.uid() and public.has_outlet_access(outlet_id))
    or public.has_permission(outlet_id, 'closing.perform')
    or public.has_permission(outlet_id, 'reports.view')
  );

-- transactions: semua (izin view_all) atau milik sendiri
create policy transactions_select on public.transactions for select to authenticated
  using (
    public.has_permission(outlet_id, 'transactions.view_all')
    or (cashier_id = auth.uid() and public.has_outlet_access(outlet_id))
  );
create policy transaction_items_select on public.transaction_items for select to authenticated
  using (exists (select 1 from public.transactions t where t.id = transaction_items.transaction_id));
create policy payments_select on public.payments for select to authenticated
  using (exists (select 1 from public.transactions t where t.id = payments.transaction_id));

-- stock_movements
create policy stock_movements_select on public.stock_movements for select to authenticated
  using (public.has_permission(outlet_id, 'stock.manage') or public.has_permission(outlet_id, 'reports.view'));

-- expenses
create policy expenses_select on public.expenses for select to authenticated
  using (public.has_permission(outlet_id, 'expenses.view') or public.has_permission(outlet_id, 'expenses.manage'));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (public.has_permission(outlet_id, 'expenses.manage') and created_by = auth.uid());
create policy expenses_update on public.expenses for update to authenticated
  using (public.has_permission(outlet_id, 'expenses.manage') and deleted_at is null)
  with check (public.has_permission(outlet_id, 'expenses.manage'));

-- audit_logs
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.is_owner() or (outlet_id is not null and public.has_permission(outlet_id, 'audit.view')));

-- app_settings
create policy app_settings_select on public.app_settings for select to authenticated
  using (outlet_id is null or public.has_outlet_access(outlet_id));
create policy app_settings_insert on public.app_settings for insert to authenticated
  with check (case when outlet_id is null then public.is_owner()
                   else public.has_permission(outlet_id, 'settings.manage') end);
create policy app_settings_update on public.app_settings for update to authenticated
  using (case when outlet_id is null then public.is_owner()
              else public.has_permission(outlet_id, 'settings.manage') end)
  with check (case when outlet_id is null then public.is_owner()
                   else public.has_permission(outlet_id, 'settings.manage') end);

-- ---------------------------------------------------------------------
-- 7. View data sensitif (HPP & laba) dengan pemeriksaan izin per baris.
--    Dimiliki postgres (melewati column privilege) tetapi difilter oleh
--    has_permission(); security_barrier mencegah kebocoran via predicate.
-- ---------------------------------------------------------------------
create view public.product_costs with (security_barrier = true) as
  select p.id as product_id, p.outlet_id, p.cost_price
  from public.products p
  where public.has_permission(p.outlet_id, 'cost.view');

create view public.transaction_profits with (security_barrier = true) as
  select t.id as transaction_id, t.outlet_id, t.cost_total, t.gross_profit
  from public.transactions t
  where public.has_permission(t.outlet_id, 'profit.view');

create view public.transaction_item_profits with (security_barrier = true) as
  select i.id as transaction_item_id, i.transaction_id, i.outlet_id, i.unit_cost, i.cost_total, i.gross_profit
  from public.transaction_items i
  where public.has_permission(i.outlet_id, 'profit.view');

grant select on public.product_costs, public.transaction_profits, public.transaction_item_profits to authenticated;

grant execute on function public.role_default_permissions(public.app_role), public.all_permissions(),
  public.is_owner(), public.has_outlet_access(uuid), public.has_permission(uuid, text), public.my_access()
  to authenticated;

-- ┌──────────────────────────────────────────────────────────────────
-- │ 20261121000300_rpc.sql
-- └──────────────────────────────────────────────────────────────────
-- =====================================================================
-- MUN PARFUM POS — 0300 Fungsi bisnis (RPC) atomik
--
-- Semua fungsi publik: SECURITY DEFINER + search_path kosong + pemeriksaan
-- izin eksplisit di awal. Setiap pemanggilan RPC oleh PostgREST berjalan
-- dalam satu transaksi database: bila ada langkah gagal, SEMUA dibatalkan.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Utilitas internal
-- ---------------------------------------------------------------------
create function private.require_auth() returns uuid
language plpgsql stable set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then
    raise exception 'Sesi login tidak valid' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles where id = v and is_active) then
    raise exception 'Akun tidak aktif' using errcode = '42501';
  end if;
  return v;
end $$;

create function private.require_permission(p_outlet_id uuid, p_permission text) returns void
language plpgsql stable set search_path = '' as $$
begin
  if not public.has_permission(p_outlet_id, p_permission) then
    raise exception 'Akses ditolak: izin % diperlukan', p_permission using errcode = '42501';
  end if;
end $$;

create function private.business_date(p_ts timestamptz default now()) returns date
language sql stable set search_path = '' as $$
  select (p_ts at time zone 'Asia/Makassar')::date
$$;

create function private.next_counter(p_outlet_id uuid, p_key text) returns bigint
language sql set search_path = '' as $$
  insert into public.outlet_counters as c (outlet_id, counter_key, value)
  values (p_outlet_id, p_key, 1)
  on conflict (outlet_id, counter_key) do update set value = c.value + 1
  returning value
$$;

create function private.setting_bool(p_outlet_id uuid, p_key text, p_default boolean) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(
    (select (value #>> '{}')::boolean from public.app_settings where outlet_id = p_outlet_id and key = p_key),
    (select (value #>> '{}')::boolean from public.app_settings where outlet_id is null and key = p_key),
    p_default)
$$;

create function private.is_decimal_unit(p_unit public.stock_unit) returns boolean
language sql immutable set search_path = '' as $$
  select p_unit in ('ML', 'GRAM')
$$;

create function private.validate_quantity(p_qty numeric, p_unit public.stock_unit, p_allow_zero boolean default false)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_qty is null or (p_qty < 0) or (p_qty = 0 and not p_allow_zero) then
    raise exception 'Jumlah harus lebih dari 0' using errcode = '22023';
  end if;
  if p_qty <> round(p_qty, 3) then
    raise exception 'Jumlah maksimal 3 angka desimal' using errcode = '22023';
  end if;
  if not private.is_decimal_unit(p_unit) and p_qty <> trunc(p_qty) then
    raise exception 'Satuan % harus bilangan bulat', p_unit using errcode = '22023';
  end if;
end $$;

create function private.validate_money(p_value numeric, p_label text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_value is null or p_value < 0 then
    raise exception '% tidak boleh kosong atau negatif', p_label using errcode = '22023';
  end if;
  if p_value <> round(p_value, 2) then
    raise exception '% maksimal 2 angka desimal', p_label using errcode = '22023';
  end if;
  if p_value > 999999999999 then
    raise exception '% terlalu besar', p_label using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- INTI STOK: satu-satunya jalur untuk mengubah products.current_stock.
-- Mengunci baris produk (FOR UPDATE), memvalidasi, memperbarui stok, dan
-- menulis stock_movements dalam transaksi yang sama.
-- ---------------------------------------------------------------------
create function private.apply_stock_change(
  p_product_id     uuid,
  p_quantity       numeric,            -- bertanda
  p_type           public.stock_movement_type,
  p_reason         text,
  p_transaction_id uuid default null,
  p_idempotency_key uuid default null,
  p_allow_negative boolean default false
) returns public.stock_movements
language plpgsql security definer set search_path = '' as $$
declare
  v_product public.products;
  v_after numeric(14,3);
  v_mv public.stock_movements;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Produk tidak ditemukan' using errcode = 'P0002';
  end if;
  if p_quantity = 0 then
    raise exception 'Perubahan stok tidak boleh nol' using errcode = '22023';
  end if;
  perform private.validate_quantity(abs(p_quantity), v_product.unit);

  v_after := v_product.current_stock + p_quantity;
  if v_after < 0 and not p_allow_negative then
    raise exception 'Stok % tidak cukup (tersedia %, dibutuhkan %)',
      v_product.name, v_product.current_stock, abs(p_quantity)
      using errcode = 'P0001', hint = 'INSUFFICIENT_STOCK';
  end if;

  perform set_config('app.stock_write', 'on', true);
  update public.products set current_stock = v_after where id = p_product_id;
  perform set_config('app.stock_write', 'off', true);

  insert into public.stock_movements (
    outlet_id, product_id, movement_type, quantity, stock_before, stock_after,
    reason, transaction_id, idempotency_key, created_by
  ) values (
    v_product.outlet_id, p_product_id, p_type, p_quantity, v_product.current_stock, v_after,
    nullif(btrim(p_reason), ''), p_transaction_id, p_idempotency_key, auth.uid()
  ) returning * into v_mv;
  return v_mv;
end $$;

-- ---------------------------------------------------------------------
-- PRODUK
-- ---------------------------------------------------------------------
create function public.create_product(
  p_outlet_id     uuid,
  p_name          text,
  p_unit          public.stock_unit,
  p_sell_price    numeric,
  p_cost_price    numeric,
  p_initial_stock numeric default 0,
  p_min_stock     numeric default 0,
  p_category_id   uuid default null,
  p_description   text default null,
  p_image_url     text default null,
  p_sku           text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_code text;
  v_sku text := nullif(btrim(p_sku), '');
  v_id uuid;
begin
  perform private.require_permission(p_outlet_id, 'products.manage');
  if p_cost_price is not null and p_cost_price <> 0 then
    perform private.require_permission(p_outlet_id, 'cost.view');
  end if;
  select code into v_code from public.outlets where id = p_outlet_id and is_active;
  if v_code is null then
    raise exception 'Outlet tidak aktif' using errcode = '22023';
  end if;
  perform private.validate_money(p_sell_price, 'Harga jual');
  perform private.validate_money(coalesce(p_cost_price, 0), 'HPP');
  perform private.validate_quantity(coalesce(p_initial_stock, 0), p_unit, true);
  perform private.validate_quantity(coalesce(p_min_stock, 0), p_unit, true);

  if v_sku is null then
    loop
      v_sku := v_code || '-' || lpad(private.next_counter(p_outlet_id, 'sku')::text, 4, '0');
      exit when not exists (select 1 from public.products where outlet_id = p_outlet_id and sku = v_sku);
    end loop;
  elsif exists (select 1 from public.products where outlet_id = p_outlet_id and lower(sku) = lower(v_sku)) then
    raise exception 'SKU % sudah dipakai', v_sku using errcode = '23505';
  end if;

  insert into public.products (outlet_id, category_id, sku, name, description, image_url, unit,
                               sell_price, cost_price, min_stock, created_by)
  values (p_outlet_id, p_category_id, v_sku, btrim(p_name), nullif(btrim(p_description), ''),
          nullif(btrim(p_image_url), ''), p_unit, p_sell_price, coalesce(p_cost_price, 0),
          coalesce(p_min_stock, 0), v_uid)
  returning id into v_id;

  if coalesce(p_initial_stock, 0) > 0 then
    perform private.apply_stock_change(v_id, p_initial_stock, 'initial', 'Stok awal');
  end if;

  perform private.log_audit(p_outlet_id, 'create', 'products', v_id,
    jsonb_build_object('sku', v_sku, 'name', btrim(p_name), 'sell_price', p_sell_price,
                       'cost_price', p_cost_price, 'initial_stock', coalesce(p_initial_stock, 0)));
  return jsonb_build_object('id', v_id, 'sku', v_sku);
end $$;

create function public.update_product(
  p_product_id  uuid,
  p_name        text,
  p_unit        public.stock_unit,
  p_sell_price  numeric,
  p_cost_price  numeric default null,     -- null = tidak diubah
  p_min_stock   numeric default 0,
  p_category_id uuid default null,
  p_description text default null,
  p_image_url   text default null,
  p_sku         text default null,        -- null = tidak diubah
  p_is_active   boolean default true
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.products;
  v_sku text;
begin
  perform private.require_auth();
  select * into v_old from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Produk tidak ditemukan' using errcode = 'P0002';
  end if;
  perform private.require_permission(v_old.outlet_id, 'products.manage');
  if p_cost_price is not null and p_cost_price <> v_old.cost_price then
    perform private.require_permission(v_old.outlet_id, 'cost.view');
  end if;
  perform private.validate_money(p_sell_price, 'Harga jual');
  if p_cost_price is not null then perform private.validate_money(p_cost_price, 'HPP'); end if;
  perform private.validate_quantity(coalesce(p_min_stock, 0), p_unit, true);
  if not private.is_decimal_unit(p_unit) and v_old.current_stock <> trunc(v_old.current_stock) then
    raise exception 'Stok saat ini desimal; satuan % tidak dapat dipakai', p_unit using errcode = '22023';
  end if;

  v_sku := coalesce(nullif(btrim(p_sku), ''), v_old.sku);
  if lower(v_sku) <> lower(v_old.sku) and exists (
      select 1 from public.products where outlet_id = v_old.outlet_id and lower(sku) = lower(v_sku) and id <> p_product_id) then
    raise exception 'SKU % sudah dipakai', v_sku using errcode = '23505';
  end if;

  update public.products set
    name = btrim(p_name), unit = p_unit, sell_price = p_sell_price,
    cost_price = coalesce(p_cost_price, cost_price), min_stock = coalesce(p_min_stock, 0),
    category_id = p_category_id, description = nullif(btrim(p_description), ''),
    image_url = nullif(btrim(p_image_url), ''), sku = v_sku, is_active = coalesce(p_is_active, true)
  where id = p_product_id;

  perform private.log_audit(v_old.outlet_id, 'update', 'products', p_product_id,
    jsonb_build_object(
      'old', jsonb_build_object('name', v_old.name, 'sku', v_old.sku, 'sell_price', v_old.sell_price,
                                'cost_price', v_old.cost_price, 'unit', v_old.unit, 'is_active', v_old.is_active),
      'new', jsonb_build_object('name', btrim(p_name), 'sku', v_sku, 'sell_price', p_sell_price,
                                'cost_price', coalesce(p_cost_price, v_old.cost_price), 'unit', p_unit,
                                'is_active', coalesce(p_is_active, true))));
  return jsonb_build_object('id', p_product_id, 'sku', v_sku);
end $$;

-- "Hapus" produk = nonaktifkan (riwayat transaksi tetap utuh)
create function public.set_product_active(p_product_id uuid, p_is_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_outlet uuid;
begin
  perform private.require_auth();
  select outlet_id into v_outlet from public.products where id = p_product_id;
  if v_outlet is null then
    raise exception 'Produk tidak ditemukan' using errcode = 'P0002';
  end if;
  perform private.require_permission(v_outlet, 'products.manage');
  update public.products set is_active = p_is_active where id = p_product_id;
  perform private.log_audit(v_outlet, case when p_is_active then 'activate' else 'deactivate' end,
                            'products', p_product_id, '{}');
end $$;

-- ---------------------------------------------------------------------
-- STOK MANUAL: masuk, keluar, opname
-- ---------------------------------------------------------------------
create function public.adjust_stock(
  p_product_id      uuid,
  p_type            public.stock_movement_type,  -- stock_in | stock_out | adjustment
  p_quantity        numeric,                      -- adjustment: stok hasil hitung fisik
  p_reason          text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_product public.products;
  v_existing public.stock_movements;
  v_delta numeric;
  v_mv public.stock_movements;
begin
  perform private.require_auth();
  if p_idempotency_key is null then
    raise exception 'idempotency_key wajib diisi' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select * into v_existing from public.stock_movements where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.created_by is distinct from auth.uid() or v_existing.product_id <> p_product_id then
      raise exception 'idempotency_key sudah dipakai untuk operasi lain' using errcode = '23505';
    end if;
    return to_jsonb(v_existing) || jsonb_build_object('replayed', true);
  end if;

  select * into v_product from public.products where id = p_product_id;
  if not found then
    raise exception 'Produk tidak ditemukan' using errcode = 'P0002';
  end if;
  perform private.require_permission(v_product.outlet_id, 'stock.manage');
  if p_type not in ('stock_in', 'stock_out', 'adjustment') then
    raise exception 'Jenis pergerakan % tidak diizinkan di sini', p_type using errcode = '22023';
  end if;
  if p_type in ('stock_out', 'adjustment') and coalesce(btrim(p_reason), '') = '' then
    raise exception 'Alasan wajib diisi untuk stok keluar / penyesuaian' using errcode = '22023';
  end if;

  if p_type = 'adjustment' then
    perform private.validate_quantity(p_quantity, v_product.unit, true);
    -- kunci dulu agar selisih dihitung dari stok terbaru
    select * into v_product from public.products where id = p_product_id for update;
    v_delta := p_quantity - v_product.current_stock;
    if v_delta = 0 then
      raise exception 'Stok fisik sama dengan stok sistem; tidak ada perubahan' using errcode = '22023';
    end if;
  else
    perform private.validate_quantity(p_quantity, v_product.unit);
    v_delta := case when p_type = 'stock_in' then p_quantity else -p_quantity end;
  end if;

  v_mv := private.apply_stock_change(
    p_product_id, v_delta, p_type, p_reason, null, p_idempotency_key,
    private.setting_bool(v_product.outlet_id, 'allow_negative_stock', false));

  perform private.log_audit(v_product.outlet_id, 'stock_' || p_type::text, 'products', p_product_id,
    jsonb_build_object('quantity', v_delta, 'before', v_mv.stock_before, 'after', v_mv.stock_after, 'reason', p_reason));
  return to_jsonb(v_mv) || jsonb_build_object('replayed', false);
end $$;

-- ---------------------------------------------------------------------
-- PENJUALAN
-- ---------------------------------------------------------------------
create function private.sale_result(p_transaction_id uuid, p_replayed boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id, 'number', t.number, 'outlet_id', t.outlet_id, 'business_date', t.business_date,
    'status', t.status, 'subtotal', t.subtotal, 'item_discount_total', t.item_discount_total,
    'discount_amount', t.discount_amount, 'total', t.total, 'item_count', t.item_count,
    'payment_method', t.payment_method, 'amount_paid', t.amount_paid, 'change_amount', t.change_amount,
    'created_at', t.created_at, 'replayed', p_replayed)
  from public.transactions t where t.id = p_transaction_id
$$;

/*
 * create_sale — menyimpan penjualan secara atomik.
 *
 * p_items: [{ "product_id": uuid, "quantity": "10", "discount_amount": "0" }, ...]
 *
 * Langkah: auth → kunci idempotensi → validasi → header transaksi →
 * per item: kunci produk, cek stok, snapshot harga & HPP, kurangi stok +
 * stock_movement → total, diskon, pembayaran, kembalian → audit.
 * Jika satu langkah gagal, seluruh transaksi database dibatalkan.
 */
create function public.create_sale(
  p_outlet_id        uuid,
  p_items            jsonb,
  p_payment_method   public.payment_method,
  p_amount_received  numeric,
  p_idempotency_key  uuid,
  p_discount_amount  numeric default 0,
  p_payment_reference text default null,
  p_customer_name    text default null,
  p_note             text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_existing public.transactions;
  v_outlet public.outlets;
  v_trx_id uuid := gen_random_uuid();
  v_bdate date := private.business_date();
  v_number text;
  v_session uuid;
  v_allow_negative boolean;
  v_item record;
  v_product public.products;
  v_line_sub numeric(14,2);
  v_line_disc numeric(14,2);
  v_line_cost numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_item_disc numeric(14,2) := 0;
  v_cost numeric(14,2) := 0;
  v_total numeric(14,2);
  v_received numeric(14,2);
  v_change numeric(14,2) := 0;
  v_count integer := 0;
begin
  if p_idempotency_key is null then
    raise exception 'idempotency_key wajib diisi' using errcode = '22023';
  end if;

  -- Serialisasi permintaan dengan kunci yang sama → tidak ada transaksi ganda
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select * into v_existing from public.transactions where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.cashier_id <> v_uid then
      raise exception 'idempotency_key sudah dipakai' using errcode = '23505';
    end if;
    return private.sale_result(v_existing.id, true);
  end if;

  perform private.require_permission(p_outlet_id, 'pos.sell');
  select * into v_outlet from public.outlets where id = p_outlet_id and is_active;
  if not found then
    raise exception 'Outlet tidak aktif' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Keranjang kosong' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Maksimal 200 item per transaksi' using errcode = '22023';
  end if;
  perform private.validate_money(coalesce(p_discount_amount, 0), 'Diskon transaksi');

  v_allow_negative := private.setting_bool(p_outlet_id, 'allow_negative_stock', false);
  select id into v_session from public.cash_sessions
    where outlet_id = p_outlet_id and opened_by = v_uid and status = 'open';

  v_number := format('MP-%s-%s-%s', v_outlet.code, to_char(v_bdate, 'YYYYMMDD'),
                     lpad(private.next_counter(p_outlet_id, 'trx:' || to_char(v_bdate, 'YYYYMMDD'))::text, 4, '0'));

  insert into public.transactions (id, outlet_id, number, business_date, cashier_id, cash_session_id,
                                   customer_name, note, payment_method, idempotency_key)
  values (v_trx_id, p_outlet_id, v_number, v_bdate, v_uid, v_session,
          nullif(btrim(p_customer_name), ''), nullif(btrim(p_note), ''), p_payment_method, p_idempotency_key);

  -- urutkan per product_id agar urutan lock konsisten (hindari deadlock)
  for v_item in
    select x.ord, x.product_id, x.quantity, coalesce(x.discount_amount, 0) as discount_amount
    from jsonb_to_recordset(
      (select jsonb_agg(e || jsonb_build_object('ord', o)) from jsonb_array_elements(p_items) with ordinality as a(e, o))
    ) as x(ord int, product_id uuid, quantity numeric, discount_amount numeric)
    order by x.product_id, x.ord
  loop
    if v_item.product_id is null then
      raise exception 'product_id wajib diisi' using errcode = '22023';
    end if;
    select * into v_product from public.products
      where id = v_item.product_id and outlet_id = p_outlet_id for update;
    if not found then
      raise exception 'Produk tidak ditemukan di outlet ini' using errcode = 'P0002';
    end if;
    if not v_product.is_active then
      raise exception 'Produk % tidak aktif', v_product.name using errcode = '22023';
    end if;
    perform private.validate_quantity(v_item.quantity, v_product.unit);
    perform private.validate_money(v_item.discount_amount, 'Diskon item');

    v_line_sub  := round(v_product.sell_price * v_item.quantity, 0);
    v_line_disc := v_item.discount_amount;
    if v_line_disc > v_line_sub then
      raise exception 'Diskon item % melebihi subtotal', v_product.name using errcode = '22023';
    end if;
    v_line_cost := round(v_product.cost_price * v_item.quantity, 2);

    insert into public.transaction_items (transaction_id, outlet_id, product_id, product_name, sku, unit,
      quantity, unit_price, unit_cost, subtotal, discount_amount, total, cost_total, gross_profit)
    values (v_trx_id, p_outlet_id, v_product.id, v_product.name, v_product.sku, v_product.unit,
      v_item.quantity, v_product.sell_price, v_product.cost_price, v_line_sub, v_line_disc,
      v_line_sub - v_line_disc, v_line_cost, (v_line_sub - v_line_disc) - v_line_cost);

    perform private.apply_stock_change(v_product.id, -v_item.quantity, 'sale',
                                       'Penjualan ' || v_number, v_trx_id, null, v_allow_negative);

    v_subtotal  := v_subtotal + (v_line_sub - v_line_disc);
    v_item_disc := v_item_disc + v_line_disc;
    v_cost      := v_cost + v_line_cost;
    v_count     := v_count + 1;
  end loop;

  if coalesce(p_discount_amount, 0) > v_subtotal then
    raise exception 'Diskon transaksi melebihi subtotal' using errcode = '22023';
  end if;
  v_total := v_subtotal - coalesce(p_discount_amount, 0);

  if p_payment_method = 'cash' then
    perform private.validate_money(p_amount_received, 'Uang diterima');
    v_received := p_amount_received;
    if v_received < v_total then
      raise exception 'Uang diterima kurang dari total belanja' using errcode = '22023', hint = 'INSUFFICIENT_PAYMENT';
    end if;
    v_change := v_received - v_total;
  else
    -- non-tunai: dibayar tepat sebesar total
    if p_amount_received is not null and p_amount_received <> v_total then
      raise exception 'Nominal pembayaran non-tunai harus sama dengan total' using errcode = '22023';
    end if;
    v_received := v_total;
  end if;

  perform set_config('app.trx_write', 'on', true);
  update public.transactions set
    subtotal = v_subtotal, item_discount_total = v_item_disc,
    discount_amount = coalesce(p_discount_amount, 0), total = v_total,
    cost_total = v_cost, gross_profit = v_total - v_cost, item_count = v_count,
    amount_paid = v_received, change_amount = v_change
  where id = v_trx_id;
  perform set_config('app.trx_write', 'off', true);

  insert into public.payments (transaction_id, outlet_id, method, amount, amount_received, change_amount, reference)
  values (v_trx_id, p_outlet_id, p_payment_method, v_total, v_received, v_change, nullif(btrim(p_payment_reference), ''));

  perform private.log_audit(p_outlet_id, 'create', 'transactions', v_trx_id,
    jsonb_build_object('number', v_number, 'total', v_total, 'payment_method', p_payment_method));

  return private.sale_result(v_trx_id, false);
end $$;

-- Pembatalan: status void + stok dikembalikan (tercatat). Tidak ada hapus.
create function public.void_transaction(p_transaction_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_trx public.transactions;
  v_item public.transaction_items;
begin
  perform private.require_auth();
  select * into v_trx from public.transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'Transaksi tidak ditemukan' using errcode = 'P0002';
  end if;
  perform private.require_permission(v_trx.outlet_id, 'transactions.void');
  if v_trx.status = 'void' then
    raise exception 'Transaksi sudah dibatalkan' using errcode = '22023';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Alasan pembatalan wajib diisi' using errcode = '22023';
  end if;

  for v_item in select * from public.transaction_items where transaction_id = p_transaction_id order by product_id loop
    perform private.apply_stock_change(v_item.product_id, v_item.quantity, 'sale_void',
      'Batal ' || v_trx.number || ': ' || btrim(p_reason), p_transaction_id, null, true);
  end loop;

  perform set_config('app.trx_write', 'on', true);
  update public.transactions
    set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
    where id = p_transaction_id;
  perform set_config('app.trx_write', 'off', true);

  perform private.log_audit(v_trx.outlet_id, 'void', 'transactions', p_transaction_id,
    jsonb_build_object('number', v_trx.number, 'total', v_trx.total, 'reason', btrim(p_reason)));
  return private.sale_result(p_transaction_id, false);
end $$;

-- ---------------------------------------------------------------------
-- SESI KAS / CLOSING
-- ---------------------------------------------------------------------
create function public.open_cash_session(p_outlet_id uuid, p_opening_cash numeric default 0) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_auth(); v_id uuid;
begin
  perform private.require_permission(p_outlet_id, 'pos.sell');
  perform private.validate_money(coalesce(p_opening_cash, 0), 'Kas awal');
  if exists (select 1 from public.cash_sessions where outlet_id = p_outlet_id and opened_by = v_uid and status = 'open') then
    raise exception 'Masih ada sesi kas yang terbuka' using errcode = '23505';
  end if;
  insert into public.cash_sessions (outlet_id, opened_by, opening_cash)
  values (p_outlet_id, v_uid, coalesce(p_opening_cash, 0)) returning id into v_id;
  perform private.log_audit(p_outlet_id, 'open', 'cash_sessions', v_id, jsonb_build_object('opening_cash', p_opening_cash));
  return v_id;
end $$;

create function public.close_cash_session(p_session_id uuid, p_counted_cash numeric, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_s public.cash_sessions;
  v_cash_sales numeric(14,2);
  v_expected numeric(14,2);
begin
  perform private.require_auth();
  select * into v_s from public.cash_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Sesi kas tidak ditemukan' using errcode = 'P0002';
  end if;
  perform private.require_permission(v_s.outlet_id, 'closing.perform');
  if v_s.status <> 'open' then
    raise exception 'Sesi kas sudah ditutup' using errcode = '22023';
  end if;
  perform private.validate_money(p_counted_cash, 'Kas fisik');

  select coalesce(sum(p.amount), 0) into v_cash_sales
  from public.payments p join public.transactions t on t.id = p.transaction_id
  where t.cash_session_id = p_session_id and t.status = 'completed' and p.method = 'cash';

  v_expected := v_s.opening_cash + v_cash_sales;
  update public.cash_sessions set
    status = 'closed', closed_by = auth.uid(), closed_at = now(), expected_cash = v_expected,
    counted_cash = p_counted_cash, cash_difference = p_counted_cash - v_expected, note = nullif(btrim(p_note), '')
  where id = p_session_id returning * into v_s;

  perform private.log_audit(v_s.outlet_id, 'close', 'cash_sessions', p_session_id,
    jsonb_build_object('expected', v_expected, 'counted', p_counted_cash, 'difference', v_s.cash_difference));
  return to_jsonb(v_s) || jsonb_build_object('cash_sales', v_cash_sales);
end $$;

-- ---------------------------------------------------------------------
-- LAPORAN
-- Omzet = penjualan setelah diskon; transaksi void TIDAK dihitung.
-- Field sensitif (HPP, laba, pengeluaran) bernilai null tanpa izin profit.view.
-- ---------------------------------------------------------------------
create function public.get_sales_report(
  p_from      date,
  p_to        date,
  p_outlet_id uuid default null,          -- null = semua outlet yang diizinkan
  p_include_expenses boolean default true
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_outlets uuid[];
  v_profit boolean;
  v_summary jsonb;
  v_expenses numeric(14,2) := 0;
  v_gross numeric(14,2);
begin
  perform private.require_auth();
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Rentang tanggal tidak valid' using errcode = '22023';
  end if;
  if p_to - p_from > 366 then
    raise exception 'Rentang laporan maksimal 1 tahun' using errcode = '22023';
  end if;

  if p_outlet_id is not null then
    perform private.require_permission(p_outlet_id, 'reports.view');
    v_outlets := array[p_outlet_id];
  else
    select coalesce(array_agg(o.id), '{}') into v_outlets
    from public.outlets o where public.has_permission(o.id, 'reports.view');
  end if;

  select coalesce(bool_and(public.has_permission(x, 'profit.view')), false) into v_profit from unnest(v_outlets) x;

  with t as (
    select * from public.transactions
    where outlet_id = any (v_outlets) and business_date between p_from and p_to and status = 'completed'
  )
  select jsonb_build_object(
    'transaction_count', count(*),
    'omzet', coalesce(sum(total), 0),
    'subtotal_before_discount', coalesce(sum(subtotal + item_discount_total), 0),
    'discount_total', coalesce(sum(item_discount_total + discount_amount), 0),
    'average_transaction', case when count(*) > 0 then round(sum(total) / count(*), 2) else 0 end,
    'item_count', coalesce(sum(item_count), 0),
    'cost_total', coalesce(sum(cost_total), 0),
    'gross_profit', coalesce(sum(gross_profit), 0)
  ) into v_summary from t;

  v_gross := (v_summary ->> 'gross_profit')::numeric;
  if p_include_expenses then
    select coalesce(sum(amount), 0) into v_expenses from public.expenses
    where outlet_id = any (v_outlets) and expense_date between p_from and p_to and deleted_at is null;
  end if;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'outlet_ids', to_jsonb(v_outlets), 'can_view_profit', v_profit,
    'transaction_count', (v_summary ->> 'transaction_count')::int,
    'omzet', (v_summary ->> 'omzet')::numeric,
    'subtotal_before_discount', (v_summary ->> 'subtotal_before_discount')::numeric,
    'discount_total', (v_summary ->> 'discount_total')::numeric,
    'average_transaction', (v_summary ->> 'average_transaction')::numeric,
    'item_count', (v_summary ->> 'item_count')::int,
    'cost_total', case when v_profit then (v_summary ->> 'cost_total')::numeric end,
    'gross_profit', case when v_profit then v_gross end,
    'expenses_total', case when v_profit then v_expenses end,
    'net_profit', case when v_profit then v_gross - v_expenses end,
    'void_count', (select count(*) from public.transactions
                   where outlet_id = any (v_outlets) and business_date between p_from and p_to and status = 'void'),
    'qty_by_unit', coalesce((
      select jsonb_agg(jsonb_build_object('unit', unit, 'quantity', qty) order by unit)
      from (select i.unit, sum(i.quantity) qty from public.transaction_items i
            join public.transactions t on t.id = i.transaction_id
            where t.outlet_id = any (v_outlets) and t.business_date between p_from and p_to and t.status = 'completed'
            group by i.unit) u), '[]'),
    'by_payment_method', coalesce((
      select jsonb_agg(jsonb_build_object('method', method, 'count', cnt, 'amount', amt) order by amt desc)
      from (select p.method, count(distinct t.id) cnt, sum(p.amount) amt from public.payments p
            join public.transactions t on t.id = p.transaction_id
            where t.outlet_id = any (v_outlets) and t.business_date between p_from and p_to and t.status = 'completed'
            group by p.method) m), '[]'),
    'top_products', coalesce((
      select jsonb_agg(r order by (r ->> 'quantity')::numeric desc) from (
        select jsonb_build_object('product_id', i.product_id, 'name', max(i.product_name), 'unit', max(i.unit::text),
                 'quantity', sum(i.quantity), 'omzet', sum(i.total),
                 'gross_profit', case when v_profit then sum(i.gross_profit) end) r
        from public.transaction_items i join public.transactions t on t.id = i.transaction_id
        where t.outlet_id = any (v_outlets) and t.business_date between p_from and p_to and t.status = 'completed'
        group by i.product_id order by sum(i.quantity) desc limit 10) q), '[]'),
    'top_profit_products', case when v_profit then coalesce((
      select jsonb_agg(r order by (r ->> 'gross_profit')::numeric desc) from (
        select jsonb_build_object('product_id', i.product_id, 'name', max(i.product_name), 'unit', max(i.unit::text),
                 'quantity', sum(i.quantity), 'omzet', sum(i.total), 'gross_profit', sum(i.gross_profit)) r
        from public.transaction_items i join public.transactions t on t.id = i.transaction_id
        where t.outlet_id = any (v_outlets) and t.business_date between p_from and p_to and t.status = 'completed'
        group by i.product_id order by sum(i.gross_profit) desc limit 10) q), '[]') end,
    'by_outlet', coalesce((
      select jsonb_agg(jsonb_build_object('outlet_id', o.id, 'code', o.code, 'name', o.name,
               'transaction_count', coalesce(s.cnt, 0), 'omzet', coalesce(s.omzet, 0),
               'gross_profit', case when v_profit then coalesce(s.gp, 0) end) order by o.code)
      from public.outlets o
      left join (select outlet_id, count(*) cnt, sum(total) omzet, sum(gross_profit) gp from public.transactions
                 where outlet_id = any (v_outlets) and business_date between p_from and p_to and status = 'completed'
                 group by outlet_id) s on s.outlet_id = o.id
      where o.id = any (v_outlets)), '[]')
  );
end $$;

-- ---------------------------------------------------------------------
-- BOOTSTRAP (dijalankan sekali dari SQL Editor / service role, bukan klien)
-- ---------------------------------------------------------------------
create function private.bootstrap_owner(p_email text, p_outlet_code text, p_outlet_name text, p_address text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_outlet uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(p_email);
  if v_uid is null then
    raise exception 'User % belum terdaftar di Supabase Auth', p_email;
  end if;
  update public.profiles set is_owner = true, is_active = true where id = v_uid;
  insert into public.outlets (code, name, address) values (upper(p_outlet_code), p_outlet_name, p_address)
  on conflict (code) do update set name = excluded.name
  returning id into v_outlet;
  return v_outlet;
end $$;

-- ---------------------------------------------------------------------
-- Hak eksekusi
-- ---------------------------------------------------------------------
revoke all on all functions in schema public from public, anon;
revoke all on all functions in schema private from public, anon, authenticated;

grant execute on function
  public.create_product(uuid, text, public.stock_unit, numeric, numeric, numeric, numeric, uuid, text, text, text),
  public.update_product(uuid, text, public.stock_unit, numeric, numeric, numeric, uuid, text, text, text, boolean),
  public.set_product_active(uuid, boolean),
  public.adjust_stock(uuid, public.stock_movement_type, numeric, text, uuid),
  public.create_sale(uuid, jsonb, public.payment_method, numeric, uuid, numeric, text, text, text),
  public.void_transaction(uuid, text),
  public.open_cash_session(uuid, numeric),
  public.close_cash_session(uuid, numeric, text),
  public.get_sales_report(date, date, uuid, boolean),
  public.role_default_permissions(public.app_role), public.all_permissions(),
  public.is_owner(), public.has_outlet_access(uuid), public.has_permission(uuid, text), public.my_access()
to authenticated;

-- fungsi private dipanggil dari dalam fungsi SECURITY DEFINER (pemilik: postgres)
grant usage on schema private to postgres;

-- ┌──────────────────────────────────────────────────────────────────
-- │ 20261121000400_dashboard_products.sql
-- └──────────────────────────────────────────────────────────────────
-- =====================================================================
-- MUN PARFUM POS — 0400 Dashboard & foto produk (Fase 3)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ringkasan beranda dalam satu panggilan, menyesuaikan izin:
--  * transactions.view_all → angka outlet; selain itu → transaksi sendiri
--  * profit.view           → laba kotor
--  * expenses.view/manage  → pengeluaran hari ini
--  * products/stock.manage → daftar stok menipis
-- ---------------------------------------------------------------------
create function public.get_dashboard(p_outlet_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_today date := private.business_date();
  v_all boolean;
  v_profit boolean;
  v_exp boolean;
  v_stock boolean;
  v_sum record;
begin
  if not public.has_outlet_access(p_outlet_id) then
    raise exception 'Akses ditolak' using errcode = '42501';
  end if;
  v_all    := public.has_permission(p_outlet_id, 'transactions.view_all');
  v_profit := public.has_permission(p_outlet_id, 'profit.view');
  v_exp    := public.has_permission(p_outlet_id, 'expenses.view') or public.has_permission(p_outlet_id, 'expenses.manage');
  v_stock  := public.has_permission(p_outlet_id, 'products.manage') or public.has_permission(p_outlet_id, 'stock.manage');

  select count(*) as cnt, coalesce(sum(total), 0) as omzet, coalesce(sum(gross_profit), 0) as gp
  into v_sum
  from public.transactions
  where outlet_id = p_outlet_id and business_date = v_today and status = 'completed'
    and (v_all or cashier_id = v_uid);

  return jsonb_build_object(
    'business_date', v_today,
    'scope', case when v_all then 'outlet' else 'own' end,
    'transaction_count', v_sum.cnt,
    'omzet', v_sum.omzet,
    'gross_profit', case when v_profit then v_sum.gp end,
    'expenses_total', case when v_exp then (
      select coalesce(sum(amount), 0) from public.expenses
      where outlet_id = p_outlet_id and expense_date = v_today and deleted_at is null) end,
    'expenses_count', case when v_exp then (
      select count(*) from public.expenses
      where outlet_id = p_outlet_id and expense_date = v_today and deleted_at is null) end,
    'product_count', (select count(*) from public.products where outlet_id = p_outlet_id and is_active),
    'low_stock', case when v_stock then coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sku', sku, 'unit', unit,
                         'current_stock', current_stock, 'min_stock', min_stock)
                       order by current_stock - min_stock, name)
      from (select * from public.products
            where outlet_id = p_outlet_id and is_active and current_stock <= min_stock
            order by current_stock - min_stock, name
            limit 10) s), '[]') end,
    'recent_transactions', coalesce((
      select jsonb_agg(r order by r ->> 'created_at' desc) from (
        select jsonb_build_object(
          'id', t.id, 'number', t.number, 'total', t.total, 'status', t.status,
          'payment_method', t.payment_method, 'created_at', t.created_at,
          'items', (select string_agg(i.product_name, ', ' order by i.created_at, i.product_name)
                    from public.transaction_items i where i.transaction_id = t.id)) r
        from public.transactions t
        where t.outlet_id = p_outlet_id and (v_all or t.cashier_id = v_uid)
        order by t.created_at desc
        limit 5) q), '[]')
  );
end $$;

revoke all on function public.get_dashboard(uuid) from public, anon;
grant execute on function public.get_dashboard(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Foto produk: bucket publik 'product-images', path '<outlet_id>/<uuid>.<ext>'.
-- Hanya pengguna dengan izin products.manage di outlet tsb yang dapat
-- mengunggah/menghapus. Foto produk tidak bersifat rahasia (dibaca publik).
-- ---------------------------------------------------------------------
create function public.safe_uuid(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;
revoke all on function public.safe_uuid(text) from public, anon;
grant execute on function public.safe_uuid(text) to authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('product-images', 'product-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    execute $p$create policy product_images_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'product-images'
        and public.has_permission(public.safe_uuid((storage.foldername(name))[1]), 'products.manage'))$p$;
    execute $p$create policy product_images_select on storage.objects for select to authenticated
      using (bucket_id = 'product-images'
        and public.has_outlet_access(public.safe_uuid((storage.foldername(name))[1])))$p$;
    execute $p$create policy product_images_delete on storage.objects for delete to authenticated
      using (bucket_id = 'product-images'
        and public.has_permission(public.safe_uuid((storage.foldername(name))[1]), 'products.manage'))$p$;
  end if;
end $$;

-- ┌──────────────────────────────────────────────────────────────────
-- │ 20261121000500_stock.sql
-- └──────────────────────────────────────────────────────────────────
-- =====================================================================
-- MUN PARFUM POS — 0500 Stok & riwayat pergerakan (Fase 4)
-- Perubahan stok tetap hanya lewat public.adjust_stock / create_sale /
-- void_transaction (0300). File ini menambah fungsi baca.
-- =====================================================================

-- Riwayat pergerakan stok dengan nama produk, pengguna, dan nomor transaksi.
-- Tanggal difilter menurut tanggal WITA dari created_at.
create function public.get_stock_movements(
  p_outlet_id  uuid,
  p_product_id uuid default null,
  p_from       date default null,
  p_to         date default null,
  p_types      public.stock_movement_type[] default null,
  p_limit      integer default 50,
  p_offset     integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  perform private.require_auth();
  if not (public.has_permission(p_outlet_id, 'stock.manage') or public.has_permission(p_outlet_id, 'reports.view')) then
    raise exception 'Akses ditolak: izin stock.manage diperlukan' using errcode = '42501';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'Rentang tanggal tidak valid' using errcode = '22023';
  end if;

  return (
    with m as (
      select sm.*
      from public.stock_movements sm
      where sm.outlet_id = p_outlet_id
        and (p_product_id is null or sm.product_id = p_product_id)
        and (p_types is null or sm.movement_type = any (p_types))
        and (p_from is null or private.business_date(sm.created_at) >= p_from)
        and (p_to is null or private.business_date(sm.created_at) <= p_to)
    )
    select jsonb_build_object(
      'total', (select count(*) from m),
      'summary', coalesce((
        select jsonb_agg(jsonb_build_object('movement_type', movement_type, 'count', c, 'quantity', q) order by movement_type)
        from (select movement_type, count(*) c, sum(quantity) q from m group by movement_type) s), '[]'),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', x.id, 'created_at', x.created_at, 'movement_type', x.movement_type,
          'quantity', x.quantity, 'stock_before', x.stock_before, 'stock_after', x.stock_after,
          'reason', x.reason, 'product_id', x.product_id, 'product_name', p.name, 'sku', p.sku,
          'unit', p.unit, 'user_name', pr.full_name, 'transaction_id', x.transaction_id,
          'transaction_number', t.number) order by x.created_at desc, x.id)
        from (select * from m order by created_at desc, id limit v_limit offset v_offset) x
        join public.products p on p.id = x.product_id
        left join public.profiles pr on pr.id = x.created_by
        left join public.transactions t on t.id = x.transaction_id), '[]')
    )
  );
end $$;

-- Ringkasan persediaan outlet. Nilai berdasarkan HPP hanya untuk cost.view.
-- Stok minus (jika diizinkan) tidak menambah nilai persediaan.
create function public.get_stock_summary(p_outlet_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cost boolean;
begin
  perform private.require_auth();
  if not (public.has_permission(p_outlet_id, 'stock.manage') or public.has_permission(p_outlet_id, 'products.manage')) then
    raise exception 'Akses ditolak: izin stock.manage diperlukan' using errcode = '42501';
  end if;
  v_cost := public.has_permission(p_outlet_id, 'cost.view');
  return (
    select jsonb_build_object(
      'active_count', count(*),
      'low_count', count(*) filter (where current_stock > 0 and current_stock <= min_stock),
      'empty_count', count(*) filter (where current_stock <= 0),
      'value_at_sell_price', coalesce(sum(round(greatest(current_stock, 0) * sell_price, 2)), 0),
      'value_at_cost', case when v_cost then coalesce(sum(round(greatest(current_stock, 0) * cost_price, 2)), 0) end
    )
    from public.products
    where outlet_id = p_outlet_id and is_active
  );
end $$;

revoke all on function public.get_stock_movements(uuid, uuid, date, date, public.stock_movement_type[], integer, integer),
                       public.get_stock_summary(uuid) from public, anon;
grant execute on function public.get_stock_movements(uuid, uuid, date, date, public.stock_movement_type[], integer, integer),
                          public.get_stock_summary(uuid) to authenticated;

-- ┌──────────────────────────────────────────────────────────────────
-- │ 20261121000600_transactions.sql
-- └──────────────────────────────────────────────────────────────────
-- =====================================================================
-- MUN PARFUM POS — 0600 Riwayat transaksi & struk (Fase 5)
-- Penjualan disimpan oleh public.create_sale (0300). File ini menambah
-- fungsi baca untuk riwayat transaksi dan data struk.
-- =====================================================================

create function private.setting_text(p_outlet_id uuid, p_key text, p_default text) returns text
language sql stable set search_path = '' as $$
  select coalesce(
    (select value #>> '{}' from public.app_settings where outlet_id = p_outlet_id and key = p_key),
    (select value #>> '{}' from public.app_settings where outlet_id is null and key = p_key),
    p_default)
$$;

-- Daftar transaksi. Tanpa izin transactions.view_all → hanya milik sendiri.
create function public.get_transactions(
  p_outlet_id uuid,
  p_from      date,
  p_to        date,
  p_status    public.transaction_status default null,
  p_method    public.payment_method default null,
  p_search    text default null,
  p_limit     integer default 50,
  p_offset    integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_all boolean;
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_search text := nullif(btrim(p_search), '');
begin
  if not public.has_outlet_access(p_outlet_id) then
    raise exception 'Akses ditolak' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Rentang tanggal tidak valid' using errcode = '22023';
  end if;
  if p_to - p_from > 366 then
    raise exception 'Rentang maksimal 1 tahun' using errcode = '22023';
  end if;
  v_all := public.has_permission(p_outlet_id, 'transactions.view_all');

  return (
    with t as (
      select tr.*
      from public.transactions tr
      where tr.outlet_id = p_outlet_id
        and tr.business_date between p_from and p_to
        and (v_all or tr.cashier_id = v_uid)
        and (p_status is null or tr.status = p_status)
        and (p_method is null or tr.payment_method = p_method)
        and (v_search is null or tr.number ilike '%' || v_search || '%'
             or tr.customer_name ilike '%' || v_search || '%'
             or exists (select 1 from public.transaction_items i
                        where i.transaction_id = tr.id and i.product_name ilike '%' || v_search || '%'))
    )
    select jsonb_build_object(
      'scope', case when v_all then 'outlet' else 'own' end,
      'total', (select count(*) from t),
      'completed_count', (select count(*) from t where status = 'completed'),
      'completed_amount', (select coalesce(sum(total), 0) from t where status = 'completed'),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', x.id, 'number', x.number, 'created_at', x.created_at, 'business_date', x.business_date,
          'status', x.status, 'total', x.total, 'payment_method', x.payment_method, 'item_count', x.item_count,
          'customer_name', x.customer_name, 'cashier_name', pr.full_name,
          'items', (select string_agg(i.product_name, ', ' order by i.created_at, i.product_name)
                    from public.transaction_items i where i.transaction_id = x.id))
          order by x.created_at desc, x.number desc)
        from (select * from t order by created_at desc, number desc limit v_limit offset greatest(coalesce(p_offset, 0), 0)) x
        left join public.profiles pr on pr.id = x.cashier_id), '[]')
    )
  );
end $$;

-- Detail transaksi untuk tampilan & struk (termasuk cetak ulang).
create function public.get_transaction_detail(p_transaction_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_t public.transactions;
  v_profit boolean;
begin
  select * into v_t from public.transactions where id = p_transaction_id;
  if not found or not (
       public.has_permission(v_t.outlet_id, 'transactions.view_all')
       or (v_t.cashier_id = v_uid and public.has_outlet_access(v_t.outlet_id))) then
    -- pesan sama untuk "tidak ada" dan "tidak boleh" agar tidak membocorkan keberadaan data
    raise exception 'Transaksi tidak ditemukan' using errcode = 'P0002';
  end if;
  v_profit := public.has_permission(v_t.outlet_id, 'profit.view');

  return jsonb_build_object(
    'id', v_t.id, 'number', v_t.number, 'business_date', v_t.business_date, 'created_at', v_t.created_at,
    'status', v_t.status, 'customer_name', v_t.customer_name, 'note', v_t.note,
    'subtotal', v_t.subtotal, 'item_discount_total', v_t.item_discount_total,
    'discount_amount', v_t.discount_amount, 'total', v_t.total, 'item_count', v_t.item_count,
    'payment_method', v_t.payment_method, 'amount_paid', v_t.amount_paid, 'change_amount', v_t.change_amount,
    'cost_total', case when v_profit then v_t.cost_total end,
    'gross_profit', case when v_profit then v_t.gross_profit end,
    'voided_at', v_t.voided_at, 'void_reason', v_t.void_reason,
    'voided_by_name', (select full_name from public.profiles where id = v_t.voided_by),
    'cashier_name', (select full_name from public.profiles where id = v_t.cashier_id),
    'can_void', v_t.status = 'completed' and public.has_permission(v_t.outlet_id, 'transactions.void'),
    'outlet', (select jsonb_build_object('name', o.name, 'code', o.code, 'address', o.address, 'phone', o.phone)
               from public.outlets o where o.id = v_t.outlet_id),
    'receipt_footer', private.setting_text(v_t.outlet_id, 'receipt_footer', 'Terima kasih atas kunjungan Anda'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'product_id', i.product_id, 'product_name', i.product_name, 'sku', i.sku, 'unit', i.unit,
        'quantity', i.quantity, 'unit_price', i.unit_price, 'subtotal', i.subtotal,
        'discount_amount', i.discount_amount, 'total', i.total,
        'gross_profit', case when v_profit then i.gross_profit end) order by i.created_at, i.product_name)
      from public.transaction_items i where i.transaction_id = v_t.id), '[]'),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('method', p.method, 'amount', p.amount, 'amount_received', p.amount_received,
                                          'change_amount', p.change_amount, 'reference', p.reference))
      from public.payments p where p.transaction_id = v_t.id), '[]')
  );
end $$;

revoke all on function public.get_transactions(uuid, date, date, public.transaction_status, public.payment_method, text, integer, integer),
                       public.get_transaction_detail(uuid) from public, anon;
grant execute on function public.get_transactions(uuid, date, date, public.transaction_status, public.payment_method, text, integer, integer),
                          public.get_transaction_detail(uuid) to authenticated;

-- ┌──────────────────────────────────────────────────────────────────
-- │ 20261121000700_reports_expenses.sql
-- └──────────────────────────────────────────────────────────────────
-- =====================================================================
-- MUN PARFUM POS — 0700 Pengeluaran & closing (Fase 6)
-- Laporan penjualan: public.get_sales_report (0300).
-- Penulisan pengeluaran: langsung ke tabel expenses dengan RLS + audit.
-- =====================================================================

-- Daftar pengeluaran dengan total per kategori.
create function public.get_expenses(
  p_outlet_id uuid,
  p_from      date,
  p_to        date,
  p_category  public.expense_category default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_auth();
  if not (public.has_permission(p_outlet_id, 'expenses.view') or public.has_permission(p_outlet_id, 'expenses.manage')) then
    raise exception 'Akses ditolak: izin expenses.view diperlukan' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Rentang tanggal tidak valid' using errcode = '22023';
  end if;
  if p_to - p_from > 366 then
    raise exception 'Rentang maksimal 1 tahun' using errcode = '22023';
  end if;
  return (
    with e as (
      select * from public.expenses
      where outlet_id = p_outlet_id and deleted_at is null
        and expense_date between p_from and p_to
        and (p_category is null or category = p_category)
    )
    select jsonb_build_object(
      'count', (select count(*) from e),
      'total_amount', (select coalesce(sum(amount), 0) from e),
      'by_category', coalesce((
        select jsonb_agg(jsonb_build_object('category', category, 'count', c, 'amount', a) order by a desc)
        from (select category, count(*) c, sum(amount) a from e group by category) s), '[]'),
      'can_manage', public.has_permission(p_outlet_id, 'expenses.manage'),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id, 'expense_date', e.expense_date, 'category', e.category, 'amount', e.amount,
          'description', e.description, 'created_by_name', pr.full_name, 'created_at', e.created_at)
          order by e.expense_date desc, e.created_at desc)
        from e left join public.profiles pr on pr.id = e.created_by), '[]')
    )
  );
end $$;

-- Ringkasan satu sesi kas (dipakai untuk sesi aktif & daftar closing).
create function private.cash_session_json(p_session public.cash_sessions) returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (
    select t.id, t.status, p.method, p.amount
    from public.transactions t join public.payments p on p.transaction_id = t.id
    where t.cash_session_id = p_session.id
  )
  select jsonb_build_object(
    'id', p_session.id, 'outlet_id', p_session.outlet_id, 'status', p_session.status,
    'opened_at', p_session.opened_at, 'closed_at', p_session.closed_at,
    'opened_by_name', (select full_name from public.profiles where id = p_session.opened_by),
    'closed_by_name', (select full_name from public.profiles where id = p_session.closed_by),
    'opening_cash', p_session.opening_cash,
    'transaction_count', (select count(distinct id) from t where status = 'completed'),
    'sales_total', (select coalesce(sum(amount), 0) from t where status = 'completed'),
    'cash_sales', (select coalesce(sum(amount), 0) from t where status = 'completed' and method = 'cash'),
    'by_payment_method', coalesce((
      select jsonb_agg(jsonb_build_object('method', method, 'amount', a) order by a desc)
      from (select method, sum(amount) a from t where status = 'completed' group by method) m), '[]'),
    'expected_cash', coalesce(p_session.expected_cash,
      p_session.opening_cash + (select coalesce(sum(amount), 0) from t where status = 'completed' and method = 'cash')),
    'counted_cash', p_session.counted_cash,
    'cash_difference', p_session.cash_difference,
    'note', p_session.note
  )
$$;

-- Sesi kas terbuka milik pengguna saat ini di outlet (null jika tidak ada).
create function public.get_my_cash_session(p_outlet_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_s public.cash_sessions;
begin
  if not public.has_outlet_access(p_outlet_id) then
    raise exception 'Akses ditolak' using errcode = '42501';
  end if;
  select * into v_s from public.cash_sessions where outlet_id = p_outlet_id and opened_by = v_uid and status = 'open';
  if not found then
    return null;
  end if;
  return private.cash_session_json(v_s) || jsonb_build_object('can_close', public.has_permission(p_outlet_id, 'closing.perform'));
end $$;

-- Daftar sesi kas yang dibuka pada rentang tanggal (WITA).
create function public.get_cash_sessions(p_outlet_id uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_all boolean;
begin
  if not public.has_outlet_access(p_outlet_id) then
    raise exception 'Akses ditolak' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Rentang tanggal tidak valid' using errcode = '22023';
  end if;
  v_all := public.has_permission(p_outlet_id, 'reports.view') or public.has_permission(p_outlet_id, 'closing.perform');
  return coalesce((
    select jsonb_agg(private.cash_session_json(s) order by s.opened_at desc)
    from public.cash_sessions s
    where s.outlet_id = p_outlet_id
      and private.business_date(s.opened_at) between p_from and p_to
      and (v_all or s.opened_by = v_uid)), '[]');
end $$;

revoke all on function public.get_expenses(uuid, date, date, public.expense_category),
                       public.get_my_cash_session(uuid), public.get_cash_sessions(uuid, date, date) from public, anon;
grant execute on function public.get_expenses(uuid, date, date, public.expense_category),
                          public.get_my_cash_session(uuid), public.get_cash_sessions(uuid, date, date) to authenticated;
revoke all on function private.cash_session_json(public.cash_sessions) from public, anon, authenticated;

-- ┌──────────────────────────────────────────────────────────────────
-- │ 20261121000800_staff_outlets_settings.sql
-- └──────────────────────────────────────────────────────────────────
-- =====================================================================
-- MUN PARFUM POS — 0800 Karyawan, outlet, pengaturan, audit (Fase 7)
--
-- Aturan pengelolaan karyawan:
--  * Owner  : mengelola admin & kasir di semua outlet, izin apa pun.
--  * Admin dengan users.manage: hanya KASIR di outlet tsb, hanya izin
--    tambahan yang aman (delegable), tidak bisa mengubah diri sendiri,
--    tidak bisa menyentuh admin/owner.
-- Pembuatan akun Auth (butuh service_role) dilakukan Edge Function
-- `admin-users`, yang memanggil fungsi di bawah ini SEBAGAI pemanggil.
-- =====================================================================

-- Kode outlet menjadi bagian nomor transaksi → tidak boleh diubah setelah dipakai
create function private.guard_outlet_code() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.code is distinct from old.code
     and exists (select 1 from public.transactions where outlet_id = old.id) then
    raise exception 'Kode outlet tidak dapat diubah karena sudah dipakai pada nomor transaksi' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_outlet_code before update of code on public.outlets
  for each row execute function private.guard_outlet_code();

create function public.delegable_permissions() returns text[]
language sql immutable set search_path = '' as $$
  select array['closing.perform', 'transactions.view_all']
$$;

create function public.can_manage_staff(p_outlet_id uuid, p_role public.app_role, p_permissions text[] default '{}')
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when auth.uid() is null then false
    when p_role = 'owner' then false
    when public.is_owner() then exists (select 1 from public.outlets where id = p_outlet_id)
    else p_role = 'kasir'
         and public.has_permission(p_outlet_id, 'users.manage')
         and coalesce(p_permissions, '{}') <@ public.delegable_permissions()
  end
$$;

-- Boleh mengelola akun (reset sandi, ubah nama, dsb.) pengguna tertentu?
create function public.can_manage_user(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when auth.uid() is null or p_user_id = auth.uid() then false
    when public.is_owner() then not exists (select 1 from public.profiles where id = p_user_id and is_owner)
    else exists (select 1 from public.profiles where id = p_user_id and not is_owner)
         -- target hanya kasir (tidak punya peran admin di mana pun)
         and not exists (select 1 from public.outlet_users where user_id = p_user_id and role = 'admin')
         -- dan semua penugasannya ada di outlet yang boleh dikelola pemanggil
         and exists (select 1 from public.outlet_users where user_id = p_user_id)
         and not exists (select 1 from public.outlet_users ou
                         where ou.user_id = p_user_id and not public.has_permission(ou.outlet_id, 'users.manage'))
  end
$$;

create function public.assign_outlet_user(
  p_user_id     uuid,
  p_outlet_id   uuid,
  p_role        public.app_role,
  p_permissions text[] default '{}',
  p_revoked     text[] default '{}',
  p_active      boolean default true
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_existing public.outlet_users;
  v_id uuid;
begin
  if p_user_id = v_uid then
    raise exception 'Tidak dapat mengubah penugasan akun sendiri' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = p_user_id and is_owner) then
    raise exception 'Pemilik memiliki akses ke semua outlet' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Pengguna tidak ditemukan' using errcode = 'P0002';
  end if;
  select * into v_existing from public.outlet_users where outlet_id = p_outlet_id and user_id = p_user_id;
  if found and v_existing.role <> 'kasir' and not public.is_owner() then
    raise exception 'Akses ditolak: hanya pemilik yang dapat mengubah admin' using errcode = '42501';
  end if;
  if not public.can_manage_staff(p_outlet_id, p_role, p_permissions) then
    raise exception 'Akses ditolak: tidak boleh menetapkan peran/izin ini' using errcode = '42501';
  end if;
  if not public.is_owner() and exists (
       select 1 from public.outlet_users where user_id = p_user_id and role = 'admin') then
    raise exception 'Akses ditolak: hanya pemilik yang dapat mengubah admin' using errcode = '42501';
  end if;

  insert into public.outlet_users (outlet_id, user_id, role, permissions, revoked_permissions, is_active)
  values (p_outlet_id, p_user_id, p_role, coalesce(p_permissions, '{}'), coalesce(p_revoked, '{}'), coalesce(p_active, true))
  on conflict (outlet_id, user_id) do update set
    role = excluded.role, permissions = excluded.permissions,
    revoked_permissions = excluded.revoked_permissions, is_active = excluded.is_active
  returning id into v_id;
  return v_id;
end $$;

-- Nonaktifkan/aktifkan seluruh akun (owner saja). Akun nonaktif kehilangan
-- semua akses data karena seluruh fungsi izin memeriksa profiles.is_active.
create function public.set_staff_active(p_user_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_auth();
  if not public.is_owner() then
    raise exception 'Akses ditolak: hanya pemilik' using errcode = '42501';
  end if;
  if not public.can_manage_user(p_user_id) then
    raise exception 'Tidak dapat mengubah status akun ini' using errcode = '42501';
  end if;
  update public.profiles set is_active = p_active where id = p_user_id;
end $$;

create function public.update_staff_name(p_user_id uuid, p_full_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_auth();
  if not (p_user_id = auth.uid() or public.can_manage_user(p_user_id)) then
    raise exception 'Akses ditolak' using errcode = '42501';
  end if;
  update public.profiles set full_name = btrim(p_full_name) where id = p_user_id;
end $$;

-- Daftar karyawan yang terlihat oleh pemanggil.
create function public.list_staff() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_owner boolean := public.is_owner();
begin
  if not v_owner and not exists (
       select 1 from public.outlet_users ou where public.has_permission(ou.outlet_id, 'users.manage')) then
    raise exception 'Akses ditolak: izin users.manage diperlukan' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'full_name', p.full_name, 'username', p.username, 'is_owner', p.is_owner,
      'is_active', p.is_active, 'created_at', p.created_at, 'is_self', p.id = v_uid,
      'can_manage', public.can_manage_user(p.id),
      'assignments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', ou.id, 'outlet_id', ou.outlet_id, 'outlet_code', o.code, 'outlet_name', o.name,
          'role', ou.role, 'permissions', ou.permissions, 'revoked_permissions', ou.revoked_permissions,
          'is_active', ou.is_active) order by o.code)
        from public.outlet_users ou join public.outlets o on o.id = ou.outlet_id
        where ou.user_id = p.id and (v_owner or public.has_permission(ou.outlet_id, 'users.manage'))), '[]'))
      order by p.is_owner desc, p.is_active desc, p.full_name)
    from public.profiles p
    where v_owner
       or p.id = v_uid
       or exists (select 1 from public.outlet_users ou
                  where ou.user_id = p.id and public.has_permission(ou.outlet_id, 'users.manage'))), '[]');
end $$;

-- Riwayat audit (owner / audit.view).
create function public.get_audit_logs(
  p_from      date,
  p_to        date,
  p_outlet_id uuid default null,
  p_user_id   uuid default null,
  p_entity    text default null,
  p_limit     integer default 50,
  p_offset    integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  perform private.require_auth();
  if not (public.is_owner() or (p_outlet_id is not null and public.has_permission(p_outlet_id, 'audit.view'))) then
    raise exception 'Akses ditolak: izin audit.view diperlukan' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Rentang tanggal tidak valid' using errcode = '22023';
  end if;
  return (
    with a as (
      select * from public.audit_logs l
      where private.business_date(l.created_at) between p_from and p_to
        and (p_outlet_id is null or l.outlet_id = p_outlet_id)
        and (p_user_id is null or l.user_id = p_user_id)
        and (p_entity is null or l.entity = p_entity)
    )
    select jsonb_build_object(
      'total', (select count(*) from a),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', x.id, 'created_at', x.created_at, 'action', x.action, 'entity', x.entity, 'entity_id', x.entity_id,
          'details', x.details, 'user_name', pr.full_name, 'outlet_code', o.code) order by x.created_at desc, x.id)
        from (select * from a order by created_at desc, id limit v_limit offset greatest(coalesce(p_offset, 0), 0)) x
        left join public.profiles pr on pr.id = x.user_id
        left join public.outlets o on o.id = x.outlet_id), '[]'))
  );
end $$;

-- Pengaturan outlet dengan daftar kunci yang diizinkan.
create function public.get_settings(p_outlet_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_auth();
  if not public.has_outlet_access(p_outlet_id) then
    raise exception 'Akses ditolak' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'allow_negative_stock', private.setting_bool(p_outlet_id, 'allow_negative_stock', false),
    'receipt_footer', private.setting_text(p_outlet_id, 'receipt_footer', 'Terima kasih atas kunjungan Anda'),
    'can_manage', public.has_permission(p_outlet_id, 'settings.manage'),
    'can_manage_negative_stock', public.is_owner());
end $$;

create function public.set_setting(p_outlet_id uuid, p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_auth();
  case p_key
    when 'allow_negative_stock' then
      -- izin khusus: hanya owner (spesifikasi bagian 3)
      if not public.is_owner() then
        raise exception 'Akses ditolak: hanya pemilik yang dapat mengizinkan stok minus' using errcode = '42501';
      end if;
      if jsonb_typeof(p_value) <> 'boolean' then
        raise exception 'Nilai harus true/false' using errcode = '22023';
      end if;
    when 'receipt_footer' then
      perform private.require_permission(p_outlet_id, 'settings.manage');
      if jsonb_typeof(p_value) <> 'string' or length(p_value #>> '{}') > 200 then
        raise exception 'Footer struk berupa teks maksimal 200 karakter' using errcode = '22023';
      end if;
    else
      raise exception 'Pengaturan % tidak dikenal', p_key using errcode = '22023';
  end case;
  insert into public.app_settings (outlet_id, key, value, updated_by)
  values (p_outlet_id, p_key, p_value, auth.uid())
  on conflict (outlet_id, key) do update set value = excluded.value, updated_by = excluded.updated_by;
end $$;

revoke all on function public.delegable_permissions(), public.can_manage_staff(uuid, public.app_role, text[]),
  public.can_manage_user(uuid), public.assign_outlet_user(uuid, uuid, public.app_role, text[], text[], boolean),
  public.set_staff_active(uuid, boolean), public.update_staff_name(uuid, text), public.list_staff(),
  public.get_audit_logs(date, date, uuid, uuid, text, integer, integer), public.get_settings(uuid),
  public.set_setting(uuid, text, jsonb) from public, anon;
grant execute on function public.delegable_permissions(), public.can_manage_staff(uuid, public.app_role, text[]),
  public.can_manage_user(uuid), public.assign_outlet_user(uuid, uuid, public.app_role, text[], text[], boolean),
  public.set_staff_active(uuid, boolean), public.update_staff_name(uuid, text), public.list_staff(),
  public.get_audit_logs(date, date, uuid, uuid, text, integer, integer), public.get_settings(uuid),
  public.set_setting(uuid, text, jsonb) to authenticated;

-- Penjaga profil diperbarui: selain diri sendiri, non-owner boleh mengubah
-- NAMA pengguna yang boleh dikelolanya (kasir di outletnya). Status aktif,
-- owner, dan username tetap hanya dapat diubah owner.
create or replace function private.guard_profile_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and not public.is_owner() then
    if new.is_owner is distinct from old.is_owner or new.is_active is distinct from old.is_active
       or new.username is distinct from old.username then
      raise exception 'Tidak diizinkan mengubah data akun ini' using errcode = '42501';
    end if;
    if new.id <> auth.uid() and not public.can_manage_user(new.id) then
      raise exception 'Tidak diizinkan mengubah data akun ini' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- ┌──────────────────────────────────────────────────────────────────
-- │ 20261121000900_hardening.sql
-- └──────────────────────────────────────────────────────────────────
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


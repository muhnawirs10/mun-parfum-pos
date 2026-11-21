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

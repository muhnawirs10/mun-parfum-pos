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

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

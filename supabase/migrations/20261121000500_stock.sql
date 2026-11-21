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

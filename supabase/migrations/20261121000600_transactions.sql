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

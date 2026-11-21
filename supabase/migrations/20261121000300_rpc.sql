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

-- =====================================================================
-- Data contoh (opsional) — jalankan di Supabase SQL Editor SETELAH
-- private.bootstrap_owner(...). Ganti 'TKL' dengan kode outlet Anda.
-- Stok awal dicatat sebagai pergerakan 'initial' (bukan update langsung).
-- =====================================================================
do $$
declare
  v_outlet uuid := (select id from public.outlets where code = 'TKL');
  v_cat uuid;
  r record;
  v_id uuid;
  v_n int := 0;
begin
  if v_outlet is null then raise exception 'Outlet TKL tidak ditemukan'; end if;
  insert into public.categories (outlet_id, name) values (v_outlet, 'Parfum')
    on conflict do nothing;
  select id into v_cat from public.categories where outlet_id = v_outlet and lower(name) = 'parfum';

  for r in select * from (values
    ('VALENTINE / SCANDALOUS', 2000, 1014, 307),
    ('AIGNER BLUE / BLUE EMO', 3000, 1212, 231),
    ('DIVA / PSM',             2000, 1000, 215),
    ('DIOR SAUVAGE',           2000, 1000, 250),
    ('SELENA GOMES',           2000, 1000, 148.5),
    ('VANILA ICE',             2000, 1000, 218),
    ('ROMANTIC WISH',          2000, 1000, 112)
  ) as t(name, price, cost, stock)
  loop
    v_n := v_n + 1;
    insert into public.products (outlet_id, category_id, sku, name, unit, sell_price, cost_price)
    values (v_outlet, v_cat, 'TKL-' || lpad(private.next_counter(v_outlet, 'sku')::text, 4, '0'),
            r.name, 'ML', r.price, r.cost)
    returning id into v_id;
    perform private.apply_stock_change(v_id, r.stock, 'initial', 'Stok awal (seed)');
  end loop;
end $$;

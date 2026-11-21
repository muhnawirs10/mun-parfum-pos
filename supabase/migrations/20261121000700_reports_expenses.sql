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

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

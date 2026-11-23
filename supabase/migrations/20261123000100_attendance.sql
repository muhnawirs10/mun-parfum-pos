-- =====================================================================
-- MUN PARFUM POS — 1000 Absensi karyawan (QR cetak + GPS + selfie + izin)
--
-- Aturan (diperiksa di SERVER, bukan di HP):
--   * QR cetak berisi token rahasia outlet (bisa dibuat ulang bila bocor)
--   * jarak ke titik toko ≤ attendance_radius_m (bawaan 10 m)
--   * akurasi GPS ≤ attendance_max_accuracy_m (bawaan 30 m)
--   * satu HP disetujui per karyawan (HP pertama otomatis disetujui)
--   * foto selfie wajib, tersimpan di bucket privat 'attendance'
--   * percobaan yang ditolak dicatat di attendance_attempts
-- Status "mangkir" DIHITUNG (tidak absen & tanpa izin disetujui), bukan diajukan.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Izin baru: attendance.manage (bawaan: owner)
-- ---------------------------------------------------------------------
create or replace function public.role_default_permissions(p_role public.app_role)
returns text[] language sql immutable set search_path = '' as $$
  select case p_role
    when 'owner' then array[
      'pos.sell','transactions.view_all','transactions.void','products.manage','stock.manage',
      'cost.view','profit.view','reports.view','expenses.view','expenses.manage',
      'closing.perform','users.manage','settings.manage','audit.view','attendance.manage']
    when 'admin' then array[
      'pos.sell','transactions.view_all','transactions.void','products.manage','stock.manage',
      'cost.view','reports.view','closing.perform']
    when 'kasir' then array['pos.sell']
  end
$$;

-- ---------------------------------------------------------------------
-- Pengaturan absensi per outlet
-- ---------------------------------------------------------------------
alter table public.outlets
  add column latitude double precision check (latitude between -90 and 90),
  add column longitude double precision check (longitude between -180 and 180),
  add column attendance_radius_m integer not null default 10 check (attendance_radius_m between 5 and 200),
  add column attendance_max_accuracy_m integer not null default 30 check (attendance_max_accuracy_m between 5 and 200),
  add column attendance_token text not null
    default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  -- tanggal absensi mulai berlaku (diisi saat lokasi toko pertama kali diatur);
  -- hari sebelumnya tidak dihitung mangkir
  add column attendance_since date,
  add column work_start_time time not null default '09:00',
  add column late_tolerance_minutes integer not null default 10 check (late_tolerance_minutes between 0 and 180),
  add column work_days smallint[] not null default '{1,2,3,4,5,6,7}'
    check (work_days <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(work_days) between 1 and 7),
  add constraint outlets_location_pair check ((latitude is null) = (longitude is null));

-- Token QR TIDAK boleh terbaca karyawan (kalau terbaca, QR bisa dibuat sendiri).
revoke select on public.outlets from authenticated;
grant select (id, code, name, address, phone, logo_url, is_active, created_at, updated_at,
              latitude, longitude, attendance_radius_m, attendance_max_accuracy_m, attendance_since,
              work_start_time, late_tolerance_minutes, work_days)
  on public.outlets to authenticated;
-- pengaturan absensi hanya lewat RPC (dengan validasi akurasi & audit)
revoke update on public.outlets from authenticated;
grant update (code, name, address, phone, logo_url, is_active) on public.outlets to authenticated;

-- ---------------------------------------------------------------------
-- Tabel
-- ---------------------------------------------------------------------
create type public.leave_type as enum ('sakit', 'izin', 'cuti', 'libur');
create type public.leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table public.attendance_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  device_id    text not null check (device_id ~ '^[A-Za-z0-9-]{16,100}$'),
  label        text check (label is null or length(label) <= 160),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  approved_by  uuid references public.profiles (id),
  approved_at  timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, device_id)
);
create unique index attendance_devices_one_approved on public.attendance_devices (user_id) where status = 'approved';

create table public.attendance_records (
  id                     uuid primary key default gen_random_uuid(),
  outlet_id              uuid not null references public.outlets (id) on delete restrict,
  user_id                uuid not null references public.profiles (id) on delete restrict,
  business_date          date not null,
  check_in_at            timestamptz not null,
  check_in_lat           double precision not null,
  check_in_lng           double precision not null,
  check_in_accuracy_m    numeric(8,1) not null,
  check_in_distance_m    numeric(8,1) not null,
  check_in_photo_path    text not null,
  check_in_device_id     text not null,
  late_minutes           integer not null default 0 check (late_minutes >= 0),
  check_out_at           timestamptz,
  check_out_lat          double precision,
  check_out_lng          double precision,
  check_out_accuracy_m   numeric(8,1),
  check_out_distance_m   numeric(8,1),
  check_out_photo_path   text,
  check_out_device_id    text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (user_id, business_date),
  check (check_out_at is null or check_out_at >= check_in_at)
);
create index attendance_records_outlet_date_idx on public.attendance_records (outlet_id, business_date);

create table public.attendance_attempts (
  id          uuid primary key default gen_random_uuid(),
  outlet_id   uuid not null references public.outlets (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('in', 'out')),
  reason      text not null,
  message     text not null,
  lat         double precision,
  lng         double precision,
  accuracy_m  numeric(8,1),
  distance_m  numeric(10,1),
  device_id   text,
  created_at  timestamptz not null default now()
);
create index attendance_attempts_outlet_idx on public.attendance_attempts (outlet_id, created_at desc);

create table public.leave_requests (
  id              uuid primary key default gen_random_uuid(),
  outlet_id       uuid not null references public.outlets (id) on delete restrict,
  user_id         uuid not null references public.profiles (id) on delete restrict,
  leave_type      public.leave_type not null,
  date_from       date not null,
  date_to         date not null,
  reason          text not null check (length(btrim(reason)) between 3 and 500),
  attachment_path text,
  status          public.leave_status not null default 'pending',
  created_by      uuid not null references public.profiles (id),
  reviewed_by     uuid references public.profiles (id),
  reviewed_at     timestamptz,
  review_note     text check (review_note is null or length(review_note) <= 500),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (date_to >= date_from and date_to - date_from <= 30)
);
create index leave_requests_outlet_idx on public.leave_requests (outlet_id, date_from, date_to);
create index leave_requests_user_idx on public.leave_requests (user_id, status);
create index attendance_devices_approved_by_idx on public.attendance_devices (approved_by);
create index attendance_attempts_user_idx on public.attendance_attempts (user_id, created_at desc);
create index leave_requests_created_by_idx on public.leave_requests (created_by);
create index leave_requests_reviewed_by_idx on public.leave_requests (reviewed_by);

do $$
declare t text;
begin
  foreach t in array array['attendance_devices', 'attendance_records', 'leave_requests'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
  end loop;
end $$;
create trigger no_delete before delete on public.attendance_records for each row execute function private.forbid_change();
create trigger no_change before update or delete on public.attendance_attempts for each row execute function private.forbid_change();
create trigger no_delete before delete on public.leave_requests for each row execute function private.forbid_change();

-- ---------------------------------------------------------------------
-- RLS: baca diri sendiri atau pengelola absensi; tulis hanya lewat RPC
-- ---------------------------------------------------------------------
alter table public.attendance_devices enable row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_attempts enable row level security;
alter table public.leave_requests enable row level security;

create function private.can_manage_user_attendance(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_owner() or exists (
    select 1 from public.outlet_users ou
    where ou.user_id = p_user_id and public.has_permission(ou.outlet_id, 'attendance.manage'))
$$;

create policy attendance_devices_select on public.attendance_devices for select to authenticated
  using (user_id = auth.uid() or public.is_owner()
         or exists (select 1 from public.outlet_users ou where ou.user_id = attendance_devices.user_id
                    and public.has_permission(ou.outlet_id, 'attendance.manage')));
create policy attendance_records_select on public.attendance_records for select to authenticated
  using (user_id = auth.uid() or public.has_permission(outlet_id, 'attendance.manage'));
create policy attendance_attempts_select on public.attendance_attempts for select to authenticated
  using (user_id = auth.uid() or public.has_permission(outlet_id, 'attendance.manage'));
create policy leave_requests_select on public.leave_requests for select to authenticated
  using (user_id = auth.uid() or public.has_permission(outlet_id, 'attendance.manage'));

grant select on public.attendance_devices, public.attendance_records, public.attendance_attempts, public.leave_requests to authenticated;

create trigger audit_row after insert or update on public.leave_requests
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------
-- Bucket foto absensi & lampiran izin (PRIVAT). Path: <outlet>/<user>/<file>
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('attendance', 'attendance', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    execute $p$create policy attendance_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'attendance'
        and (storage.foldername(name))[2] = auth.uid()::text
        and public.has_outlet_access(public.safe_uuid((storage.foldername(name))[1])))$p$;
    execute $p$create policy attendance_select on storage.objects for select to authenticated
      using (bucket_id = 'attendance'
        and ((storage.foldername(name))[2] = auth.uid()::text
             or public.has_permission(public.safe_uuid((storage.foldername(name))[1]), 'attendance.manage')))$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Utilitas
-- ---------------------------------------------------------------------
-- Jarak haversine dalam meter
create function private.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable set search_path = '' as $$
  select 2 * 6371008.8 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

create function private.require_attendance_manager(p_outlet_id uuid) returns void
language plpgsql stable set search_path = '' as $$
begin
  if not public.has_permission(p_outlet_id, 'attendance.manage') then
    raise exception 'Akses ditolak: izin attendance.manage diperlukan' using errcode = '42501';
  end if;
end $$;

create function private.photo_ok(p_outlet_id uuid, p_user_id uuid, p_path text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_ok boolean := false;
begin
  if p_path is null or p_path !~ ('^' || p_outlet_id::text || '/' || p_user_id::text || '/[A-Za-z0-9._-]+$') then
    return false;
  end if;
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute 'select exists (select 1 from storage.objects where bucket_id = ''attendance'' and name = $1)'
      into v_ok using p_path;
  end if;
  return v_ok;
end $$;

create function private.attendance_reject(
  p_outlet_id uuid, p_kind text, p_reason text, p_message text,
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_distance double precision, p_device_id text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  insert into public.attendance_attempts (outlet_id, user_id, kind, reason, message, lat, lng, accuracy_m, distance_m, device_id)
  values (p_outlet_id, auth.uid(), p_kind, p_reason, p_message, p_lat, p_lng,
          round(p_accuracy::numeric, 1), round(p_distance::numeric, 1), left(p_device_id, 100));
  return jsonb_build_object('ok', false, 'reason', p_reason, 'message', p_message,
                            'distance_m', round(p_distance::numeric, 1), 'accuracy_m', round(p_accuracy::numeric, 1));
end $$;

-- ---------------------------------------------------------------------
-- ABSEN MASUK / PULANG
-- Penolakan bisnis dikembalikan sebagai {ok:false, reason, message} (bukan
-- exception) agar percobaan tetap tercatat di attendance_attempts.
-- ---------------------------------------------------------------------
create function public.attendance_check(
  p_outlet_id    uuid,
  p_token        text,
  p_kind         text,
  p_lat          double precision,
  p_lng          double precision,
  p_accuracy     double precision,
  p_device_id    text,
  p_device_label text,
  p_photo_path   text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_o public.outlets;
  v_dist double precision;
  v_dev public.attendance_devices;
  v_today date := private.business_date();
  v_rec public.attendance_records;
  v_local time := (now() at time zone 'Asia/Makassar')::time;
  v_late integer := 0;
begin
  if p_kind not in ('in', 'out') then
    raise exception 'Jenis absen tidak valid' using errcode = '22023';
  end if;
  if not public.has_outlet_access(p_outlet_id) then
    raise exception 'Akses ditolak' using errcode = '42501';
  end if;
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9-]{16,100}$' then
    raise exception 'ID perangkat tidak valid' using errcode = '22023';
  end if;
  -- satu absen per pengguna dalam satu waktu
  perform pg_advisory_xact_lock(hashtextextended('attendance:' || v_uid::text, 0));

  select * into v_o from public.outlets where id = p_outlet_id;

  if v_o.latitude is null then
    return private.attendance_reject(p_outlet_id, p_kind, 'LOCATION_NOT_SET',
      'Lokasi toko belum diatur pemilik.', p_lat, p_lng, p_accuracy, null, p_device_id);
  end if;
  if p_token is null or p_token <> v_o.attendance_token then
    return private.attendance_reject(p_outlet_id, p_kind, 'INVALID_QR',
      'QR tidak valid atau sudah diganti. Scan QR yang terpasang di toko.', p_lat, p_lng, p_accuracy, null, p_device_id);
  end if;
  if p_lat is null or p_lng is null or p_accuracy is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_accuracy <= 0 then
    return private.attendance_reject(p_outlet_id, p_kind, 'NO_GPS',
      'Lokasi GPS tidak terbaca. Aktifkan GPS/Lokasi lalu coba lagi.', p_lat, p_lng, p_accuracy, null, p_device_id);
  end if;

  v_dist := private.distance_m(v_o.latitude, v_o.longitude, p_lat, p_lng);

  if p_accuracy > v_o.attendance_max_accuracy_m then
    return private.attendance_reject(p_outlet_id, p_kind, 'LOW_ACCURACY',
      format('Sinyal GPS kurang akurat (±%s m, maks. %s m). Dekati pintu/jendela lalu coba lagi.',
             round(p_accuracy::numeric), v_o.attendance_max_accuracy_m),
      p_lat, p_lng, p_accuracy, v_dist, p_device_id);
  end if;
  if v_dist > v_o.attendance_radius_m then
    return private.attendance_reject(p_outlet_id, p_kind, 'TOO_FAR',
      format('Anda berada %s m dari toko (maks. %s m). Absen hanya bisa di toko.',
             round(v_dist::numeric), v_o.attendance_radius_m),
      p_lat, p_lng, p_accuracy, v_dist, p_device_id);
  end if;

  -- Perangkat: HP pertama otomatis disetujui; HP lain menunggu persetujuan
  select * into v_dev from public.attendance_devices where user_id = v_uid and device_id = p_device_id;
  if not found then
    insert into public.attendance_devices (user_id, device_id, label, status, approved_at)
    values (v_uid, p_device_id, left(p_device_label, 160),
            case when exists (select 1 from public.attendance_devices where user_id = v_uid and status = 'approved')
                 then 'pending' else 'approved' end,
            case when exists (select 1 from public.attendance_devices where user_id = v_uid and status = 'approved')
                 then null else now() end)
    returning * into v_dev;
  end if;
  if v_dev.status = 'pending' then
    return private.attendance_reject(p_outlet_id, p_kind, 'DEVICE_PENDING',
      'HP ini belum disetujui. Minta pemilik menyetujui HP baru Anda di menu Absensi.', p_lat, p_lng, p_accuracy, v_dist, p_device_id);
  elsif v_dev.status = 'revoked' then
    return private.attendance_reject(p_outlet_id, p_kind, 'DEVICE_REVOKED',
      'HP ini tidak lagi diizinkan untuk absen. Hubungi pemilik.', p_lat, p_lng, p_accuracy, v_dist, p_device_id);
  end if;

  if not private.photo_ok(p_outlet_id, v_uid, p_photo_path) then
    return private.attendance_reject(p_outlet_id, p_kind, 'NO_PHOTO',
      'Foto selfie tidak ditemukan. Ulangi absen.', p_lat, p_lng, p_accuracy, v_dist, p_device_id);
  end if;

  select * into v_rec from public.attendance_records where user_id = v_uid and business_date = v_today for update;

  if p_kind = 'in' then
    if found then
      return private.attendance_reject(p_outlet_id, p_kind, 'ALREADY_IN',
        format('Anda sudah absen masuk hari ini pukul %s.', to_char(v_rec.check_in_at at time zone 'Asia/Makassar', 'HH24:MI')),
        p_lat, p_lng, p_accuracy, v_dist, p_device_id);
    end if;
    if v_local > v_o.work_start_time + make_interval(mins => v_o.late_tolerance_minutes) then
      v_late := floor(extract(epoch from (v_local - v_o.work_start_time)) / 60)::int;
    end if;
    insert into public.attendance_records (outlet_id, user_id, business_date, check_in_at, check_in_lat, check_in_lng,
      check_in_accuracy_m, check_in_distance_m, check_in_photo_path, check_in_device_id, late_minutes)
    values (p_outlet_id, v_uid, v_today, now(), p_lat, p_lng, round(p_accuracy::numeric, 1), round(v_dist::numeric, 1),
            p_photo_path, p_device_id, v_late)
    returning * into v_rec;
  else
    if not found then
      return private.attendance_reject(p_outlet_id, p_kind, 'NOT_IN',
        'Anda belum absen masuk hari ini.', p_lat, p_lng, p_accuracy, v_dist, p_device_id);
    end if;
    if v_rec.check_out_at is not null then
      return private.attendance_reject(p_outlet_id, p_kind, 'ALREADY_OUT',
        format('Anda sudah absen pulang pukul %s.', to_char(v_rec.check_out_at at time zone 'Asia/Makassar', 'HH24:MI')),
        p_lat, p_lng, p_accuracy, v_dist, p_device_id);
    end if;
    if v_rec.outlet_id <> p_outlet_id then
      return private.attendance_reject(p_outlet_id, p_kind, 'OTHER_OUTLET',
        'Absen pulang harus di outlet tempat Anda absen masuk.', p_lat, p_lng, p_accuracy, v_dist, p_device_id);
    end if;
    update public.attendance_records set
      check_out_at = now(), check_out_lat = p_lat, check_out_lng = p_lng,
      check_out_accuracy_m = round(p_accuracy::numeric, 1), check_out_distance_m = round(v_dist::numeric, 1),
      check_out_photo_path = p_photo_path, check_out_device_id = p_device_id
    where id = v_rec.id returning * into v_rec;
  end if;

  update public.attendance_devices set last_used_at = now() where id = v_dev.id;

  return jsonb_build_object('ok', true, 'kind', p_kind,
    'at', case when p_kind = 'in' then v_rec.check_in_at else v_rec.check_out_at end,
    'distance_m', round(v_dist::numeric, 1), 'late_minutes', v_rec.late_minutes,
    'check_in_at', v_rec.check_in_at, 'check_out_at', v_rec.check_out_at);
end $$;

-- Status absensi saya hari ini + status perangkat + aturan outlet (tanpa token)
create function public.get_my_attendance(p_outlet_id uuid, p_device_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_o public.outlets;
  v_rec public.attendance_records;
begin
  if not public.has_outlet_access(p_outlet_id) then
    raise exception 'Akses ditolak' using errcode = '42501';
  end if;
  select * into v_o from public.outlets where id = p_outlet_id;
  select * into v_rec from public.attendance_records where user_id = v_uid and business_date = private.business_date();
  return jsonb_build_object(
    'business_date', private.business_date(),
    'location_set', v_o.latitude is not null,
    'radius_m', v_o.attendance_radius_m,
    'max_accuracy_m', v_o.attendance_max_accuracy_m,
    'work_start_time', to_char(v_o.work_start_time, 'HH24:MI'),
    'late_tolerance_minutes', v_o.late_tolerance_minutes,
    'record', case when v_rec.id is null then null else jsonb_build_object(
      'outlet_id', v_rec.outlet_id, 'check_in_at', v_rec.check_in_at, 'check_out_at', v_rec.check_out_at,
      'late_minutes', v_rec.late_minutes, 'check_in_distance_m', v_rec.check_in_distance_m) end,
    'device_status', (select status from public.attendance_devices where user_id = v_uid and device_id = p_device_id),
    'has_approved_device', exists (select 1 from public.attendance_devices where user_id = v_uid and status = 'approved')
  );
end $$;

-- ---------------------------------------------------------------------
-- PENGATURAN (pengelola absensi)
-- ---------------------------------------------------------------------
create function public.get_attendance_settings(p_outlet_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_o public.outlets;
begin
  perform private.require_auth();
  perform private.require_attendance_manager(p_outlet_id);
  select * into v_o from public.outlets where id = p_outlet_id;
  return jsonb_build_object(
    'outlet_id', v_o.id, 'outlet_code', v_o.code, 'outlet_name', v_o.name,
    'latitude', v_o.latitude, 'longitude', v_o.longitude,
    'radius_m', v_o.attendance_radius_m, 'max_accuracy_m', v_o.attendance_max_accuracy_m,
    'token', v_o.attendance_token,
    'work_start_time', to_char(v_o.work_start_time, 'HH24:MI'),
    'late_tolerance_minutes', v_o.late_tolerance_minutes,
    'work_days', to_jsonb(v_o.work_days),
    'attendance_since', v_o.attendance_since);
end $$;

create function public.set_attendance_location(p_outlet_id uuid, p_lat double precision, p_lng double precision, p_accuracy double precision)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_auth();
  perform private.require_attendance_manager(p_outlet_id);
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Koordinat tidak valid' using errcode = '22023';
  end if;
  if p_accuracy is null or p_accuracy > 30 then
    raise exception 'GPS kurang akurat (±% m). Ambil titik lokasi di dalam toko saat akurasi ≤ 30 m.', round(coalesce(p_accuracy, 0)::numeric)
      using errcode = '22023';
  end if;
  update public.outlets set latitude = p_lat, longitude = p_lng,
    attendance_since = coalesce(attendance_since, private.business_date())
  where id = p_outlet_id;
  perform private.log_audit(p_outlet_id, 'set_location', 'attendance', p_outlet_id,
    jsonb_build_object('lat', p_lat, 'lng', p_lng, 'accuracy_m', p_accuracy));
end $$;

create function public.update_attendance_settings(p_outlet_id uuid, p_work_start time, p_late_tolerance integer, p_work_days smallint[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_auth();
  perform private.require_attendance_manager(p_outlet_id);
  update public.outlets set work_start_time = p_work_start, late_tolerance_minutes = p_late_tolerance, work_days = p_work_days
  where id = p_outlet_id;
  perform private.log_audit(p_outlet_id, 'update_settings', 'attendance', p_outlet_id,
    jsonb_build_object('work_start', p_work_start, 'late_tolerance', p_late_tolerance, 'work_days', p_work_days));
end $$;

create function public.regenerate_attendance_qr(p_outlet_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  perform private.require_auth();
  perform private.require_attendance_manager(p_outlet_id);
  update public.outlets set attendance_token = v_token where id = p_outlet_id;
  perform private.log_audit(p_outlet_id, 'regenerate_qr', 'attendance', p_outlet_id, '{}');
  return v_token;
end $$;

-- ---------------------------------------------------------------------
-- PERANGKAT
-- ---------------------------------------------------------------------
create function public.list_attendance_devices(p_outlet_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_auth();
  perform private.require_attendance_manager(p_outlet_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'user_id', d.user_id, 'full_name', p.full_name, 'username', p.username,
      'label', d.label, 'status', d.status, 'created_at', d.created_at, 'last_used_at', d.last_used_at)
      order by (d.status = 'pending') desc, p.full_name, d.created_at desc)
    from public.attendance_devices d join public.profiles p on p.id = d.user_id
    where exists (select 1 from public.outlet_users ou where ou.user_id = d.user_id and ou.outlet_id = p_outlet_id)), '[]');
end $$;

create function public.set_attendance_device_status(p_device_row_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_dev public.attendance_devices;
begin
  perform private.require_auth();
  select * into v_dev from public.attendance_devices where id = p_device_row_id for update;
  if not found then
    raise exception 'Perangkat tidak ditemukan' using errcode = 'P0002';
  end if;
  if not private.can_manage_user_attendance(v_dev.user_id) or v_dev.user_id = auth.uid() and not public.is_owner() then
    raise exception 'Akses ditolak: izin attendance.manage diperlukan' using errcode = '42501';
  end if;
  if p_status not in ('approved', 'revoked') then
    raise exception 'Status tidak valid' using errcode = '22023';
  end if;
  if p_status = 'approved' then
    -- satu HP disetujui per karyawan: HP lama dicabut
    update public.attendance_devices set status = 'revoked'
    where user_id = v_dev.user_id and status = 'approved' and id <> v_dev.id;
  end if;
  update public.attendance_devices
  set status = p_status, approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
      approved_at = case when p_status = 'approved' then now() else approved_at end
  where id = v_dev.id;
  perform private.log_audit(null, 'device_' || p_status, 'attendance_devices', v_dev.id,
    jsonb_build_object('user_id', v_dev.user_id, 'label', v_dev.label));
end $$;

-- ---------------------------------------------------------------------
-- IZIN (sakit / izin / cuti; libur ditetapkan pengelola)
-- ---------------------------------------------------------------------
create function public.create_leave_request(
  p_outlet_id uuid, p_type public.leave_type, p_from date, p_to date, p_reason text,
  p_attachment_path text default null, p_user_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_target uuid := coalesce(p_user_id, v_uid);
  v_manager boolean := public.has_permission(p_outlet_id, 'attendance.manage');
  v_id uuid;
begin
  if not public.has_outlet_access(p_outlet_id) then
    raise exception 'Akses ditolak' using errcode = '42501';
  end if;
  if v_target <> v_uid then
    if not v_manager then
      raise exception 'Akses ditolak: izin attendance.manage diperlukan' using errcode = '42501';
    end if;
    if not exists (select 1 from public.outlet_users where user_id = v_target and outlet_id = p_outlet_id) then
      raise exception 'Karyawan tidak ditugaskan di outlet ini' using errcode = '22023';
    end if;
  elsif p_type = 'libur' then
    raise exception 'Libur ditetapkan oleh pemilik/pengelola' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 30 then
    raise exception 'Rentang tanggal tidak valid (maks. 31 hari)' using errcode = '22023';
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 3 then
    raise exception 'Alasan wajib diisi' using errcode = '22023';
  end if;
  if p_attachment_path is not null and not private.photo_ok(p_outlet_id, v_uid, p_attachment_path) then
    raise exception 'Lampiran tidak ditemukan' using errcode = '22023';
  end if;
  if exists (select 1 from public.leave_requests
             where user_id = v_target and status in ('pending', 'approved')
               and daterange(date_from, date_to, '[]') && daterange(p_from, p_to, '[]')) then
    raise exception 'Sudah ada pengajuan izin pada tanggal tersebut' using errcode = '23505';
  end if;
  insert into public.leave_requests (outlet_id, user_id, leave_type, date_from, date_to, reason, attachment_path,
                                     status, created_by, reviewed_by, reviewed_at)
  values (p_outlet_id, v_target, p_type, p_from, p_to, btrim(p_reason), p_attachment_path,
          case when v_target <> v_uid then 'approved'::public.leave_status else 'pending'::public.leave_status end,
          v_uid,
          case when v_target <> v_uid then v_uid end,
          case when v_target <> v_uid then now() end)
  returning id into v_id;
  return v_id;
end $$;

create function public.cancel_leave_request(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_l public.leave_requests;
begin
  perform private.require_auth();
  select * into v_l from public.leave_requests where id = p_id for update;
  if not found or v_l.user_id <> auth.uid() then
    raise exception 'Pengajuan tidak ditemukan' using errcode = 'P0002';
  end if;
  if v_l.status <> 'pending' then
    raise exception 'Hanya pengajuan yang masih menunggu yang dapat dibatalkan' using errcode = '22023';
  end if;
  update public.leave_requests set status = 'cancelled' where id = p_id;
end $$;

create function public.review_leave_request(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_l public.leave_requests;
begin
  perform private.require_auth();
  select * into v_l from public.leave_requests where id = p_id for update;
  if not found then
    raise exception 'Pengajuan tidak ditemukan' using errcode = 'P0002';
  end if;
  perform private.require_attendance_manager(v_l.outlet_id);
  if v_l.user_id = auth.uid() and not public.is_owner() then
    raise exception 'Tidak dapat menyetujui pengajuan sendiri' using errcode = '42501';
  end if;
  if v_l.status <> 'pending' then
    raise exception 'Pengajuan sudah diproses' using errcode = '22023';
  end if;
  update public.leave_requests
  set status = case when p_approve then 'approved'::public.leave_status else 'rejected'::public.leave_status end,
      reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(p_note), '')
  where id = p_id;
end $$;

create function public.list_leave_requests(p_outlet_id uuid, p_from date, p_to date, p_status public.leave_status default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_manager boolean;
begin
  if not public.has_outlet_access(p_outlet_id) then
    raise exception 'Akses ditolak' using errcode = '42501';
  end if;
  v_manager := public.has_permission(p_outlet_id, 'attendance.manage');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'user_id', l.user_id, 'full_name', p.full_name, 'leave_type', l.leave_type,
      'date_from', l.date_from, 'date_to', l.date_to, 'reason', l.reason, 'attachment_path', l.attachment_path,
      'status', l.status, 'review_note', l.review_note, 'reviewed_by_name', r.full_name, 'reviewed_at', l.reviewed_at,
      'created_at', l.created_at, 'is_self', l.user_id = v_uid)
      order by (l.status = 'pending') desc, l.date_from desc, l.created_at desc)
    from public.leave_requests l
    join public.profiles p on p.id = l.user_id
    left join public.profiles r on r.id = l.reviewed_by
    where l.outlet_id = p_outlet_id
      and (v_manager or l.user_id = v_uid)
      and l.date_to >= p_from and l.date_from <= p_to
      and (p_status is null or l.status = p_status)), '[]');
end $$;

-- ---------------------------------------------------------------------
-- REKAP
-- status per hari: hadir | terlambat | sakit | izin | cuti | libur | tutup
--                  | mangkir | belum_absen (hari ini) | akan_datang
--                  | belum_berlaku (sebelum absensi aktif / sebelum ditugaskan)
-- ---------------------------------------------------------------------
create function public.get_attendance_recap(p_outlet_id uuid, p_from date, p_to date, p_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_auth();
  v_o public.outlets;
  v_today date := private.business_date();
begin
  if not public.has_outlet_access(p_outlet_id) then
    raise exception 'Akses ditolak' using errcode = '42501';
  end if;
  if p_user_id is distinct from v_uid then
    perform private.require_attendance_manager(p_outlet_id);
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 62 then
    raise exception 'Rentang tanggal tidak valid (maks. 63 hari)' using errcode = '22023';
  end if;
  select * into v_o from public.outlets where id = p_outlet_id;

  return (
    with users as (
      select p.id, p.full_name, p.username,
        greatest(v_o.attendance_since,
                 (select min(private.business_date(ou.created_at)) from public.outlet_users ou
                  where ou.user_id = p.id and ou.outlet_id = p_outlet_id)) as since
      from public.profiles p
      where (p_user_id is null or p.id = p_user_id)
        and (exists (select 1 from public.outlet_users ou where ou.user_id = p.id and ou.outlet_id = p_outlet_id and ou.is_active)
             or exists (select 1 from public.attendance_records r where r.user_id = p.id and r.outlet_id = p_outlet_id
                        and r.business_date between p_from and p_to))
    ),
    days as (select d::date as day from generate_series(p_from, p_to, interval '1 day') d),
    cells as (
      select u.id as user_id, d.day, l.leave_type,
        r.check_in_at, r.check_out_at, r.late_minutes, r.check_in_distance_m, r.check_out_distance_m,
        r.check_in_photo_path, r.check_out_photo_path,
        case
          when r.id is not null then case when r.late_minutes > 0 then 'terlambat' else 'hadir' end
          when l.leave_type is not null then l.leave_type::text
          when d.day > v_today then 'akan_datang'
          when v_o.attendance_since is null or d.day < u.since then 'belum_berlaku'
          when not (extract(isodow from d.day)::smallint = any (v_o.work_days)) then 'tutup'
          when d.day = v_today then 'belum_absen'
          else 'mangkir'
        end as status,
        case when r.check_out_at is not null
             then floor(extract(epoch from (r.check_out_at - r.check_in_at)) / 60)::int end as worked_minutes
      from users u cross join days d
      left join public.attendance_records r on r.user_id = u.id and r.business_date = d.day and r.outlet_id = p_outlet_id
      left join lateral (
        select lr.leave_type from public.leave_requests lr
        where lr.user_id = u.id and lr.outlet_id = p_outlet_id and lr.status = 'approved'
          and d.day between lr.date_from and lr.date_to
        order by lr.created_at desc limit 1) l on true
    )
    select jsonb_build_object(
      'from', p_from, 'to', p_to,
      'work_start_time', to_char(v_o.work_start_time, 'HH24:MI'),
      'employees', coalesce((
        select jsonb_agg(jsonb_build_object(
          'user_id', u.id, 'full_name', u.full_name, 'username', u.username,
          'summary', (select jsonb_build_object(
              'hadir', count(*) filter (where c.status in ('hadir', 'terlambat')),
              'terlambat', count(*) filter (where c.status = 'terlambat'),
              'sakit', count(*) filter (where c.status = 'sakit'),
              'izin', count(*) filter (where c.status = 'izin'),
              'cuti', count(*) filter (where c.status = 'cuti'),
              'libur', count(*) filter (where c.status = 'libur'),
              'mangkir', count(*) filter (where c.status = 'mangkir'),
              'late_minutes', coalesce(sum(c.late_minutes), 0),
              'worked_minutes', coalesce(sum(c.worked_minutes), 0))
            from cells c where c.user_id = u.id),
          'days', (select jsonb_agg(jsonb_build_object(
              'date', c.day, 'status', c.status, 'check_in_at', c.check_in_at, 'check_out_at', c.check_out_at,
              'late_minutes', c.late_minutes, 'worked_minutes', c.worked_minutes,
              'check_in_distance_m', c.check_in_distance_m, 'check_out_distance_m', c.check_out_distance_m,
              'check_in_photo_path', c.check_in_photo_path, 'check_out_photo_path', c.check_out_photo_path)
              order by c.day)
            from cells c where c.user_id = u.id))
          order by u.full_name)
        from users u), '[]'))
  );
end $$;

create function public.list_attendance_attempts(p_outlet_id uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_auth();
  perform private.require_attendance_manager(p_outlet_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'created_at', a.created_at, 'full_name', p.full_name, 'kind', a.kind, 'reason', a.reason,
      'message', a.message, 'distance_m', a.distance_m, 'accuracy_m', a.accuracy_m) order by a.created_at desc)
    from (select * from public.attendance_attempts
          where outlet_id = p_outlet_id and private.business_date(created_at) between p_from and p_to
          order by created_at desc limit 300) a
    join public.profiles p on p.id = a.user_id), '[]');
end $$;

-- ---------------------------------------------------------------------
-- Hak eksekusi
-- ---------------------------------------------------------------------
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function
  public.attendance_check(uuid, text, text, double precision, double precision, double precision, text, text, text),
  public.get_my_attendance(uuid, text), public.get_attendance_settings(uuid),
  public.set_attendance_location(uuid, double precision, double precision, double precision),
  public.update_attendance_settings(uuid, time, integer, smallint[]), public.regenerate_attendance_qr(uuid),
  public.list_attendance_devices(uuid), public.set_attendance_device_status(uuid, text),
  public.create_leave_request(uuid, public.leave_type, date, date, text, text, uuid), public.cancel_leave_request(uuid),
  public.review_leave_request(uuid, boolean, text), public.list_leave_requests(uuid, date, date, public.leave_status),
  public.get_attendance_recap(uuid, date, date, uuid), public.list_attendance_attempts(uuid, date, date)
from public, anon;
grant execute on function
  public.attendance_check(uuid, text, text, double precision, double precision, double precision, text, text, text),
  public.get_my_attendance(uuid, text), public.get_attendance_settings(uuid),
  public.set_attendance_location(uuid, double precision, double precision, double precision),
  public.update_attendance_settings(uuid, time, integer, smallint[]), public.regenerate_attendance_qr(uuid),
  public.list_attendance_devices(uuid), public.set_attendance_device_status(uuid, text),
  public.create_leave_request(uuid, public.leave_type, date, date, text, text, uuid), public.cancel_leave_request(uuid),
  public.review_leave_request(uuid, boolean, text), public.list_leave_requests(uuid, date, date, public.leave_status),
  public.get_attendance_recap(uuid, date, date, uuid), public.list_attendance_attempts(uuid, date, date)
to authenticated;

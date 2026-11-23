import type { SupabaseClient } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/auth-context'
import type { Period } from '@/lib/periods'
import type { LeaveType } from './lib'

export const ATTENDANCE_BUCKET = 'attendance'

export interface MyAttendance {
  business_date: string
  location_set: boolean
  radius_m: number
  max_accuracy_m: number
  work_start_time: string
  late_tolerance_minutes: number
  record: null | { outlet_id: string; check_in_at: string; check_out_at: string | null; late_minutes: number; check_in_distance_m: number }
  device_status: 'pending' | 'approved' | 'revoked' | null
  has_approved_device: boolean
}

export interface CheckResult {
  ok: boolean
  reason?: string
  message?: string
  kind?: 'in' | 'out'
  at?: string
  distance_m?: number | null
  accuracy_m?: number | null
  late_minutes?: number
}

export interface AttendanceSettings {
  outlet_id: string
  outlet_code: string
  outlet_name: string
  latitude: number | null
  longitude: number | null
  radius_m: number
  max_accuracy_m: number
  token: string
  work_start_time: string
  late_tolerance_minutes: number
  work_days: number[]
}

export interface AttendanceDevice {
  id: string
  user_id: string
  full_name: string
  username: string | null
  label: string | null
  status: 'pending' | 'approved' | 'revoked'
  created_at: string
  last_used_at: string | null
}

export interface LeaveRequest {
  id: string
  user_id: string
  full_name: string
  leave_type: LeaveType
  date_from: string
  date_to: string
  reason: string
  attachment_path: string | null
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  review_note: string | null
  reviewed_by_name: string | null
  reviewed_at: string | null
  created_at: string
  is_self: boolean
}

export interface RecapDay {
  date: string
  status: string
  check_in_at: string | null
  check_out_at: string | null
  late_minutes: number | null
  worked_minutes: number | null
  check_in_distance_m: number | null
  check_out_distance_m: number | null
  check_in_photo_path: string | null
  check_out_photo_path: string | null
}

export interface RecapSummary {
  hadir: number
  terlambat: number
  sakit: number
  izin: number
  cuti: number
  libur: number
  mangkir: number
  late_minutes: number
  worked_minutes: number
}

export interface Recap {
  from: string
  to: string
  work_start_time: string
  employees: { user_id: string; full_name: string; username: string | null; summary: RecapSummary; days: RecapDay[] }[]
}

export interface AttendanceAttempt {
  id: string
  created_at: string
  full_name: string
  kind: 'in' | 'out'
  reason: string
  message: string
  distance_m: number | null
  accuracy_m: number | null
}

function useCtx() {
  const { client, activeOutlet, session } = useAuth()
  if (!client || !activeOutlet || !session) throw new Error('Sesi belum siap')
  return { client, outletId: activeOutlet.outlet_id, userId: session.user.id }
}

async function rpc<T>(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(fn, args)
  if (error) throw error
  return data as T
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: ['attendance'] })
}

export function useMyAttendance(outletId: string | null, deviceId: string) {
  const { client } = useAuth()
  return useQuery({
    queryKey: ['attendance', 'me', outletId, deviceId],
    queryFn: () => rpc<MyAttendance>(client!, 'get_my_attendance', { p_outlet_id: outletId, p_device_id: deviceId }),
    enabled: !!client && !!outletId,
  })
}

/** Unggah foto (selfie / surat) ke bucket privat: <outlet>/<user>/<uuid>.jpg */
export async function uploadAttendancePhoto(client: SupabaseClient, outletId: string, userId: string, blob: Blob): Promise<string> {
  const path = `${outletId}/${userId}/${crypto.randomUUID()}.jpg`
  const { error } = await client.storage.from(ATTENDANCE_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw error
  return path
}

export interface CheckInput {
  outletId: string
  token: string
  kind: 'in' | 'out'
  lat: number
  lng: number
  accuracy: number
  deviceId: string
  deviceLabel: string
  photo: Blob
}

export function useAttendanceCheck() {
  const { client, session } = useAuth()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (i: CheckInput) => {
      const path = await uploadAttendancePhoto(client!, i.outletId, session!.user.id, i.photo)
      return rpc<CheckResult>(client!, 'attendance_check', {
        p_outlet_id: i.outletId,
        p_token: i.token,
        p_kind: i.kind,
        p_lat: i.lat,
        p_lng: i.lng,
        p_accuracy: i.accuracy,
        p_device_id: i.deviceId,
        p_device_label: i.deviceLabel,
        p_photo_path: path,
      })
    },
    onSettled: invalidate,
  })
}

export function useSignedPhoto(path: string | null | undefined) {
  const { client } = useAuth()
  return useQuery({
    queryKey: ['attendance', 'photo', path],
    queryFn: async () => {
      const { data, error } = await client!.storage.from(ATTENDANCE_BUCKET).createSignedUrl(path!, 300)
      if (error) throw error
      return data.signedUrl
    },
    enabled: !!client && !!path,
    staleTime: 240_000,
  })
}

// ---------------- pengaturan ----------------
export function useAttendanceSettings(enabled = true) {
  const { client, outletId } = useCtx()
  return useQuery({
    queryKey: ['attendance', 'settings', outletId],
    queryFn: () => rpc<AttendanceSettings>(client, 'get_attendance_settings', { p_outlet_id: outletId }),
    enabled,
  })
}

export function useSetLocation() {
  const { client, outletId } = useCtx()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (f: { lat: number; lng: number; accuracy: number }) =>
      rpc<void>(client, 'set_attendance_location', { p_outlet_id: outletId, p_lat: f.lat, p_lng: f.lng, p_accuracy: f.accuracy }),
    onSuccess: invalidate,
  })
}

export function useUpdateSchedule() {
  const { client, outletId } = useCtx()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (v: { work_start: string; late_tolerance: number; work_days: number[] }) =>
      rpc<void>(client, 'update_attendance_settings', {
        p_outlet_id: outletId,
        p_work_start: v.work_start,
        p_late_tolerance: v.late_tolerance,
        p_work_days: v.work_days,
      }),
    onSuccess: invalidate,
  })
}

export function useRegenerateQr() {
  const { client, outletId } = useCtx()
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: () => rpc<string>(client, 'regenerate_attendance_qr', { p_outlet_id: outletId }), onSuccess: invalidate })
}

// ---------------- perangkat ----------------
export function useDevices(enabled = true) {
  const { client, outletId } = useCtx()
  return useQuery({
    queryKey: ['attendance', 'devices', outletId],
    queryFn: () => rpc<AttendanceDevice[]>(client, 'list_attendance_devices', { p_outlet_id: outletId }),
    enabled,
  })
}

export function useSetDeviceStatus() {
  const { client } = useCtx()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (v: { id: string; status: 'approved' | 'revoked' }) => rpc<void>(client, 'set_attendance_device_status', { p_device_row_id: v.id, p_status: v.status }),
    onSuccess: invalidate,
  })
}

// ---------------- izin ----------------
export function useLeaveRequests(period: Period) {
  const { client, outletId } = useCtx()
  return useQuery({
    queryKey: ['attendance', 'leave', outletId, period],
    queryFn: () => rpc<LeaveRequest[]>(client, 'list_leave_requests', { p_outlet_id: outletId, p_from: period.from, p_to: period.to, p_status: null }),
  })
}

export interface LeaveInput {
  type: LeaveType
  from: string
  to: string
  reason: string
  attachment: Blob | null
  userId?: string | null
}

export function useCreateLeave() {
  const { client, outletId, userId } = useCtx()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (v: LeaveInput) => {
      const path = v.attachment ? await uploadAttendancePhoto(client, outletId, userId, v.attachment) : null
      return rpc<string>(client, 'create_leave_request', {
        p_outlet_id: outletId,
        p_type: v.type,
        p_from: v.from,
        p_to: v.to,
        p_reason: v.reason,
        p_attachment_path: path,
        p_user_id: v.userId ?? null,
      })
    },
    onSuccess: invalidate,
  })
}

export function useReviewLeave() {
  const { client } = useCtx()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (v: { id: string; approve: boolean; note?: string }) => rpc<void>(client, 'review_leave_request', { p_id: v.id, p_approve: v.approve, p_note: v.note ?? null }),
    onSuccess: invalidate,
  })
}

export function useCancelLeave() {
  const { client } = useCtx()
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => rpc<void>(client, 'cancel_leave_request', { p_id: id }), onSuccess: invalidate })
}

// ---------------- rekap ----------------
export function useRecap(period: Period, userId: string | null, enabled = true) {
  const { client, outletId } = useCtx()
  return useQuery({
    queryKey: ['attendance', 'recap', outletId, period, userId],
    queryFn: () => rpc<Recap>(client, 'get_attendance_recap', { p_outlet_id: outletId, p_from: period.from, p_to: period.to, p_user_id: userId }),
    enabled,
  })
}

export function useAttempts(period: Period, enabled = true) {
  const { client, outletId } = useCtx()
  return useQuery({
    queryKey: ['attendance', 'attempts', outletId, period],
    queryFn: () => rpc<AttendanceAttempt[]>(client, 'list_attendance_attempts', { p_outlet_id: outletId, p_from: period.from, p_to: period.to }),
    enabled,
  })
}

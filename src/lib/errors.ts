/** Ubah error Supabase/PostgREST/jaringan menjadi pesan Indonesia yang ramah. */
export function toUserMessage(err: unknown): string {
  const e = err as { message?: string; code?: string; details?: string } | null
  const msg = e?.message ?? String(err)
  const m = msg.toLowerCase()
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed'))
    return 'Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.'
  if (e?.code === '42501' || m.includes('permission denied') || m.includes('row-level security'))
    return msg.startsWith('Akses ditolak') ? msg : 'Akses ditolak untuk tindakan ini.'
  if (e?.code === '23505' || m.includes('duplicate key')) return msg.includes('sudah') ? msg : 'Data dengan nama/kode yang sama sudah ada.'
  if (e?.code === 'PGRST301' || m.includes('jwt expired')) return 'Sesi login berakhir. Silakan masuk kembali.'
  return msg
}

import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Loader2, ServerCog, ShieldX, Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { useAuth } from './auth-context'
import type { Permission } from './permissions'

export function FullScreenLoader({ label = 'Memuat…' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 text-muted-foreground" role="status">
      <Loader2 className="h-8 w-8 animate-spin text-foreground" />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function SetupRequired() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="max-w-lg">
        <EmptyState
          icon={ServerCog}
          title="Konfigurasi Supabase belum diisi"
          description="Salin .env.example menjadi .env.local, isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY, lalu jalankan ulang aplikasi. Lihat docs/SUPABASE_SETUP.md."
        />
      </Card>
    </div>
  )
}

/** Wajib login. Data tetap dilindungi RLS meskipun guard ini dilewati. */
export function RequireAuth() {
  const { status, outlets, profile, signOut, loadError, reload } = useAuth()
  const location = useLocation()
  if (status === 'unconfigured') return <SetupRequired />
  if (status === 'loading') return <FullScreenLoader />
  if (status === 'signed_out') return <Navigate to="/masuk" replace state={{ from: location.pathname + location.search }} />
  if (outlets.length === 0) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <Card className="max-w-lg">
          <EmptyState
            icon={Store}
            title={loadError ? 'Gagal memuat akun' : 'Belum ada outlet untuk akun ini'}
            description={
              loadError ??
              `${profile?.full_name ?? 'Akun Anda'} belum ditugaskan ke outlet aktif mana pun. Hubungi pemilik toko.`
            }
            action={
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void reload()}>
                  Coba lagi
                </Button>
                <Button variant="dark" onClick={() => void signOut()}>
                  Keluar
                </Button>
              </div>
            }
          />
        </Card>
      </div>
    )
  }
  return <Outlet />
}

export function AccessDenied() {
  return (
    <Card>
      <EmptyState
        icon={ShieldX}
        title="Akses ditolak"
        description="Peran Anda di outlet ini tidak memiliki izin untuk membuka halaman ini."
      />
    </Card>
  )
}

export function RequirePermission({ anyOf, children }: { anyOf?: Permission[]; children: React.ReactNode }) {
  const { can } = useAuth()
  if (anyOf && anyOf.length > 0 && !can(...anyOf)) return <AccessDenied />
  return <>{children}</>
}

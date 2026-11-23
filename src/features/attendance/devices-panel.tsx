import { Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { toUserMessage } from '@/lib/errors'
import { formatDateWita } from '@/lib/format'
import { useDevices, useSetDeviceStatus, type AttendanceDevice } from './api'

const STATUS: Record<AttendanceDevice['status'], { label: string; variant: 'default' | 'success' | 'muted' }> = {
  pending: { label: 'Menunggu persetujuan', variant: 'default' },
  approved: { label: 'Aktif', variant: 'success' },
  revoked: { label: 'Dicabut', variant: 'muted' },
}

/** Satu HP disetujui per karyawan. HP pertama otomatis aktif. */
export function DevicesPanel() {
  const q = useDevices()
  const set = useSetDeviceStatus()
  const act = (d: AttendanceDevice, status: 'approved' | 'revoked') =>
    set.mutate(
      { id: d.id, status },
      {
        onSuccess: () => toast.success(status === 'approved' ? `HP ${d.full_name} disetujui (HP lama dicabut)` : 'HP dicabut'),
        onError: (e) => toast.error(toUserMessage(e)),
      },
    )

  if (q.isPending) return <Skeleton className="h-32" />
  if (q.isError) return <p className="text-destructive">{toUserMessage(q.error)}</p>
  if (q.data.length === 0)
    return (
      <Card>
        <EmptyState icon={Smartphone} title="Belum ada HP terdaftar" description="HP karyawan terdaftar otomatis saat pertama kali absen." />
      </Card>
    )
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Setiap karyawan hanya bisa absen dari satu HP. Menyetujui HP baru otomatis mencabut HP lama.</p>
      <Card className="divide-y overflow-hidden">
        {q.data.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-3 p-4" data-testid="device-row">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{d.full_name}</p>
              <p className="text-sm">{d.label ?? 'Perangkat'}</p>
              <p className="text-xs text-muted-foreground">
                Didaftarkan {formatDateWita(d.created_at, 'd MMM yyyy HH:mm')}
                {d.last_used_at && ` · terakhir absen ${formatDateWita(d.last_used_at, 'd MMM HH:mm')}`}
              </p>
            </div>
            <Badge variant={STATUS[d.status].variant}>{STATUS[d.status].label}</Badge>
            {d.status !== 'approved' && (
              <Button size="sm" onClick={() => act(d, 'approved')} disabled={set.isPending}>
                Setujui
              </Button>
            )}
            {d.status !== 'revoked' && (
              <Button size="sm" variant="outline" onClick={() => act(d, 'revoked')} disabled={set.isPending}>
                Cabut
              </Button>
            )}
          </div>
        ))}
      </Card>
    </div>
  )
}

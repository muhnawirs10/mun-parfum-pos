import { useState } from 'react'
import { Activity, KeyRound, ShieldCheck, UserCheck, UserPlus, Users, UserX } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/features/auth/auth-context'
import { ROLE_LABEL } from '@/features/auth/permissions'
import { toUserMessage } from '@/lib/errors'
import { businessDate, formatDateWita } from '@/lib/format'
import { addDays } from '@/lib/periods'
import { AUDIT_ACTION_LABEL, AUDIT_ENTITY_LABEL, useAuditLogs, useSetStaffActive, useStaff, type StaffMember } from './api'
import { AccessDialog, CreateStaffDialog, ResetPasswordDialog } from './staff-dialogs'

function auditSummary(details: Record<string, unknown>): string {
  const d = (details.new ?? details) as Record<string, unknown>
  const parts = ['number', 'name', 'sku', 'role', 'total', 'reason', 'quantity'].filter((k) => d?.[k] !== undefined && d[k] !== null).map((k) => `${k}: ${String(d[k])}`)
  return parts.slice(0, 3).join(' · ')
}

function AuditPanel() {
  const { activeOutlet, profile } = useAuth()
  const today = businessDate()
  const [from, setFrom] = useState(addDays(today, -6))
  const [to, setTo] = useState(today)
  const [entity, setEntity] = useState<string>('')
  const [scope, setScope] = useState<'outlet' | 'all'>('outlet')
  const q = useAuditLogs({ from, to, outletId: scope === 'all' && profile?.is_owner ? null : activeOutlet!.outlet_id, entity: entity || null }, true)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 items-end gap-3 lg:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="px-1 text-xs text-muted-foreground">Dari</span>
          <Input type="date" aria-label="Audit dari" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="px-1 text-xs text-muted-foreground">Sampai</span>
          <Input type="date" aria-label="Audit sampai" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        <NativeSelect aria-label="Jenis aktivitas" value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">Semua aktivitas</option>
          {Object.entries(AUDIT_ENTITY_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </NativeSelect>
        {profile?.is_owner && (
          <NativeSelect aria-label="Cakupan audit" value={scope} onChange={(e) => setScope(e.target.value as 'outlet' | 'all')}>
            <option value="outlet">Outlet aktif</option>
            <option value="all">Semua outlet</option>
          </NativeSelect>
        )}
      </div>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <Card>
          <EmptyState icon={Activity} title="Gagal memuat aktivitas" description={toUserMessage(q.error)} />
        </Card>
      ) : q.data.items.length === 0 ? (
        <Card>
          <EmptyState icon={Activity} title="Belum ada aktivitas pada periode ini" />
        </Card>
      ) : (
        <Card className="divide-y overflow-hidden">
          {q.data.items.map((a) => (
            <div key={a.id} className="p-3 text-sm" data-testid="audit-row">
              <p>
                <b>{a.user_name ?? 'Sistem'}</b> {AUDIT_ACTION_LABEL[a.action] ?? a.action} <b>{AUDIT_ENTITY_LABEL[a.entity] ?? a.entity}</b>
                {a.outlet_code && <span className="text-muted-foreground"> · {a.outlet_code}</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDateWita(a.created_at, 'd MMM yyyy, HH:mm')} {auditSummary(a.details) && `· ${auditSummary(a.details)}`}
              </p>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

export function StaffPage() {
  const { profile, can } = useAuth()
  const staff = useStaff()
  const setActive = useSetStaffActive()
  const [createOpen, setCreateOpen] = useState(false)
  const [access, setAccess] = useState<StaffMember | null>(null)
  const [reset, setReset] = useState<StaffMember | null>(null)
  const owner = !!profile?.is_owner
  const canAudit = owner || can('audit.view')

  function toggleActive(m: StaffMember) {
    setActive.mutate(
      { userId: m.id, active: !m.is_active },
      {
        onSuccess: () => toast.success(m.is_active ? `Akun ${m.full_name} dinonaktifkan` : `Akun ${m.full_name} diaktifkan`),
        onError: (e) => toast.error(toUserMessage(e)),
      },
    )
  }

  const list = (
    <>
      {staff.isPending ? (
        <Skeleton className="h-40" />
      ) : staff.isError ? (
        <Card>
          <EmptyState icon={Users} title="Gagal memuat karyawan" description={toUserMessage(staff.error)} />
        </Card>
      ) : (
        <Card className="divide-y overflow-hidden">
          {staff.data.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center gap-3 p-4" data-testid="staff-row">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {m.full_name}
                  {m.is_self && <Badge variant="muted">Anda</Badge>}
                  {!m.is_active && <Badge variant="danger">Nonaktif</Badge>}
                </p>
                <p className="text-sm text-muted-foreground">{m.username ? `@${m.username}` : '—'}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.is_owner ? (
                    <Badge variant="dark">
                      <ShieldCheck className="h-3 w-3" /> Pemilik · semua outlet
                    </Badge>
                  ) : m.assignments.length === 0 ? (
                    <Badge variant="outline">Belum ditugaskan</Badge>
                  ) : (
                    m.assignments.map((a) => (
                      <Badge key={a.id} variant={a.is_active ? 'default' : 'muted'}>
                        {a.outlet_code} · {ROLE_LABEL[a.role]}
                        {!a.is_active && ' (nonaktif)'}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
              {m.can_manage && (
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" onClick={() => setAccess(m)}>
                    <ShieldCheck /> Akses
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setReset(m)}>
                    <KeyRound /> Sandi
                  </Button>
                  {owner && (
                    <Button size="sm" variant={m.is_active ? 'destructive-ghost' : 'ghost'} onClick={() => toggleActive(m)} disabled={setActive.isPending}>
                      {m.is_active ? <UserX /> : <UserCheck />} {m.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
    </>
  )

  return (
    <>
      <PageHeader
        icon={Users}
        title="Karyawan"
        description="Akun, peran, dan hak akses per outlet"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus /> Tambah
          </Button>
        }
      />
      {canAudit ? (
        <Tabs defaultValue="staff">
          <TabsList>
            <TabsTrigger value="staff">
              <Users /> Karyawan
            </TabsTrigger>
            <TabsTrigger value="audit">
              <Activity /> Aktivitas
            </TabsTrigger>
          </TabsList>
          <TabsContent value="staff">{list}</TabsContent>
          <TabsContent value="audit">
            <AuditPanel />
          </TabsContent>
        </Tabs>
      ) : (
        list
      )}
      <CreateStaffDialog open={createOpen} onOpenChange={setCreateOpen} />
      <AccessDialog member={access} onClose={() => setAccess(null)} />
      <ResetPasswordDialog member={reset} onClose={() => setReset(null)} />
    </>
  )
}

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, LogOut, Search, Settings, ShieldCheck, Store } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/features/auth/auth-context'
import { ROLE_LABEL } from '@/features/auth/permissions'
import { NAV_ITEMS, type NavItem } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { InstallCard } from '@/pwa/install-card'

const GROUP_LABEL: Record<NavItem['group'], string> = {
  utama: 'Menu Utama',
  operasional: 'Operasional',
  manajemen: 'Manajemen',
}

export function MorePage() {
  const { profile, outlets, activeOutlet, setActiveOutlet, can, signOut } = useAuth()
  const [q, setQ] = useState('')
  const [signingOut, setSigningOut] = useState(false)

  const items = useMemo(() => {
    const s = q.trim().toLowerCase()
    return NAV_ITEMS.filter((i) => !i.permissions || can(...i.permissions)).filter(
      (i) => !s || `${i.label} ${i.description}`.toLowerCase().includes(s),
    )
  }, [q, can])
  const groups = (Object.keys(GROUP_LABEL) as NavItem['group'][])
    .map((g) => ({ g, list: items.filter((i) => i.group === g) }))
    .filter((x) => x.list.length > 0)

  return (
    <>
      <PageHeader icon={Settings} title="Lainnya" />
      <InstallCard />
      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari menu…"
          aria-label="Cari menu"
          className="h-12 pl-11"
        />
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/20">
              <Store className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{activeOutlet?.outlet_name}</p>
              <p className="text-sm text-muted-foreground">Kode outlet {activeOutlet?.outlet_code}</p>
            </div>
          </div>
          {outlets.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Pilih outlet">
              {outlets.map((o) => (
                <button
                  key={o.outlet_id}
                  type="button"
                  onClick={() => setActiveOutlet(o.outlet_id)}
                  aria-pressed={o.outlet_id === activeOutlet?.outlet_id}
                  className={cn(
                    'h-10 rounded-full border px-4 text-sm font-semibold transition-colors',
                    o.outlet_id === activeOutlet?.outlet_id
                      ? 'border-secondary bg-secondary text-secondary-foreground'
                      : 'bg-card hover:bg-muted',
                  )}
                >
                  {o.outlet_code}
                </button>
              ))}
            </div>
          )}
        </Card>
        <Card className="flex items-center gap-4 p-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/20">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{profile?.full_name}</p>
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {profile?.username && <span>@{profile.username}</span>}
              {activeOutlet && <Badge variant="dark">{ROLE_LABEL[activeOutlet.role]}</Badge>}
            </p>
          </div>
          <Button
            variant="destructive-ghost"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true)
              try {
                await signOut()
              } finally {
                setSigningOut(false)
              }
            }}
          >
            <LogOut /> Keluar
          </Button>
        </Card>
      </div>

      <div className="space-y-6">
        {groups.map(({ g, list }) => (
          <section key={g}>
            <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{GROUP_LABEL[g]}</h2>
            <Card className="divide-y overflow-hidden">
              {list.map(({ to, label, description, icon: Icon }) => (
                <Link key={to} to={to} className="flex items-center gap-4 p-4 transition-colors hover:bg-muted/60">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{label}</span>
                    <span className="block truncate text-sm text-muted-foreground">{description}</span>
                  </span>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </Link>
              ))}
            </Card>
          </section>
        ))}
        {groups.length === 0 && <p className="py-10 text-center text-muted-foreground">Menu tidak ditemukan.</p>}
      </div>
    </>
  )
}

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Search, Settings } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NAV_ITEMS, type NavItem } from '@/lib/navigation'

const GROUP_LABEL: Record<NavItem['group'], string> = {
  utama: 'Menu Utama',
  operasional: 'Operasional',
  manajemen: 'Manajemen',
}

export function MorePage() {
  const [q, setQ] = useState('')
  const items = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? NAV_ITEMS.filter((i) => `${i.label} ${i.description}`.toLowerCase().includes(s)) : NAV_ITEMS
  }, [q])
  const groups = (Object.keys(GROUP_LABEL) as NavItem['group'][])
    .map((g) => ({ g, list: items.filter((i) => i.group === g) }))
    .filter((x) => x.list.length > 0)

  return (
    <>
      <PageHeader icon={Settings} title="Lainnya" />
      <div className="relative mb-6">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari menu…"
          aria-label="Cari menu"
          className="h-12 pl-11"
        />
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

import { Construction } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import type { NavItem } from '@/lib/navigation'

/** Halaman sementara untuk modul yang dibangun pada fase berikutnya. */
export function PlaceholderPage({ item, phase }: { item: NavItem; phase: string }) {
  return (
    <>
      <PageHeader icon={item.icon} title={item.label} description={item.description} />
      <Card>
        <EmptyState
          icon={Construction}
          title={`Modul ${item.label} sedang dibangun`}
          description={`Fitur ini dijadwalkan pada ${phase} sesuai IMPLEMENTATION_PLAN.md.`}
        />
      </Card>
    </>
  )
}

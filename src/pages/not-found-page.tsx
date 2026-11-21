import { Link } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

export function NotFoundPage() {
  return (
    <EmptyState
      icon={SearchX}
      title="Halaman tidak ditemukan"
      action={
        <Button asChild>
          <Link to="/">Kembali ke Beranda</Link>
        </Button>
      }
    />
  )
}

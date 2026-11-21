import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { History, Package, Pencil, Plus, Power, RefreshCw, Search, Tags } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/features/auth/auth-context'
import { toUserMessage } from '@/lib/errors'
import { formatRupiah, UNIT_LABEL } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Product } from './api'
import { CategoriesDialog } from './categories-dialog'
import { ProductFormDialog } from './product-form-dialog'
import { useCategories, useProducts, useSetProductActive } from './queries'
import { stockLevel, StockBadge } from './stock-badge'

type StatusFilter = 'active' | 'inactive' | 'low' | 'all'

export function ProductsPage() {
  const { can } = useAuth()
  const products = useProducts()
  const categories = useCategories()
  const setActive = useSetProductActive()
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [editing, setEditing] = useState<Product | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [catOpen, setCatOpen] = useState(false)

  const catName = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c.name])), [categories.data])
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (products.data ?? []).filter((p) => {
      if (s && !`${p.name} ${p.sku}`.toLowerCase().includes(s)) return false
      if (category === 'none' ? p.category_id !== null : category !== 'all' && p.category_id !== category) return false
      if (status === 'active' && !p.is_active) return false
      if (status === 'inactive' && p.is_active) return false
      if (status === 'low' && (!p.is_active || stockLevel(p.current_stock, p.min_stock) === 'ok')) return false
      return true
    })
  }, [products.data, q, category, status])

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }
  const openEdit = (p: Product) => {
    setEditing(p)
    setFormOpen(true)
  }
  const toggleActive = (p: Product) =>
    setActive.mutate(
      { id: p.id, active: !p.is_active },
      {
        onSuccess: () => toast.success(p.is_active ? `${p.name} dinonaktifkan` : `${p.name} diaktifkan`),
        onError: (e) => toast.error(toUserMessage(e)),
      },
    )

  return (
    <>
      <PageHeader
        icon={Package}
        title="Produk"
        actions={
          <>
            <Button variant="outline" onClick={() => setCatOpen(true)}>
              <Tags /> Kategori
            </Button>
            <Button onClick={openCreate}>
              <Plus /> Tambah
            </Button>
          </>
        }
      />

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-[1fr_200px_200px]">
        <div className="relative col-span-2 md:col-span-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama atau SKU…" aria-label="Cari produk" className="pl-11" />
        </div>
        <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter kategori">
          <option value="all">Semua kategori</option>
          <option value="none">Tanpa kategori</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Filter status">
          <option value="active">Aktif</option>
          <option value="low">Stok menipis/habis</option>
          <option value="inactive">Nonaktif</option>
          <option value="all">Semua status</option>
        </NativeSelect>
      </div>

      {products.isPending ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : products.isError ? (
        <Card>
          <EmptyState
            icon={RefreshCw}
            title="Gagal memuat produk"
            description={toUserMessage(products.error)}
            action={<Button variant="outline" onClick={() => void products.refetch()}>Coba lagi</Button>}
          />
        </Card>
      ) : (
        <>
          <p className="mb-3 px-1 text-sm text-muted-foreground">{filtered.length} produk ditemukan</p>
          {filtered.length === 0 ? (
            <Card>
              <EmptyState
                icon={Package}
                title={products.data.length === 0 ? 'Belum ada produk' : 'Tidak ada produk yang cocok'}
                description={products.data.length === 0 ? 'Tambahkan varian parfum pertama Anda.' : 'Ubah kata kunci atau filter.'}
                action={products.data.length === 0 ? <Button onClick={openCreate}><Plus /> Tambah produk</Button> : undefined}
              />
            </Card>
          ) : (
            <ul className="space-y-3">
              {filtered.map((p) => (
                <li key={p.id}>
                  <Card className={cn('flex gap-4 p-4', !p.is_active && 'opacity-60')}>
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
                      {p.image_url ? (
                        <img src={p.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <Package className="h-7 w-7 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{p.name}</h3>
                        {p.category_id && <Badge variant="outline">{catName.get(p.category_id) ?? '—'}</Badge>}
                        {!p.is_active && <Badge variant="muted">Nonaktif</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">SKU: {p.sku}</p>
                      <p className="flex flex-wrap items-baseline gap-x-3">
                        <span className="text-lg font-bold">
                          {formatRupiah(p.sell_price)}
                          <span className="text-sm font-medium text-muted-foreground">/{UNIT_LABEL[p.unit]}</span>
                        </span>
                        {can('cost.view') && p.cost_price !== undefined && (
                          <span className="text-sm text-muted-foreground">HPP: {formatRupiah(p.cost_price ?? 0)}</span>
                        )}
                      </p>
                      <StockBadge current={p.current_stock} min={p.min_stock} unit={p.unit} />
                    </div>
                    <div className="flex shrink-0 flex-col gap-1 sm:flex-row sm:items-start">
                      {can('stock.manage') && (
                        <Button variant="ghost" size="icon" asChild aria-label={`Riwayat stok ${p.name}`}>
                          <Link to={`/stok?produk=${p.id}`}>
                            <History />
                          </Link>
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}>
                        <Pencil />
                      </Button>
                      <Button
                        variant={p.is_active ? 'destructive-ghost' : 'ghost'}
                        size="icon"
                        disabled={setActive.isPending}
                        onClick={() => toggleActive(p)}
                        aria-label={p.is_active ? `Nonaktifkan ${p.name}` : `Aktifkan ${p.name}`}
                      >
                        <Power />
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <ProductFormDialog open={formOpen} onOpenChange={setFormOpen} product={editing} categories={categories.data ?? []} />
      <CategoriesDialog open={catOpen} onOpenChange={setCatOpen} categories={categories.data ?? []} />
    </>
  )
}

import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toUserMessage } from '@/lib/errors'
import type { Category } from './api'
import { useCreateCategory, useUpdateCategory } from './queries'
import { categorySchema } from './schema'

export function CategoriesDialog({
  open,
  onOpenChange,
  categories,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  categories: Category[]
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const create = useCreateCategory()
  const update = useUpdateCategory()

  async function onAdd(e: React.FormEvent) {
    e.preventDefault()
    const parsed = categorySchema.safeParse({ name })
    if (!parsed.success) return setError(parsed.error.issues[0].message)
    setError(undefined)
    try {
      await create.mutateAsync(parsed.data.name)
      setName('')
      toast.success('Kategori ditambahkan')
    } catch (err) {
      setError(toUserMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Kelola Kategori" className="max-w-lg">
        <div className="space-y-4 p-5">
          <form onSubmit={onAdd} className="flex gap-2" noValidate>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama kategori baru" aria-label="Nama kategori baru" />
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Tambah
            </Button>
          </form>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <ul className="divide-y rounded-xl border">
            {categories.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">Belum ada kategori</li>}
            {categories.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 p-3 pl-4">
                <span className={c.is_active ? 'font-medium' : 'text-muted-foreground line-through'}>{c.name}</span>
                <Switch
                  checked={c.is_active}
                  aria-label={`Aktifkan kategori ${c.name}`}
                  disabled={update.isPending}
                  onCheckedChange={(checked) =>
                    update.mutate({ id: c.id, patch: { is_active: checked } }, { onError: (e) => toast.error(toUserMessage(e)) })
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  )
}

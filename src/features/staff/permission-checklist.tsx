import { PERMISSION_LABEL, PERMISSIONS, ROLE_DEFAULTS, type Permission } from '@/features/auth/permissions'
import { cn } from '@/lib/utils'

/** Daftar centang izin efektif. Izin yang tidak boleh diubah pemanggil dinonaktifkan. */
export function PermissionChecklist({
  role,
  value,
  onChange,
  editable,
}: {
  role: 'admin' | 'kasir'
  value: Permission[]
  onChange: (v: Permission[]) => void
  editable: (p: Permission) => boolean
}) {
  return (
    <ul className="grid gap-1 sm:grid-cols-2" aria-label="Hak akses">
      {PERMISSIONS.map((p) => {
        const checked = value.includes(p)
        const can = editable(p)
        const isDefault = ROLE_DEFAULTS[role].includes(p)
        return (
          <li key={p}>
            <label className={cn('flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm', can ? 'cursor-pointer hover:bg-muted' : 'opacity-50')}>
              <input
                type="checkbox"
                className="h-5 w-5 accent-[#171717]"
                checked={checked}
                disabled={!can}
                onChange={(e) => onChange(e.target.checked ? [...value, p] : value.filter((x) => x !== p))}
              />
              <span className="flex-1">{PERMISSION_LABEL[p]}</span>
              {isDefault && <span className="text-xs text-muted-foreground">bawaan</span>}
            </label>
          </li>
        )
      })}
    </ul>
  )
}

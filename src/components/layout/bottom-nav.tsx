import { NavLink } from 'react-router-dom'
import { BarChart3, Home, Package, Settings, ShoppingCart } from 'lucide-react'
import { cn } from '@/lib/utils'

const LEFT = [
  { to: '/', label: 'Beranda', icon: Home, end: true },
  { to: '/produk', label: 'Produk', icon: Package },
]
const RIGHT = [
  { to: '/laporan', label: 'Laporan', icon: BarChart3 },
  { to: '/lainnya', label: 'Lainnya', icon: Settings },
]

function Tab({ to, label, icon: Icon, end }: { to: string; label: string; icon: typeof Home; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors',
          isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span className={cn('flex h-8 w-12 items-center justify-center rounded-full', isActive && 'bg-primary/25')}>
            <Icon className="h-5 w-5" strokeWidth={isActive ? 2.4 : 2} />
          </span>
          <span className={cn(isActive && 'font-semibold')}>{label}</span>
        </>
      )}
    </NavLink>
  )
}

export function BottomNav() {
  return (
    <nav
      aria-label="Navigasi utama"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur pb-safe"
    >
      <div className="mx-auto flex max-w-6xl items-stretch px-2">
        {LEFT.map((t) => (
          <Tab key={t.to} {...t} />
        ))}
        <div className="flex flex-1 justify-center">
          <NavLink to="/kasir" aria-label="Kasir" className="-mt-7 flex flex-col items-center gap-1 text-xs font-semibold">
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    'flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-card transition-transform active:scale-95',
                    isActive && 'bg-secondary text-primary',
                  )}
                >
                  <ShoppingCart className="h-7 w-7" strokeWidth={2.4} />
                </span>
                <span>Kasir</span>
              </>
            )}
          </NavLink>
        </div>
        {RIGHT.map((t) => (
          <Tab key={t.to} {...t} />
        ))}
      </div>
    </nav>
  )
}

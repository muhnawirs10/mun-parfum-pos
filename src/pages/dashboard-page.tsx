import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, Boxes, ChevronRight, Moon, Package, Receipt, Sun, Wallet } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDateWita, formatTimeWita, greetingWita } from '@/lib/format'

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

const QUICK = [
  { to: '/produk', label: 'Kelola Produk', icon: Package },
  { to: '/laporan', label: 'Laporan', icon: BarChart3 },
  { to: '/pengeluaran', label: 'Pengeluaran', icon: Wallet },
  { to: '/stok', label: 'Stok', icon: Boxes },
]

export function DashboardPage() {
  const now = useNow()
  const greeting = greetingWita(now)
  const night = greeting === 'Selamat Malam'

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/25">
            {night ? <Moon className="h-7 w-7" /> : <Sun className="h-7 w-7" />}
          </span>
          <div>
            <p className="text-xl font-bold">{greeting}!</p>
            <p className="text-sm text-muted-foreground">MUN PARFUM POS</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">{formatDateWita(now)}</p>
          <p className="text-lg font-bold tabular-nums">{formatTimeWita(now, true)} WITA</p>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Total Transaksi', icon: Receipt },
          { label: 'Penjualan Hari Ini', icon: BarChart3 },
          { label: 'Pengeluaran Hari Ini', icon: Wallet },
        ].map(({ label, icon: Icon }) => (
          <Card key={label} className="p-5">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon className="h-4 w-4" /> {label}
            </p>
            <p className="mt-4 text-2xl font-bold text-muted-foreground">—</p>
            <p className="mt-2 text-xs text-muted-foreground">Terhubung ke database pada Fase 3</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Operasional</CardTitle>
            <Link to="/lainnya" className="flex items-center gap-1 text-sm font-semibold hover:underline">
              Semua fitur <ChevronRight className="h-4 w-4" />
            </Link>
          </CardHeader>
          <CardContent className="grid grid-cols-4 gap-2">
            {QUICK.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="flex flex-col items-center gap-2 rounded-xl p-2 text-center text-sm font-medium hover:bg-muted"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-primary bg-primary/10">
                  <Icon className="h-6 w-6" />
                </span>
                {label}
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <Receipt className="h-5 w-5" /> Transaksi Terakhir
            </CardTitle>
          </CardHeader>
          <EmptyState icon={Receipt} title="Belum ada transaksi" description="Riwayat transaksi tampil setelah modul kasir aktif." />
        </Card>
      </div>
    </div>
  )
}

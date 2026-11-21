import { WifiOff } from 'lucide-react'
import { useOnlineStatus } from '@/hooks/use-online-status'

/**
 * Indikator offline yang jelas. Aplikasi cloud: selama offline, tidak ada
 * transaksi atau perubahan stok yang boleh dianggap tersimpan.
 */
export function OfflineBanner() {
  const online = useOnlineStatus()
  if (online) return null
  return (
    <div
      role="alert"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-secondary px-4 py-2.5 text-sm font-medium text-secondary-foreground"
    >
      <WifiOff className="h-4 w-4 text-primary" />
      Tidak ada koneksi internet. Transaksi dan perubahan stok tidak dapat disimpan sampai koneksi pulih.
    </div>
  )
}

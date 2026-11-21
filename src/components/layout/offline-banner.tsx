import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useOnlineStatus } from '@/hooks/use-online-status'

/**
 * Indikator koneksi. Aplikasi cloud: selama offline, tidak ada transaksi atau
 * perubahan stok yang boleh dianggap tersimpan. Setelah koneksi pulih,
 * tampil tombol "Coba lagi" untuk memuat ulang data.
 */
export function OfflineBanner() {
  const online = useOnlineStatus()
  const qc = useQueryClient()
  const wasOffline = useRef(false)
  const [recovered, setRecovered] = useState(false)

  useEffect(() => {
    if (!online) {
      wasOffline.current = true
      setRecovered(false)
    } else if (wasOffline.current) {
      wasOffline.current = false
      setRecovered(true)
    }
  }, [online])

  if (!online) {
    return (
      <div role="alert" className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-secondary px-4 py-2.5 text-sm font-medium text-secondary-foreground">
        <WifiOff className="h-4 w-4 shrink-0 text-primary" />
        Tidak ada koneksi internet. Transaksi dan perubahan stok tidak dapat disimpan sampai koneksi pulih.
      </div>
    )
  }
  if (recovered) {
    return (
      <div role="status" className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-3 bg-success px-4 py-2 text-sm font-medium text-success-foreground">
        <Wifi className="h-4 w-4 shrink-0" /> Koneksi pulih.
        <Button
          size="sm"
          variant="outline"
          className="h-8 border-white/40 bg-transparent text-success-foreground hover:bg-white/10"
          onClick={() => {
            void qc.invalidateQueries()
            setRecovered(false)
          }}
        >
          <RefreshCw /> Coba lagi
        </Button>
        <button type="button" className="underline-offset-2 hover:underline" onClick={() => setRecovered(false)}>
          Tutup
        </button>
      </div>
    )
  }
  return null
}

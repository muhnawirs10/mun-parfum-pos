import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { toast } from 'sonner'

/**
 * Mendaftarkan service worker. Saat versi baru tersedia, pengguna diminta
 * menekan "Perbarui" — tidak otomatis, agar tidak memotong transaksi kasir.
 */
export function PwaUpdater() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // cek pembaruan tiap 30 menit selama aplikasi terbuka
      if (registration) setInterval(() => void registration.update(), 30 * 60 * 1000)
    },
  })

  useEffect(() => {
    if (!offlineReady) return
    toast.success('Aplikasi siap dibuka lebih cepat dari perangkat ini')
    setOfflineReady(false)
  }, [offlineReady, setOfflineReady])

  useEffect(() => {
    if (!needRefresh) return
    toast('Versi baru MUN PARFUM POS tersedia', {
      id: 'pwa-update',
      description: 'Selesaikan transaksi yang sedang berjalan, lalu perbarui.',
      duration: Infinity,
      action: { label: 'Perbarui', onClick: () => void updateServiceWorker(true) },
      cancel: { label: 'Nanti', onClick: () => setNeedRefresh(false) },
    })
  }, [needRefresh, setNeedRefresh, updateServiceWorker])

  return null
}

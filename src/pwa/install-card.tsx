import { Download, Share, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useInstallPrompt } from './install'

/** Ajakan memasang aplikasi ke layar utama (tidak tampil bila sudah terpasang). */
export function InstallCard() {
  const { state, install } = useInstallPrompt()
  if (state === 'installed' || state === 'unsupported') return null
  return (
    <Card className="mb-5 flex flex-wrap items-center gap-4 border-primary bg-primary/10 p-4" data-testid="install-card">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
        <Smartphone className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Pasang MUN PARFUM POS di perangkat ini</p>
        {state === 'ios' ? (
          <p className="text-sm text-muted-foreground">
            Ketuk <Share className="inline h-4 w-4 align-text-bottom" aria-label="Bagikan" /> di Safari, lalu pilih <b>Tambahkan ke Layar Utama</b>.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Buka langsung dari layar utama dalam tampilan penuh, tanpa bilah browser.</p>
        )}
      </div>
      {state === 'available' && (
        <Button
          onClick={async () => {
            const ok = await install()
            if (ok) toast.success('Aplikasi dipasang')
          }}
        >
          <Download /> Instal aplikasi
        </Button>
      )}
    </Card>
  )
}

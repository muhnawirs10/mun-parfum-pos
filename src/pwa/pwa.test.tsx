import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { OfflineBanner } from '@/components/layout/offline-banner'
import { pwaMock } from '@/test/pwa-mock'
import { __resetInstallState, listenForInstallPrompt } from './install'
import { InstallCard } from './install-card'
import { PwaUpdater } from './pwa-updater'

const user = userEvent.setup()
const UA = navigator.userAgent

function setUA(ua: string, touch = 0) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua })
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => touch })
}
function setStandalone(v: boolean) {
  window.matchMedia = ((q: string) => ({ matches: v && q.includes('standalone'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
}

beforeAll(() => listenForInstallPrompt())
beforeEach(() => {
  __resetInstallState()
  setUA(UA)
  setStandalone(false)
})

describe('Instal aplikasi', () => {
  it('Chrome/Android: tombol Instal memanggil prompt bawaan', async () => {
    render(<InstallCard />)
    expect(screen.queryByTestId('install-card')).not.toBeInTheDocument()
    const prompt = vi.fn(async () => {})
    const ev = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' as const }) })
    act(() => {
      window.dispatchEvent(ev)
    })
    expect(ev.defaultPrevented).toBe(true)
    await user.click(await screen.findByRole('button', { name: /Instal aplikasi/ }))
    expect(prompt).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByTestId('install-card')).not.toBeInTheDocument())
  })

  it('iPad (Safari): petunjuk Tambahkan ke Layar Utama', () => {
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', 5)
    render(<InstallCard />)
    expect(screen.getByTestId('install-card')).toHaveTextContent('Tambahkan ke Layar Utama')
    expect(screen.queryByRole('button', { name: /Instal/ })).not.toBeInTheDocument()
  })

  it('sudah terpasang (standalone): kartu tidak tampil', () => {
    setUA('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')
    setStandalone(true)
    render(<InstallCard />)
    expect(screen.queryByTestId('install-card')).not.toBeInTheDocument()
  })

  it('setelah appinstalled kartu hilang', async () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')
    render(<InstallCard />)
    expect(screen.getByTestId('install-card')).toBeInTheDocument()
    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })
    await waitFor(() => expect(screen.queryByTestId('install-card')).not.toBeInTheDocument())
  })
})

describe('Pembaruan versi', () => {
  afterEach(() => {
    pwaMock.needRefresh = false
  })
  it('versi baru: notifikasi dengan tombol Perbarui (tidak otomatis)', async () => {
    pwaMock.needRefresh = true
    render(
      <>
        <Toaster />
        <PwaUpdater />
      </>,
    )
    expect(await screen.findByText('Versi baru MUN PARFUM POS tersedia')).toBeInTheDocument()
    expect(pwaMock.update).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Perbarui' }))
    expect(pwaMock.update).toHaveBeenCalledWith(true)
  })
})

describe('Koneksi pulih', () => {
  function setOnline(v: boolean) {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => v })
    window.dispatchEvent(new Event(v ? 'online' : 'offline'))
  }
  afterEach(() => act(() => setOnline(true)))

  it('offline → banner peringatan; pulih → tombol Coba lagi memuat ulang data', async () => {
    const qc = new QueryClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    render(
      <QueryClientProvider client={qc}>
        <OfflineBanner />
      </QueryClientProvider>,
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Koneksi pulih.')).not.toBeInTheDocument()
    act(() => setOnline(false))
    expect(screen.getByRole('alert')).toHaveTextContent('Tidak ada koneksi internet')
    act(() => setOnline(true))
    expect(screen.getByText('Koneksi pulih.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Coba lagi/ }))
    expect(invalidate).toHaveBeenCalledOnce()
    expect(screen.queryByText('Koneksi pulih.')).not.toBeInTheDocument()
  })
})

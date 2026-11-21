import { useEffect, useState } from 'react'

/** Event `beforeinstallprompt` (Chrome/Edge/Android). */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

/** Dipanggil sekali saat aplikasi mulai — event bisa muncul sebelum halaman dirender. */
export function listenForInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // tampilkan tombol kita sendiri
    deferred = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installed = true
    notify()
  })
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function isIos(): boolean {
  const ua = navigator.userAgent
  // iPadOS 13+ melapor sebagai Macintosh dengan layar sentuh
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

export type InstallState = 'installed' | 'available' | 'ios' | 'unsupported'

export function useInstallPrompt() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])

  const state: InstallState = installed || isStandalone() ? 'installed' : deferred ? 'available' : isIos() ? 'ios' : 'unsupported'

  async function install(): Promise<boolean> {
    if (!deferred) return false
    const ev = deferred
    await ev.prompt()
    const choice = await ev.userChoice
    deferred = null
    notify()
    return choice.outcome === 'accepted'
  }

  return { state, install }
}

/** Untuk tes. */
export function __resetInstallState() {
  deferred = null
  installed = false
}

import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, LogIn, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { useAuth } from './auth-context'
import { FullScreenLoader, SetupRequired } from './guards'
import { loginSchema } from './identifier'

export function LoginPage() {
  const { status, signIn } = useAuth()
  const online = useOnlineStatus()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [errors, setErrors] = useState<{ identifier?: string; password?: string; form?: string }>({})
  const [submitting, setSubmitting] = useState(false)

  if (status === 'unconfigured') return <SetupRequired />
  if (status === 'loading') return <FullScreenLoader />
  if (status === 'signed_in') return <Navigate to={from} replace />

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    const parsed = loginSchema.safeParse({ identifier, password })
    if (!parsed.success) {
      const f = parsed.error.flatten().fieldErrors
      setErrors({ identifier: f.identifier?.[0], password: f.password?.[0] })
      return
    }
    if (!online) {
      setErrors({ form: 'Tidak ada koneksi internet. Login memerlukan internet.' })
      return
    }
    setErrors({})
    setSubmitting(true)
    try {
      await signIn(parsed.data.identifier, parsed.data.password)
      navigate(from, { replace: true })
    } catch (err) {
      setErrors({ form: (err as Error).message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <img src="/favicon.svg" alt="" className="h-16 w-16" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">MUN PARFUM POS</h1>
            <p className="text-sm text-muted-foreground">Masuk untuk mulai berjualan</p>
          </div>
        </div>
        <Card className="p-6">
          <form className="space-y-5" onSubmit={onSubmit} noValidate>
            <div className="space-y-2">
              <Label htmlFor="identifier">Email atau username</Label>
              <Input
                id="identifier"
                autoComplete="username"
                autoCapitalize="none"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                aria-invalid={!!errors.identifier}
                placeholder="nawir08"
              />
              {errors.identifier && <p className="text-sm text-destructive">{errors.identifier}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Kata sandi</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={!!errors.password}
                  className="pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="absolute right-1 top-1/2 flex h-9 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                  aria-label={show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
            </div>
            {!online && (
              <p className="flex items-center gap-2 rounded-xl bg-muted p-3 text-sm">
                <WifiOff className="h-4 w-4" /> Anda sedang offline.
              </p>
            )}
            {errors.form && (
              <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                {errors.form}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : <LogIn />}
              {submitting ? 'Memproses…' : 'Masuk'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  )
}

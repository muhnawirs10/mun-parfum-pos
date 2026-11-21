import { z } from 'zod'

export const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(3, 'Masukkan email atau username')
    .max(120)
    .refine((v) => v.includes('@') || /^[a-zA-Z0-9._]{3,32}$/.test(v), 'Username hanya huruf, angka, titik, atau garis bawah'),
  password: z.string().min(6, 'Kata sandi minimal 6 karakter').max(72),
})

export type LoginInput = z.infer<typeof loginSchema>

export { identifierToEmail } from './identifier-email'

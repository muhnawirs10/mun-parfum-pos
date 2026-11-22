import { expect, type Page } from '@playwright/test'
import pg from 'pg'
import { E2E_DB_URL } from './config'

pg.types.setTypeParser(1700, (v) => v) // numeric sebagai string (tanpa float)

/** Query langsung ke database E2E (superuser) untuk memverifikasi hasil. */
export async function sql<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: E2E_DB_URL })
  await c.connect()
  try {
    return (await c.query<T>(text, params)).rows
  } finally {
    await c.end()
  }
}

export async function login(page: Page, identifier: string, password: string) {
  await page.goto('/masuk')
  await page.getByLabel('Email atau username').fill(identifier)
  await page.getByLabel('Kata sandi', { exact: true }).fill(password)
  await page.getByRole('button', { name: /Masuk/ }).click()
  await expect(page.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible()
}

export async function logout(page: Page) {
  await page.goto('/lainnya')
  await page.getByRole('button', { name: /Keluar/ }).click()
  await expect(page).toHaveURL(/\/masuk$/)
}

/** Tanggal bisnis WITA hari ini (YYYY-MM-DD). */
export async function todayWita() {
  const [{ d }] = await sql(`select (now() at time zone 'Asia/Makassar')::date::text d`)
  return d as string
}

/** Pilih outlet aktif lewat menu Lainnya (pemilik dengan beberapa outlet). */
export async function selectOutlet(page: Page, code: string) {
  await page.goto('/lainnya')
  await page.getByRole('group', { name: 'Pilih outlet' }).getByRole('button', { name: code }).click()
  await expect(page.getByRole('button', { name: code })).toHaveAttribute('aria-pressed', 'true')
}

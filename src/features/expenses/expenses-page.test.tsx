import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderRoute } from '@/test/render'
import { seedDb, USERS, type FakeUser } from '@/test/fake-supabase'
import { expenseSchema } from './schema'

const user = userEvent.setup()

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })
  window.dispatchEvent(new Event(value ? 'online' : 'offline'))
}

async function open(u: FakeUser = USERS.owner) {
  const db = seedDb()
  db.expenses.push(
    { id: 'e-1', outlet_id: 'o-tkl', expense_date: '2026-11-20', category: 'listrik', amount: 150000, description: 'Token PLN', created_by: 'u-owner', created_at: '', deleted_at: null },
    { id: 'e-2', outlet_id: 'o-tkl', expense_date: '2026-11-21', category: 'transportasi', amount: 25000, description: null, created_by: 'u-owner', created_at: '', deleted_at: null },
  )
  const r = renderRoute('/pengeluaran', u, db)
  await screen.findAllByTestId('expense-row')
  return r
}

describe('schema pengeluaran', () => {
  it('nominal format Indonesia, > 0, kategori wajib', () => {
    expect(expenseSchema.parse({ expense_date: '2026-11-21', category: 'listrik', amount: '150.000', description: '' })).toEqual({
      expense_date: '2026-11-21',
      category: 'listrik',
      amount: '150000',
      description: null,
    })
    const r = expenseSchema.safeParse({ expense_date: '', category: 'bensin', amount: '0', description: '' })
    expect(r.error!.issues.map((i) => i.message)).toEqual(['Tanggal wajib diisi', 'Pilih kategori', 'Nominal harus lebih dari 0'])
  })
})

describe('Halaman Pengeluaran', () => {
  afterEach(() => act(() => setOnline(true)))

  it('menampilkan total, per kategori, dan daftar', async () => {
    await open()
    expect(screen.getByTestId('expense-total')).toHaveTextContent('Rp175.000')
    expect(screen.getByText('Listrik · Rp150.000')).toBeInTheDocument()
    expect(screen.getAllByTestId('expense-row')).toHaveLength(2)
    expect(screen.getByText('Token PLN')).toBeInTheDocument()
  })

  it('catat pengeluaran baru dengan validasi', async () => {
    const { fake, db } = await open()
    await user.click(screen.getByRole('button', { name: /Catat/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Catat Pengeluaran' })
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    expect(within(dialog).getByText('Nominal wajib diisi')).toBeInTheDocument()
    await user.selectOptions(within(dialog).getByLabelText('Kategori'), 'gaji')
    await user.type(within(dialog).getByLabelText('Nominal (Rp)'), '1.500.000')
    await user.type(within(dialog).getByLabelText('Keterangan'), 'Gaji karyawan')
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const insert = fake.calls.writes.find((w) => w.table === 'expenses' && w.op === 'insert')!
    expect(insert.payload).toMatchObject({ category: 'gaji', amount: '1500000', description: 'Gaji karyawan', outlet_id: 'o-tkl', created_by: 'u-owner' })
    expect(db.expenses).toHaveLength(3)
    await waitFor(() => expect(screen.getByTestId('expense-total')).toHaveTextContent('Rp1.675.000'))
  })

  it('ubah dan hapus (soft delete) dengan konfirmasi', async () => {
    const { fake, db } = await open()
    const row = screen.getByText('Token PLN').closest('[data-testid="expense-row"]') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Ubah pengeluaran' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ubah Pengeluaran' })
    expect(within(dialog).getByLabelText('Nominal (Rp)')).toHaveValue('150.000')
    await user.clear(within(dialog).getByLabelText('Nominal (Rp)'))
    await user.type(within(dialog).getByLabelText('Nominal (Rp)'), '175.000')
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fake.calls.writes.find((w) => w.op === 'update')!.payload).toMatchObject({ amount: '175000', category: 'listrik' })

    const row2 = screen.getByText('Token PLN').closest('[data-testid="expense-row"]') as HTMLElement
    await user.click(within(row2).getByRole('button', { name: 'Hapus pengeluaran' }))
    await user.click(within(row2).getByRole('button', { name: 'Hapus' }))
    await waitFor(() => expect(screen.queryByText('Token PLN')).not.toBeInTheDocument())
    const del = fake.calls.writes.filter((w) => w.op === 'update').slice(-1)[0].payload as Record<string, unknown>
    expect(del.deleted_by).toBe('u-owner')
    expect(del.deleted_at).toBeTruthy()
    expect(db.expenses.find((e) => e.id === 'e-1')).toBeTruthy() // data tetap ada
  })

  it('offline: tidak dikirim', async () => {
    const { fake } = await open()
    await user.click(screen.getByRole('button', { name: /Catat/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Nominal (Rp)'), '10.000')
    act(() => setOnline(false))
    await user.click(within(dialog).getByRole('button', { name: /Simpan/ }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Tidak ada koneksi internet')
    expect(fake.calls.writes.some((w) => w.table === 'expenses')).toBe(false)
  })

  it('izin hanya-baca: tanpa tombol catat/ubah/hapus; kasir ditolak', async () => {
    const viewer: FakeUser = { ...USERS.admin, access: [{ ...USERS.admin.access[0], permissions: [...USERS.admin.access[0].permissions, 'expenses.view'] }] }
    await open(viewer)
    expect(screen.queryByRole('button', { name: /Catat/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hapus pengeluaran' })).not.toBeInTheDocument()
    renderRoute('/pengeluaran', USERS.kasir)
    expect(await screen.findByText('Akses ditolak')).toBeInTheDocument()
  })
})

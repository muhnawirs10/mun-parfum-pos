import { useSyncExternalStore } from 'react'
import { Decimal } from '@/lib/decimal'
import type { StockUnit } from '@/lib/format'
import { calcSale, type SaleResult } from '@/lib/sale-calc'

export interface CartLine {
  key: string
  productId: string
  name: string
  sku: string
  unit: StockUnit
  /** harga per satuan, string numerik dari DB (snapshot sementara untuk pratinjau) */
  price: string
  qty: string
  discount: string
}

export interface CartState {
  lines: CartLine[]
  discount: string
  customerName: string
  note: string
  /**
   * Kunci idempotensi checkout. Tetap sama selama isi keranjang tidak berubah,
   * sehingga "coba lagi" setelah gangguan jaringan mengembalikan transaksi yang
   * sama (bukan membuat transaksi kedua). Diganti setiap kali keranjang berubah.
   */
  checkoutKey: string
}

const empty = (): CartState => ({ lines: [], discount: '0', customerName: '', note: '', checkoutKey: crypto.randomUUID() })

/** Satu keranjang per outlet, disimpan di memori selama aplikasi terbuka. */
export class CartStore {
  private states = new Map<string, CartState>()
  private listeners = new Set<() => void>()

  get(outletId: string): CartState {
    let s = this.states.get(outletId)
    if (!s) {
      s = empty()
      this.states.set(outletId, s)
    }
    return s
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private set(outletId: string, patch: Partial<CartState>, keepKey = false) {
    const prev = this.get(outletId)
    this.states.set(outletId, { ...prev, ...patch, checkoutKey: keepKey ? prev.checkoutKey : crypto.randomUUID() })
    this.listeners.forEach((l) => l())
  }

  /**
   * Tambah produk. Tanpa diskon: digabung dengan baris produk yang sama (yang
   * juga tanpa diskon). Dengan diskon: selalu baris baru.
   */
  add(outletId: string, p: Omit<CartLine, 'key' | 'discount'> & { discount?: string }) {
    const s = this.get(outletId)
    const discount = p.discount ?? '0'
    const existing = Decimal.from(discount).isZero()
      ? s.lines.find((l) => l.productId === p.productId && Decimal.from(l.discount).isZero())
      : undefined
    if (existing) {
      this.updateLine(outletId, existing.key, { qty: Decimal.from(existing.qty).add(p.qty).toString() })
    } else {
      this.set(outletId, { lines: [...s.lines, { ...p, key: crypto.randomUUID(), discount }] })
    }
  }

  updateLine(outletId: string, key: string, patch: Partial<Pick<CartLine, 'qty' | 'discount'>>) {
    const s = this.get(outletId)
    this.set(outletId, { lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) })
  }

  /** Ubah jumlah sebesar `step` (bisa negatif). Baris dihapus jika jumlah ≤ 0. */
  step(outletId: string, key: string, step: number) {
    const line = this.get(outletId).lines.find((l) => l.key === key)
    if (!line) return
    const next = Decimal.from(line.qty).add(step)
    if (next.lte(0)) this.remove(outletId, key)
    else this.updateLine(outletId, key, { qty: next.toString() })
  }

  remove(outletId: string, key: string) {
    const s = this.get(outletId)
    this.set(outletId, { lines: s.lines.filter((l) => l.key !== key) })
  }

  setMeta(outletId: string, patch: Partial<Pick<CartState, 'discount' | 'customerName' | 'note'>>) {
    this.set(outletId, patch, !('discount' in patch))
  }

  clear(outletId: string) {
    this.states.set(outletId, empty())
    this.listeners.forEach((l) => l())
  }
}

export const cartStore = new CartStore()

export function useCart(outletId: string): CartState {
  return useSyncExternalStore(cartStore.subscribe, () => cartStore.get(outletId))
}

export interface CartTotals {
  result: SaleResult | null
  error: string | null
}

/** Pratinjau total dengan aturan yang sama dengan RPC create_sale. */
export function cartTotals(state: CartState): CartTotals {
  if (state.lines.length === 0) return { result: null, error: null }
  try {
    return {
      result: calcSale(
        state.lines.map((l) => ({ price: l.price, cost: 0, qty: l.qty, discount: l.discount })),
        state.discount || '0',
      ),
      error: null,
    }
  } catch (e) {
    return { result: null, error: (e as Error).message }
  }
}

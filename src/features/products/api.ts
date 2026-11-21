import type { SupabaseClient } from '@supabase/supabase-js'
import type { StockUnit } from '@/lib/format'
import type { ProductFormOutput } from './schema'

/** Kolom yang boleh dibaca semua pengguna (HPP sengaja tidak termasuk). */
export const PRODUCT_COLUMNS =
  'id, outlet_id, category_id, sku, name, description, image_url, unit, sell_price, current_stock, min_stock, is_active, created_at, updated_at'

export interface Product {
  id: string
  outlet_id: string
  category_id: string | null
  sku: string
  name: string
  description: string | null
  image_url: string | null
  unit: StockUnit
  sell_price: number | string
  current_stock: number | string
  min_stock: number | string
  is_active: boolean
  created_at: string
  updated_at: string
  /** Hanya terisi bila pengguna punya izin cost.view. */
  cost_price?: number | string | null
}

export interface Category {
  id: string
  outlet_id: string
  name: string
  sort_order: number
  is_active: boolean
}

function check<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error
  return r.data
}

export async function fetchProducts(client: SupabaseClient, outletId: string, withCost: boolean): Promise<Product[]> {
  const products = check(
    await client.from('products').select(PRODUCT_COLUMNS).eq('outlet_id', outletId).order('name'),
  ) as Product[]
  if (!withCost) return products
  const costs = check(
    await client.from('product_costs').select('product_id, cost_price').eq('outlet_id', outletId),
  ) as { product_id: string; cost_price: number | string }[]
  const map = new Map(costs.map((c) => [c.product_id, c.cost_price]))
  return products.map((p) => ({ ...p, cost_price: map.get(p.id) ?? null }))
}

export async function fetchCategories(client: SupabaseClient, outletId: string): Promise<Category[]> {
  return check(
    await client
      .from('categories')
      .select('id, outlet_id, name, sort_order, is_active')
      .eq('outlet_id', outletId)
      .order('sort_order')
      .order('name'),
  ) as Category[]
}

export async function createCategory(client: SupabaseClient, outletId: string, name: string): Promise<Category> {
  return check(
    await client.from('categories').insert({ outlet_id: outletId, name }).select('id, outlet_id, name, sort_order, is_active').single(),
  ) as Category
}

export async function updateCategory(client: SupabaseClient, id: string, patch: { name?: string; is_active?: boolean }) {
  check(await client.from('categories').update(patch).eq('id', id))
}

export async function createProduct(client: SupabaseClient, outletId: string, v: ProductFormOutput) {
  return check(
    await client.rpc('create_product', {
      p_outlet_id: outletId,
      p_name: v.name,
      p_unit: v.unit,
      p_sell_price: v.sell_price,
      p_cost_price: v.cost_price ?? 0,
      p_initial_stock: v.initial_stock,
      p_min_stock: v.min_stock,
      p_category_id: v.category_id,
      p_description: v.description,
      p_image_url: v.image_url,
      p_sku: v.sku,
    }),
  ) as { id: string; sku: string }
}

export async function updateProduct(client: SupabaseClient, productId: string, v: ProductFormOutput) {
  return check(
    await client.rpc('update_product', {
      p_product_id: productId,
      p_name: v.name,
      p_unit: v.unit,
      p_sell_price: v.sell_price,
      p_cost_price: v.cost_price, // null = tidak diubah
      p_min_stock: v.min_stock,
      p_category_id: v.category_id,
      p_description: v.description,
      p_image_url: v.image_url,
      p_sku: v.sku,
      p_is_active: v.is_active,
    }),
  ) as { id: string; sku: string }
}

export async function setProductActive(client: SupabaseClient, productId: string, active: boolean) {
  check(await client.rpc('set_product_active', { p_product_id: productId, p_is_active: active }))
}

export const IMAGE_BUCKET = 'product-images'
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export async function uploadProductImage(client: SupabaseClient, outletId: string, file: File): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('Format foto harus JPG, PNG, atau WEBP')
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Ukuran foto maksimal 2 MB')
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${outletId}/${crypto.randomUUID()}.${ext}`
  const up = await client.storage.from(IMAGE_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (up.error) throw up.error
  return client.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl
}

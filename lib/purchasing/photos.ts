import { supabaseAdmin } from '@/lib/supabase-admin'

export const PHOTO_BUCKET = 'purchasing-photos'
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024 // 15 MB

export function photoPublicUrl(path: string): string {
  return supabaseAdmin.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl
}

export interface PurchasingPhoto {
  id: string
  order_id: string
  storage_path: string
  original_name: string | null
  uploaded_by: string | null
  created_at: string
  deleted_at: string | null
  /** Computed public URL (added by the API, not stored). */
  url?: string
}

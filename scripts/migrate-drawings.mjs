/**
 * Migrate all drawing images from Google Drive to Supabase Storage
 * and create/update photo_mappings entries.
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const API_URL = 'https://entech-dashboard-v2.vercel.app/api/drawings'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

function extractDriveFileId(url) {
  if (!url) return null
  const m1 = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (m1) return m1[1]
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (m2) return m2[1]
  return null
}

async function downloadFromDrive(fileId) {
  // Use thumbnail API at high res for reliable download
  const url = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function migrate() {
  // Get existing mappings to skip
  const { data: existing } = await supabase
    .from('photo_mappings')
    .select('drive_file_id')
    .eq('photo_type', 'drawing')
  const existingIds = new Set(existing?.map(r => r.drive_file_id) || [])
  console.log(`Already migrated: ${existingIds.size} drawings`)

  // Fetch all drawings
  const res = await fetch(API_URL)
  const drawings = await res.json()
  console.log(`Total drawings from API: ${drawings.length}`)

  let migrated = 0, skipped = 0, failed = 0

  for (const drawing of drawings) {
    for (const [colName, urlKey] of [['Drawing 1', 'drawing1Url'], ['Drawing 2', 'drawing2Url']]) {
      const url = drawing[urlKey]
      if (!url) continue

      const fileId = extractDriveFileId(url)
      if (!fileId) { console.log(`  No file ID in: ${url}`); continue }

      if (existingIds.has(fileId)) {
        skipped++
        continue
      }

      const storagePath = `drawing/${drawing.partNumber}/${fileId.slice(0, 12)}_${colName.replace(' ', '').toLowerCase()}.jpg`

      try {
        const buffer = await downloadFromDrive(fileId)

        const { error: uploadErr } = await supabase.storage
          .from('photos')
          .upload(storagePath, buffer, {
            contentType: 'image/jpeg',
            upsert: true,
          })
        if (uploadErr) throw uploadErr

        const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/photos/${storagePath}`

        const { error: insertErr } = await supabase
          .from('photo_mappings')
          .upsert({
            source_url: url,
            drive_file_id: fileId,
            storage_path: storagePath,
            public_url: publicUrl,
            source_tab: 'Production data totals',
            source_column: colName + ' URL',
            photo_type: 'drawing',
            if_number: drawing.partNumber,
          }, { onConflict: 'drive_file_id' })
        if (insertErr) throw insertErr

        migrated++
        existingIds.add(fileId)
        if (migrated % 10 === 0) console.log(`  Migrated ${migrated}...`)
      } catch (err) {
        failed++
        console.error(`  FAIL ${drawing.partNumber} ${colName}: ${err.message}`)
      }
    }
  }

  console.log(`\nDone! Migrated: ${migrated}, Skipped: ${skipped}, Failed: ${failed}`)
}

migrate().catch(console.error)

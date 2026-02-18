/**
 * Fix quote PDFs: download from Drive links in Supabase and upload to Storage.
 * Usage: node scripts/fix-quote-pdfs.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'

// Load .env.local
const envPath = path.resolve(process.cwd(), '.env.local')
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim()
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const auth = new google.auth.GoogleAuth({
  keyFile: path.resolve(process.env.HOME, 'clawd/secrets/google-service-account.json'),
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
})
const drive = google.drive({ version: 'v3', auth })

function extractFileId(url) {
  if (!url) return null
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

async function downloadFile(fileId) {
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' })
  return Buffer.from(res.data)
}

async function main() {
  // Get all quotes with drive_link but no pdf_url
  const { data: quotes, error } = await supabase
    .from('quotes')
    .select('id, quote_number, drive_link, pdf_url')
    .not('drive_link', 'is', null)

  if (error) { console.error(error); return }

  const toFix = quotes.filter(q => q.drive_link && !q.pdf_url)
  console.log(`Found ${toFix.length} quotes with Drive links but no PDF uploaded`)

  let success = 0, failed = 0
  for (const q of toFix) {
    const fileId = extractFileId(q.drive_link)
    if (!fileId) { console.log(`  ⏭ ${q.quote_number}: no file ID in link`); continue }

    try {
      const buf = await downloadFile(fileId)
      const storagePath = `${q.quote_number}.pdf`

      const { error: upErr } = await supabase.storage
        .from('quote-pdfs')
        .upload(storagePath, buf, { contentType: 'application/pdf', upsert: true })

      if (upErr) throw upErr

      const { data: urlData } = supabase.storage
        .from('quote-pdfs')
        .getPublicUrl(storagePath)

      await supabase
        .from('quotes')
        .update({ pdf_url: urlData.publicUrl, pdf_path: storagePath })
        .eq('id', q.id)

      console.log(`  ✅ ${q.quote_number}`)
      success++
    } catch (e) {
      console.log(`  ❌ ${q.quote_number}: ${e.message}`)
      failed++
    }
  }

  console.log(`\nDone: ${success} uploaded, ${failed} failed, ${toFix.length - success - failed} skipped`)
}

main()

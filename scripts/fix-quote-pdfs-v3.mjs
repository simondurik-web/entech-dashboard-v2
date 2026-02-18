/**
 * Upload ALL PDFs from shared Drive folders (root + subfolders) to Supabase Storage.
 */
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import fs from 'fs'
import path from 'path'

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

async function listPDFsRecursive(folderId) {
  const all = []
  let pageToken = null
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents`,
      pageSize: 100,
      fields: 'nextPageToken, files(id, name, size, mimeType)',
      pageToken,
    })
    for (const f of res.data.files || []) {
      if (f.mimeType === 'application/pdf') all.push(f)
      else if (f.mimeType === 'application/vnd.google-apps.folder') {
        const sub = await listPDFsRecursive(f.id)
        all.push(...sub)
      }
    }
    pageToken = res.data.nextPageToken
  } while (pageToken)
  return all
}

async function main() {
  const folderId = '18JMJa9wt3Z1G_29KiSTQBJLim_e_FE-p'
  const files = await listPDFsRecursive(folderId)
  console.log(`Found ${files.length} total PDFs across all folders\n`)

  // Get all quotes from DB
  const { data: quotes } = await supabase.from('quotes').select('id, quote_number, pdf_url')
  const quoteMap = new Map(quotes.map(q => [q.quote_number, q]))

  // Deduplicate files by quote number (prefer larger file = more complete)
  const byQN = new Map()
  for (const f of files) {
    const qn = f.name.split('_')[0]
    const existing = byQN.get(qn)
    if (!existing || parseInt(f.size || 0) > parseInt(existing.size || 0)) {
      byQN.set(qn, f)
    }
  }

  let uploaded = 0, skipped = 0, noMatch = 0
  for (const [qn, f] of byQN) {
    const quote = quoteMap.get(qn)
    if (!quote) { console.log(`  ⏭ ${qn}: not in DB`); noMatch++; continue }
    if (quote.pdf_url) { console.log(`  ⏭ ${qn}: already has PDF`); skipped++; continue }

    try {
      const dl = await drive.files.get({ fileId: f.id, alt: 'media' }, { responseType: 'arraybuffer' })
      const buf = Buffer.from(dl.data)
      const storagePath = `${qn}.pdf`

      const { error: upErr } = await supabase.storage
        .from('quote-pdfs')
        .upload(storagePath, buf, { contentType: 'application/pdf', upsert: true })
      if (upErr) throw upErr

      const { data: urlData } = supabase.storage.from('quote-pdfs').getPublicUrl(storagePath)

      await supabase.from('quotes')
        .update({ pdf_url: urlData.publicUrl, pdf_path: storagePath })
        .eq('id', quote.id)

      console.log(`  ✅ ${qn} (${(buf.length/1024).toFixed(0)}KB)`)
      uploaded++
    } catch (e) {
      console.log(`  ❌ ${qn}: ${e.message}`)
    }
  }

  console.log(`\n✅ Uploaded: ${uploaded} | ⏭ Skipped: ${skipped} | 🚫 No match: ${noMatch}`)

  // Summary of quotes still missing PDFs
  const { data: missing } = await supabase.from('quotes').select('quote_number').is('pdf_url', null)
  console.log(`\n📋 ${missing.length} quotes still missing PDFs`)
}

main()

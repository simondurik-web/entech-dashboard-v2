/**
 * Upload ALL PDFs from BOTH shared Drive folders to Supabase Storage.
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
  // Both Entech_Quotes folders
  const folders = [
    '18JMJa9wt3Z1G_29KiSTQBJLim_e_FE-p',   // Original folder
    '139WhZJ6ng-c_qo6Y0FuKleldTTYHZIrO',   // Second folder (has Dec-Feb quotes)
  ]

  let allFiles = []
  for (const fid of folders) {
    const pdfs = await listPDFsRecursive(fid)
    allFiles.push(...pdfs)
  }
  console.log(`Found ${allFiles.length} total PDFs across both folders\n`)

  // Get all quotes from DB
  const { data: quotes } = await supabase.from('quotes').select('id, quote_number, pdf_url')
  const quoteMap = new Map(quotes.map(q => [q.quote_number, q]))
  console.log(`${quotes.length} quotes in DB\n`)

  // Deduplicate: prefer larger file per quote number
  const byQN = new Map()
  for (const f of allFiles) {
    const qn = f.name.split('_')[0]
    const existing = byQN.get(qn)
    if (!existing || parseInt(f.size || 0) > parseInt(existing.size || 0)) {
      byQN.set(qn, f)
    }
  }

  let uploaded = 0, skipped = 0, noMatch = 0, alreadyHas = 0
  for (const [qn, f] of byQN) {
    const quote = quoteMap.get(qn)
    if (!quote) { noMatch++; continue }
    if (quote.pdf_url) { alreadyHas++; continue }

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

  console.log(`\n✅ Uploaded: ${uploaded} | ⏭ Already had PDF: ${alreadyHas} | 🚫 No DB match: ${noMatch}`)

  // Final count
  const { data: withPdf } = await supabase.from('quotes').select('id').not('pdf_url', 'is', null)
  const { data: allQ } = await supabase.from('quotes').select('id')
  console.log(`\n📊 ${withPdf.length}/${allQ.length} quotes now have PDFs`)
}

main()

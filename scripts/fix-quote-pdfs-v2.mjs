/**
 * Upload PDFs from the shared Drive folder, matching by quote number in filename.
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

async function main() {
  const folderId = '18JMJa9wt3Z1G_29KiSTQBJLim_e_FE-p'

  // Get all PDFs from folder
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/pdf'`,
    pageSize: 100,
    fields: 'files(id, name, size)',
  })
  const files = res.data.files || []
  console.log(`${files.length} PDFs in Drive folder`)

  // Get all quotes from Supabase
  const { data: quotes } = await supabase.from('quotes').select('id, quote_number, pdf_url')
  const quoteMap = new Map(quotes.map(q => [q.quote_number, q]))

  let success = 0
  for (const f of files) {
    const qn = f.name.split('_')[0]
    const quote = quoteMap.get(qn)
    if (!quote) { console.log(`  ⏭ ${qn}: no matching quote in DB`); continue }
    if (quote.pdf_url) { console.log(`  ⏭ ${qn}: already has PDF`); continue }

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
      success++
    } catch (e) {
      console.log(`  ❌ ${qn}: ${e.message}`)
    }
  }
  console.log(`\nDone: ${success} uploaded`)
}

main()
